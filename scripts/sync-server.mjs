// Serveur de partage Mac -> téléphone (T43) : HTTPS sur le réseau local (port 8443), LECTURE SEULE, réservé aux téléphones associés.
// Routes : GET / (page d'aide), GET /clone90-ca.crt (autorité à installer sur le téléphone), POST /sync/pair ({code} -> {token}),
// GET /sync/manifest (liste des jeux, pochettes, logos et BIOS), GET /sync/file?path=... (un fichier). Démarré par sync-api.mjs.
// Dépend de js/sync-plan.js (fichiers partagés, partagé avec le téléphone), sync-pairing.mjs (codes, jetons), local-settings.mjs (dossiers).
// INVARIANT (sécurité, décision de Hicham du 2026-11-15, option 1) : ce serveur n'écrit, n'efface et ne télécharge RIEN ; il ne sert que
//   les fichiers des dossiers des jeux et des BIOS acceptés par `syncTargetPath` (chemin réel vérifié : un lien qui sort du dossier est
//   refusé) ; liste et fichiers exigent le jeton d'un téléphone associé (Authorization: Bearer) ; aucune route de l'API du Mac (api/...) ici.
import https from 'node:https';
import { createReadStream } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { syncTargetPath, SYNC_ROUTES, isPairingCode } from '../js/sync-plan.js';
import { ROMS_DIR, BIOS_DIR } from '../js/config.js';
import { LOGOS_DIR } from '../js/logo-source.js';

const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
const MAX_PAIR_BODY = 256;

/** Texte de la page d'aide (ouverte sur le téléphone pour récupérer le certificat). */
export const HELP_PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clone90 - partage</title><style>body{font:18px/1.5 sans-serif;margin:24px;max-width:40em}a{display:inline-block;padding:12px 16px;background:#1239b0;color:#fff;border-radius:24px;text-decoration:none}</style></head>
<body><h1>Clone90 : partage avec le téléphone</h1>
<p>Ce Mac partage ses jeux, pochettes et logos avec les téléphones associés, en lecture seule.</p>
<p>1. Téléchargez le certificat de ce Mac :</p><p><a href="${SYNC_ROUTES.ca.slice(1)}" download="clone90-ca.crt">Télécharger le certificat</a></p>
<p>2. Installez-le : Paramètres &gt; Sécurité (ou « Sécurité et confidentialité ») &gt; Autres paramètres de sécurité &gt; Installer depuis la mémoire
(ou « Chiffrement et identifiants » &gt; « Installer un certificat ») &gt; <strong>Certificat CA</strong>, puis choisissez <code>clone90-ca.crt</code>.</p>
<p>3. Revenez dans Clone90, « Mes fichiers », « Synchroniser avec le Mac » : saisissez l'adresse et le code affichés sur le Mac.</p>
</body></html>`;

/**
 * Liste des fichiers partagés (jeux, pochettes et autres fichiers des machines, logos, BIOS), sans lien qui sort du dossier.
 * @param {{romsDir: string, biosDir: string, systemIds: string[]}} input
 * @returns {Promise<{path: string, size: number, mtime: number}[]>} `path` relatif (`roms/<machine>/...`, `bios/...`), trié
 */
export async function buildManifest({ romsDir, biosDir, systemIds }) {
  const out = [];
  const realBases = { [romsDir]: await realpath(romsDir).catch(() => null), [biosDir]: await realpath(biosDir).catch(() => null) };
  /** Vrai si le fichier reste dans le dossier partagé une fois les liens résolus (même règle que resolveSharedFile). */
  const inside = async (baseDir, file) => { const real = await realpath(file).catch(() => null); return Boolean(real && realBases[baseDir] && real.startsWith(realBases[baseDir] + sep)); };
  async function walk(baseDir, baseName, rel, depth) {
    const entries = await readdir(join(baseDir, ...rel), { withFileTypes: true }).catch(() => []);
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const parts = [...rel, e.name];
      const path = [baseName, ...parts].join('/');
      const info = await stat(join(baseDir, ...parts)).catch(() => null);
      if (!info) continue;
      if (info.isDirectory() && depth > 0) await walk(baseDir, baseName, parts, depth - 1);
      else if (info.isFile() && syncTargetPath(path, systemIds) && await inside(baseDir, join(baseDir, ...parts))) out.push({ path, size: info.size, mtime: Math.floor(info.mtimeMs) });
    }
  }
  for (const id of [...systemIds, LOGOS_DIR]) await walk(romsDir, ROMS_DIR, [id], id === LOGOS_DIR ? 0 : 1);
  await walk(biosDir, BIOS_DIR, [], 0);
  return out.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * Fichier du disque d'un chemin partagé, ou null (non partagé, absent, lien qui sort du dossier).
 * @returns {Promise<{file: string, size: number}|null>}
 */
export async function resolveSharedFile(path, { romsDir, biosDir, systemIds }) {
  if (!syncTargetPath(path, systemIds)) return null;
  const [top, ...rest] = path.split('/');
  const base = top === ROMS_DIR ? romsDir : biosDir;
  const file = join(base, ...rest);
  try {
    const [realBase, real] = await Promise.all([realpath(base), realpath(file)]);
    if (!real.startsWith(realBase + sep)) return null;
    const info = await stat(real);
    return info.isFile() ? { file: real, size: info.size } : null;
  } catch {
    return null;
  }
}

function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => { size += c.length; if (size <= limit) chunks.push(c); });
    req.on('end', () => resolve(size > limit ? null : Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => resolve(null));
  });
}

/**
 * Gestionnaire des requêtes du serveur de partage (testable sans HTTPS).
 * @param {{pairing: {tryCode: Function, isValidToken: Function}, getDirs: () => Promise<{romsDir: string, biosDir: string}>,
 *   getSystemIds: () => Promise<string[]>, getCa: () => string}} options
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createSyncHandler({ pairing, getDirs, getSystemIds, getCa }) {
  return async (req, res) => {
    // CORS : le téléphone appelle depuis le site de Clone90 (GitHub Pages) ; toute origine est acceptée, la protection est le jeton.
    const origin = typeof req.headers.origin === 'string' ? req.headers.origin : null;
    const cors = origin ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' } : {};
    const send = (status, body, headers = {}) => {
      res.writeHead(status, { ...BASE_HEADERS, ...cors, 'Content-Type': 'application/json; charset=utf-8', ...headers });
      res.end(JSON.stringify(body));
    };
    try {
      const url = new URL(req.url ?? '/', 'https://clone90.local');
      const route = url.pathname;
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { ...BASE_HEADERS, ...cors, 'Access-Control-Allow-Methods': 'GET, POST', 'Access-Control-Allow-Headers': 'Authorization, Content-Type',
          'Access-Control-Max-Age': '600', ...(req.headers['access-control-request-private-network'] === 'true' && { 'Access-Control-Allow-Private-Network': 'true' }) });
        return res.end();
      }
      if (route === '/' && req.method === 'GET') {
        res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'" });
        return res.end(HELP_PAGE);
      }
      if (route === SYNC_ROUTES.ca && req.method === 'GET') {
        res.writeHead(200, { ...BASE_HEADERS, 'Content-Type': 'application/x-x509-ca-cert', 'Content-Disposition': 'attachment; filename="clone90-ca.crt"' });
        return res.end(getCa());
      }
      if (route === SYNC_ROUTES.pair) {
        if (req.method !== 'POST') return send(405, { message: 'Méthode non autorisée' }, { Allow: 'POST' });
        const text = await readBody(req, MAX_PAIR_BODY);
        let code = null;
        try { const data = JSON.parse(text ?? ''); if (data && Object.keys(data).length === 1) code = data.code; } catch { code = null; }
        if (!isPairingCode(code)) return send(400, { message: 'Code invalide : 6 chiffres attendus.' });
        const result = await pairing.tryCode(code);
        if (result.token) return send(200, { token: result.token });
        return send(403, { error: result.error, message: result.error === 'no-code'
          ? 'Aucun code en cours sur le Mac : demandez-en un (« Associer un téléphone »).' : 'Code incorrect.' });
      }
      if (route !== SYNC_ROUTES.manifest && route !== SYNC_ROUTES.file) return send(404, { message: 'Introuvable' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { message: 'Méthode non autorisée' }, { Allow: 'GET, HEAD' });
      const token = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization ?? '')?.[1];
      if (!pairing.isValidToken(token)) return send(401, { error: 'not-paired', message: 'Ce téléphone n\'est pas (ou plus) associé à ce Mac.' });
      const dirs = await getDirs();
      const systemIds = await getSystemIds();
      if (route === SYNC_ROUTES.manifest) return send(200, { version: 1, files: await buildManifest({ ...dirs, systemIds }) });
      const shared = await resolveSharedFile(url.searchParams.get('path') ?? '', { ...dirs, systemIds });
      if (!shared) return send(404, { message: 'Fichier introuvable' });
      res.writeHead(200, { ...BASE_HEADERS, ...cors, 'Content-Type': 'application/octet-stream', 'Content-Length': shared.size, 'Access-Control-Expose-Headers': 'Content-Length' });
      if (req.method === 'HEAD' || shared.size === 0) return res.end();
      createReadStream(shared.file).on('error', () => res.destroy()).pipe(res);
    } catch (err) {
      console.error('Partage avec le téléphone :', err.message);
      if (!res.headersSent) send(500, { message: 'Erreur interne' });
      else res.destroy();
    }
  };
}

/** systems.json -> ids des machines. */
export async function readSystemIds(root) {
  const data = JSON.parse(await readFile(join(root, 'systems.json'), 'utf8'));
  return data.systems.map((s) => s.id);
}

/**
 * Démarre le serveur HTTPS de partage.
 * @param {{tls: {key: string, cert: string}, port: number, host?: string, handler: Function}} options
 * @returns {Promise<https.Server>} @throws {Error} port occupé
 */
export function startSyncServer({ tls, port, host = '0.0.0.0', handler }) {
  return new Promise((resolve, reject) => {
    const server = https.createServer({ key: tls.key, cert: tls.cert }, handler);
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(server); });
  });
}
