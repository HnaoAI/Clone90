// Serveur statique local de Clone90, sans dépendance (Node 18+). Voir docs/architecture.md section 9.
// Usage : node scripts/serve.mjs [--port 8080]   (ou PORT=8080). Sert le dossier courant.
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, resolve, sep, join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_PORT = 8080;

// INVARIANT : .wasm doit être servi en application/wasm (sinon l'instanciation en flux échoue).
// Tout type inconnu (.adf, .ipf, .hdf, .chd, ...) tombe sur application/octet-stream.
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
};
const DEFAULT_MIME = 'application/octet-stream';

/**
 * Détermine le port d'écoute : option --port (ou --port=N), sinon variable PORT, sinon 8080.
 * @param {string[]} argv arguments sans "node" ni le script
 * @param {Record<string, string|undefined>} env variables d'environnement
 * @returns {number} port entier entre 1 et 65535
 * @throws {Error} si la valeur n'est pas un port valide
 */
export function resolvePort(argv, env) {
  let value;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--port') value = argv[i + 1] ?? '';
    else if (argv[i].startsWith('--port=')) value = argv[i].slice('--port='.length);
  }
  value ??= env.PORT;
  if (value === undefined) return DEFAULT_PORT;
  const port = Number(value);
  if (!/^\d+$/.test(String(value)) || port < 1 || port > 65535) {
    throw new Error(`Port invalide : "${value}" (entier entre 1 et 65535 attendu)`);
  }
  return port;
}

function reply(res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });
  res.end(`${status} ${text}\n`);
}

/**
 * Convertit l'URL demandée en chemin de fichier sous `root`.
 * INVARIANT : ne jamais renvoyer un chemin hors de `root` (protection contre ../).
 * @returns {string|null} chemin absolu, ou null si la requête sort du dossier
 * @throws {URIError|RangeError} si l'encodage est invalide ou contient un octet nul
 */
function resolveInsideRoot(root, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  if (decoded.includes('\0')) throw new RangeError('octet nul');
  const target = resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  return target === root || target.startsWith(root + sep) ? target : null;
}

/** Lit un en-tête Range à un seul intervalle. Renvoie {start,end}, null (aucun) ou 'invalid'. */
function parseRange(header, size) {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return 'invalid';
  let start;
  let end;
  if (m[1] === '') {
    start = Math.max(size - Number(m[2]), 0);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  return start > end || start >= size ? 'invalid' : { start, end };
}

/**
 * Crée le serveur HTTP statique (non démarré : l'appelant appelle `listen`).
 * @param {{root: string}} options dossier à servir
 * @returns {http.Server}
 */
export function createStaticServer({ root }) {
  const absRoot = resolve(root);
  return http.createServer(async (req, res) => {
    try {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return reply(res, 405, 'Méthode non autorisée', { Allow: 'GET, HEAD' });
      }
      const urlPath = (req.url ?? '/').split('?')[0].split('#')[0];
      let file;
      try {
        file = resolveInsideRoot(absRoot, urlPath);
      } catch {
        return reply(res, 400, 'Requête invalide');
      }
      if (file === null) return reply(res, 403, 'Accès interdit');

      let info = await stat(file).catch(() => null);
      if (info?.isDirectory()) {
        file = join(file, 'index.html');
        info = await stat(file).catch(() => null);
      }
      if (!info?.isFile()) return reply(res, 404, 'Introuvable');

      const headers = {
        'Content-Type': MIME_TYPES[extname(file).toLowerCase()] ?? DEFAULT_MIME,
        'Cache-Control': 'no-cache',
        'Accept-Ranges': 'bytes',
      };
      const range = parseRange(req.headers.range, info.size);
      if (range === 'invalid') {
        return reply(res, 416, 'Plage non satisfaisante', { 'Content-Range': `bytes */${info.size}` });
      }
      let status = 200;
      let length = info.size;
      let stream = { start: 0, end: info.size - 1 };
      if (range) {
        status = 206;
        stream = range;
        length = range.end - range.start + 1;
        headers['Content-Range'] = `bytes ${range.start}-${range.end}/${info.size}`;
      }
      headers['Content-Length'] = length;
      res.writeHead(status, headers);
      if (req.method === 'HEAD' || length === 0) return res.end();
      createReadStream(file, stream).on('error', () => res.destroy()).pipe(res);
    } catch {
      if (!res.headersSent) reply(res, 500, 'Erreur interne');
      else res.destroy();
    }
  });
}

/** Adresses IPv4 non locales de la machine, pour jouer depuis un téléphone du même réseau. */
function networkUrls(port) {
  return Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${port}`);
}

function main() {
  let port;
  try {
    port = resolvePort(process.argv.slice(2), process.env);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const server = createStaticServer({ root: process.cwd() });
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE'
      ? `Le port ${port} est déjà utilisé. Essayez : node scripts/serve.mjs --port ${port + 1}`
      : err.message);
    process.exit(1);
  });
  // Écoute sur toutes les interfaces : accès depuis un téléphone du réseau local.
  server.listen(port, '0.0.0.0', () => {
    console.log(`Clone90 : http://localhost:${port}`);
    for (const url of networkUrls(port)) console.log(`Réseau local : ${url}`);
    console.log('Ctrl+C pour arrêter.');
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
