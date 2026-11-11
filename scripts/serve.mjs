// Serveur statique local de Clone90, sans dépendance (Node 18+). Voir docs/architecture.md section 9.
// Usage : node scripts/serve.mjs [--port 8080]   (ou PORT=8080). Sert la racine du projet (liste blanche).
import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { extname, resolve, sep, join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT } from './project-root.mjs';
import { readLocalSettings, describeFolders } from './local-settings.mjs';
import { createSettingsApi } from './settings-api.mjs';
import { chooseFolderOnMac } from './mac-folder-dialog.mjs';

export const DEFAULT_PORT = 8080;
/** Écoute sur toutes les interfaces par défaut (téléphone Android du même Wi-Fi). Le lanceur Mac (T20) passe --host 127.0.0.1. */
export const DEFAULT_HOST = '0.0.0.0';

// Ré-exportée pour les tests ; définie dans project-root.mjs (partagée avec generate-games.mjs).
export { PROJECT_ROOT };

// INVARIANT : liste blanche. Le serveur écoute sur toutes les interfaces : .git, config-equipe/,
// tickets/, docs/, scripts/, tests/ ne doivent jamais être lisibles depuis le réseau local.
// Ajouter ici tout nouveau fichier ou dossier public (ex. nouvelles icônes PWA sous assets/).
const PUBLIC_FILES = new Set(['index.html', 'player.html', 'manifest.webmanifest', 'sw.js',
  'systems.json', 'games.json']);
const PUBLIC_DIRS = new Set(['css', 'js', 'data', 'assets', 'roms', 'bios']);

/** Vrai si le chemin (relatif à la racine) est public : liste blanche, et aucun segment caché. */
function isPublicPath(relPath) {
  const segments = relPath.split(sep).filter(Boolean);
  if (segments.some((s) => s.startsWith('.'))) return false;
  if (segments.length === 0) return true; // la racine : index.html
  return segments.length === 1 && !PUBLIC_DIRS.has(segments[0])
    ? PUBLIC_FILES.has(segments[0])
    : PUBLIC_DIRS.has(segments[0]);
}

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
  '.ttf': 'font/ttf',
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

/**
 * Détermine l'adresse d'écoute : option --host (ou --host=H), sinon variable HOST, sinon 0.0.0.0.
 * @param {string[]} argv arguments sans "node" ni le script
 * @param {Record<string, string|undefined>} env variables d'environnement
 * @returns {string} adresse non vide
 * @throws {Error} si la valeur est vide
 */
export function resolveHost(argv, env) {
  let value;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--host') value = argv[i + 1] ?? '';
    else if (argv[i].startsWith('--host=')) value = argv[i].slice('--host='.length);
  }
  value ??= env.HOST;
  if (value === undefined) return DEFAULT_HOST;
  if (value.trim() === '') throw new Error('Adresse invalide : --host attend une adresse (ex. 127.0.0.1)');
  return value.trim();
}

/** Vrai si l'adresse d'écoute n'est joignable que depuis ce Mac (T20) : on n'affiche alors pas d'adresse réseau. */
export function isLocalOnlyHost(host) {
  return host === 'localhost' || host === '::1' || /^127\./.test(host);
}

/**
 * L'API locale des dossiers (T25, settings-api.mjs) n'existe que si le serveur n'écoute que sur ce Mac (mode du lanceur) et sous macOS
 * (boîte « choisir un dossier » via osascript). Ouvert au réseau local, /api/ répond 404 : un téléphone ne peut pas changer les dossiers.
 */
export function isSettingsApiEnabled(host, platform = process.platform) {
  return platform === 'darwin' && isLocalOnlyHost(host);
}

// INVARIANT : envoyé sur TOUTES les réponses (T11/A7) : le navigateur ne devine jamais un type différent du Content-Type annoncé.
const SECURITY_HEADERS = { 'X-Content-Type-Options': 'nosniff' };

// roms/ et bios/ peuvent être des liens vers un autre disque : leur racine autorisée est leur propre realpath (T11/A7, arbitrage PO).
// T23 : ou des dossiers choisis dans clone90.local.json (options romsDir et biosDir) ; l'adresse web reste roms/... et bios/...
const LINKABLE_DIRS = new Set(['roms', 'bios']);

/** Dossier sur le disque d'une adresse publique : roms/ et bios/ peuvent être redirigés vers un autre dossier (T23). */
function toDiskPath(root, file, top, dirs) {
  const base = dirs[top];
  return base ? join(base, relative(join(root, top), file)) : file;
}

/**
 * Racine dans laquelle le chemin réel du fichier doit rester : le realpath de roms/ ou bios/ (ou du dossier choisi) pour ces dossiers, sinon la racine du projet.
 * INVARIANT : un lien individuel (fichier ou sous-dossier) qui sort de ce realpath reste refusé.
 */
async function allowedRealRoot(root, realRoot, top, dirs) {
  if (!LINKABLE_DIRS.has(top)) return realRoot;
  return realpath(dirs[top] ?? join(root, top)).catch(() => null);
}

/** Vrai si `real` (chemin réel, liens résolus) est la racine ou se trouve dessous. */
const isInside = (realRoot, real) => real === realRoot || real.startsWith(realRoot + sep);

function reply(res, status, text, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', ...SECURITY_HEADERS, ...headers });
  res.end(`${status} ${text}\n`);
}

/**
 * Convertit l'URL demandée en chemin de fichier public sous `root`.
 * INVARIANT : ne jamais renvoyer un chemin hors de `root` (protection contre ../).
 * @returns {string|null} chemin absolu, ou null si hors de la racine ou hors liste blanche
 * @throws {URIError|RangeError} si l'encodage est invalide ou contient un octet nul
 */
function resolveInsideRoot(root, urlPath) {
  const decoded = decodeURIComponent(urlPath);
  if (decoded.includes('\0')) throw new RangeError('octet nul');
  const target = resolve(root, `.${decoded.startsWith('/') ? decoded : `/${decoded}`}`);
  if (target !== root && !target.startsWith(root + sep)) return null;
  return isPublicPath(relative(root, target)) ? target : null;
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
 * @param {{root: string, romsDir?: string, biosDir?: string, api?: {handle: Function}}} options racine à servir ; `romsDir` et `biosDir` (absolus) remplacent
 *   roms/ et bios/ du projet (T23, voir local-settings.mjs) ; `api` traite /api/... (T25), sinon /api/ répond 404
 * @returns {http.Server & {setFolders: (folders: {romsDir?: string, biosDir?: string}) => void}} `setFolders` change les dossiers sans redémarrer (T25)
 */
export function createStaticServer({ root, romsDir, biosDir, api }) {
  const absRoot = resolve(root);
  const dirs = { roms: romsDir && resolve(romsDir), bios: biosDir && resolve(biosDir) };
  const realRootPromise = realpath(absRoot).catch(() => absRoot);
  const server = http.createServer(async (req, res) => {
    try {
      const urlPath = (req.url ?? '/').split('?')[0].split('#')[0];
      if (urlPath === '/api' || urlPath.startsWith('/api/')) return api ? await api.handle(req, res) : reply(res, 404, 'Introuvable');
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return reply(res, 405, 'Méthode non autorisée', { Allow: 'GET, HEAD' });
      }
      const realRoot = await realRootPromise;
      let file;
      try {
        file = resolveInsideRoot(absRoot, urlPath);
      } catch {
        return reply(res, 400, 'Requête invalide');
      }
      // T16 : les navigateurs demandent /favicon.ico tout seuls ; les pages déclarent leur icône, donc on répond « introuvable » (pas une alerte 403 dans la console).
      if (file === null && urlPath === '/favicon.ico') return reply(res, 404, 'Introuvable');
      if (file === null) return reply(res, 403, 'Accès interdit');

      const top = relative(absRoot, file).split(sep)[0]; // avant la redirection : c'est l'adresse publique qui décide
      file = toDiskPath(absRoot, file, top, dirs);
      let info = await stat(file).catch(() => null);
      if (info?.isDirectory()) {
        file = join(file, 'index.html');
        info = await stat(file).catch(() => null);
      }
      if (!info?.isFile()) return reply(res, 404, 'Introuvable');
      // INVARIANT : un lien symbolique ne doit jamais faire sortir de la racine du projet (T11/A7).
      const real = await realpath(file).catch(() => null);
      if (real === null) return reply(res, 404, 'Introuvable');
      const allowed = await allowedRealRoot(absRoot, realRoot, top, dirs);
      if (allowed === null || !isInside(allowed, real)) return reply(res, 403, 'Accès interdit');

      const headers = {
        ...SECURITY_HEADERS,
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
  server.setFolders = (folders) => {
    dirs.roms = folders.romsDir && resolve(folders.romsDir);
    dirs.bios = folders.biosDir && resolve(folders.biosDir);
  };
  return server;
}

/** Adresses IPv4 non locales de la machine, pour jouer depuis un téléphone du même réseau. */
function networkUrls(port) {
  return Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${port}`);
}

async function main() {
  let port;
  let host;
  try {
    port = resolvePort(process.argv.slice(2), process.env);
    host = resolveHost(process.argv.slice(2), process.env);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  const settings = await readLocalSettings(PROJECT_ROOT);
  const api = createSettingsApi({
    root: PROJECT_ROOT, enabled: isSettingsApiEnabled(host), getPort: () => server.address().port,
    applyFolders: (folders) => server.setFolders(folders), chooseFolder: chooseFolderOnMac, baseHeaders: SECURITY_HEADERS,
  });
  const server = createStaticServer({ root: PROJECT_ROOT, romsDir: settings.romsDir, biosDir: settings.biosDir, api });
  server.on('error', (err) => {
    console.error(err.code === 'EADDRINUSE'
      ? `Le port ${port} est déjà utilisé. Essayez : node scripts/serve.mjs --port ${port + 1}`
      : err.message);
    process.exit(1);
  });
  // Par défaut toutes les interfaces (téléphone du réseau local) ; --host 127.0.0.1 : ce Mac seulement.
  server.listen(port, host, () => {
    console.log(`Clone90 : http://localhost:${port}`);
    for (const line of [...describeFolders(settings), ...settings.warnings.map((w) => `Avertissement : ${w}`)]) console.log(line);
    if (!isLocalOnlyHost(host)) for (const url of networkUrls(port)) console.log(`Réseau local : ${url}`);
    console.log('Ctrl+C pour arrêter.');
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
