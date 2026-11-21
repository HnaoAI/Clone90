// Serveur de partage Mac <-> téléphone (T43, T44) : HTTPS sur le réseau local (port 8443), réservé aux téléphones associés.
// Routes : GET / (page d'aide), GET /clone90-ca.crt (autorité à installer sur le téléphone), T51 : GET /sync/hello (« je suis un Mac
// Clone90 » + nom .local, sans jeton, pour que le téléphone trouve le Mac), POST /sync/pair ({password} -> {token}),
// GET /sync/manifest (liste des jeux, pochettes, logos et BIOS, + `uploads` : réception permise), GET /sync/file?path=... (un fichier),
// T44 : POST /sync/upload?path=roms/<machine>/<fichier> (un jeu ou une pochette du téléphone, voir sync-upload.mjs). Démarré par sync-api.mjs.
// Dépend de js/sync-plan.js (fichiers partagés, partagé avec le téléphone), sync-pairing.mjs (mot de passe, jetons), sync-upload.mjs, local-settings.mjs.
// INVARIANT (sécurité, décisions de Hicham du 2026-11-15) : ce serveur n'efface et ne télécharge RIEN ; il ne sert que les fichiers des
//   dossiers des jeux et des BIOS acceptés par `syncTargetPath` (chemin réel vérifié : un lien qui sort du dossier est refusé) ; sa SEULE
//   écriture est l'ajout d'un jeu ou d'une pochette (T44), seulement si la personne a coché « Accepter les jeux du téléphone » sur le Mac, sans jamais
//   remplacer un fichier ; liste, fichiers et envoi exigent le jeton d'un téléphone associé (Authorization: Bearer) ; aucune route api/ ici.
import https from 'node:https';
import { createReadStream } from 'node:fs';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, sep } from 'node:path';
import { syncTargetPath, SYNC_ROUTES, isSyncPassword, PASSWORD_MAX_LENGTH } from '../js/sync-plan.js';
import { receiveUpload } from './sync-upload.mjs';
import { ROMS_DIR, BIOS_DIR } from '../js/config.js';
import { LOGOS_DIR } from '../js/logo-source.js';

const BASE_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
/** Corps de POST /sync/pair : `{"password": "..."}` (128 caractères au plus, jusqu'à 4 octets chacun, échappés). */
const MAX_PAIR_BODY = 64 + PASSWORD_MAX_LENGTH * 12;

/**
 * Texte de la page d'aide (ouverte sur le téléphone pour récupérer le certificat). T51 : guide pas à pas pour Android, et vérification finale
 * (la page s'ouvre sans avertissement une fois le certificat installé).
 */
export const HELP_PAGE = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clone90 - partage</title><style>body{font:18px/1.5 sans-serif;margin:24px;max-width:40em}a{display:inline-block;padding:12px 16px;background:#1239b0;color:#fff;border-radius:24px;text-decoration:none}li{margin:0 0 12px}</style></head>
<body><h1>Clone90 : partage avec le téléphone</h1>
<p>Ce Mac partage ses jeux, pochettes et logos avec les téléphones qui connaissent son mot de passe. À faire une seule fois sur le téléphone :</p>
<ol><li>Téléchargez le certificat de ce Mac :<br><a href="${SYNC_ROUTES.ca.slice(1)}" download="clone90-ca.crt">Télécharger le certificat</a></li>
<li>Ouvrez les <strong>Paramètres</strong> d'Android, cherchez « <strong>certificat</strong> » (loupe en haut), puis choisissez
« <strong>Certificat CA</strong> » (ou : Sécurité et confidentialité &gt; Plus de paramètres de sécurité &gt; Chiffrement et identifiants &gt;
Installer un certificat &gt; Certificat CA).</li>
<li>Touchez « Installer quand même », déverrouillez le téléphone, puis choisissez <code>clone90-ca.crt</code> dans « Téléchargements ».</li>
<li>Vérifiez : fermez cet onglet et rouvrez cette adresse. S'il n'y a plus d'avertissement « Votre connexion n'est pas privée », c'est bon.</li>
<li>Revenez dans Clone90, « Mes fichiers », « Synchroniser avec le Mac » : saisissez seulement le mot de passe choisi sur le Mac.</li></ol>
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
 * @param {{pairing: {tryPassword: Function, isValidToken: Function, acceptUploads?: boolean}, getDirs: () => Promise<{romsDir: string, biosDir: string}>,
 *   getSystemIds: () => Promise<string[]>, getCa: () => string, getName?: () => string|null, onUploaded?: () => void,
 *   getFreeBytes?: (dir: string) => Promise<number>, now?: () => number}} options
 *   `getName` (T51) : nom `<nom>.local` du Mac annoncé par /sync/hello ; `onUploaded` (T44) : appelé après chaque fichier reçu (régénère
 *   games.json) ; `getFreeBytes` : injectable pour les tests
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>}
 */
export function createSyncHandler({ pairing, getDirs, getSystemIds, getCa, getName = () => null, onUploaded = () => {}, getFreeBytes, now = Date.now }) {
  let uploading = false; // T44 : un seul envoi à la fois
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
      if (route === SYNC_ROUTES.hello && req.method === 'GET') return send(200, { app: 'clone90', version: 1, name: getName() ?? null });
      if (route === SYNC_ROUTES.pair) {
        if (req.method !== 'POST') return send(405, { message: 'Méthode non autorisée' }, { Allow: 'POST' });
        const text = await readBody(req, MAX_PAIR_BODY);
        let password = null;
        try { const data = JSON.parse(text ?? ''); if (data && Object.keys(data).length === 1) password = data.password; } catch { password = null; }
        if (!isSyncPassword(password)) return send(400, { message: 'Mot de passe invalide : 6 caractères au moins.' });
        const result = await pairing.tryPassword(password);
        if (result.token) return send(200, { token: result.token });
        if (result.error === 'no-password') {
          return send(409, { error: 'no-password', message: 'Aucun mot de passe n\'est encore choisi sur le Mac : « Dossiers », « Partager avec le téléphone », « Choisir le mot de passe ».' });
        }
        if (result.error === 'locked') {
          const minutes = Math.max(1, Math.ceil((result.retryAt - now()) / 60000));
          return send(429, { error: 'locked', message: `Trop de mauvais mots de passe : réessayez dans ${minutes} min.` }, { 'Retry-After': String(minutes * 60) });
        }
        const left = result.triesLeft;
        return send(403, { error: 'wrong-password', message: `Mot de passe incorrect. Encore ${left} essai${left > 1 ? 's' : ''} avant un blocage de 15 minutes.` });
      }
      if (route === SYNC_ROUTES.upload) return await handleUpload(req, url, send);
      if (route !== SYNC_ROUTES.manifest && route !== SYNC_ROUTES.file) return send(404, { message: 'Introuvable' });
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, { message: 'Méthode non autorisée' }, { Allow: 'GET, HEAD' });
      if (!hasToken(req)) return send(401, NOT_PAIRED);
      const dirs = await getDirs();
      const systemIds = await getSystemIds();
      if (route === SYNC_ROUTES.manifest) return send(200, { version: 1, uploads: pairing.acceptUploads === true, files: await buildManifest({ ...dirs, systemIds }) });
      const shared = await resolveSharedFile(url.searchParams.get('path') ?? '', { ...dirs, systemIds });
      if (!shared) return send(404, { message: 'Fichier introuvable' });
      res.writeHead(200, { ...BASE_HEADERS, ...cors, 'Content-Type': 'application/octet-stream', 'Content-Length': shared.size, 'Access-Control-Expose-Headers': 'Content-Length' });
      if (req.method === 'HEAD' || shared.size === 0) return res.end();
      createReadStream(shared.file).on('error', () => res.destroy()).pipe(res);
    } catch (err) {
      if (!req.complete) res.setHeader?.('Connection', 'close');
      console.error('Partage avec le téléphone :', err.message);
      if (!res.headersSent) send(500, { message: 'Erreur interne' });
      else res.destroy();
    }
  };

  /**
   * T44 : un jeu ou une pochette envoyés par le téléphone. Un refus avant lecture du corps ferme la connexion (le reste du fichier n'est pas lu).
   * @returns {Promise<void>}
   */
  async function handleUpload(req, url, send) {
    const reply = (status, body) => {
      if (!req.complete) { send(status, body, { Connection: 'close' }); req.resume(); return undefined; }
      return send(status, body);
    };
    if (req.method !== 'POST') return reply(405, { message: 'Méthode non autorisée' });
    if (!hasToken(req)) return reply(401, NOT_PAIRED);
    if (pairing.acceptUploads !== true) return reply(403, { error: 'uploads-off', message: UPLOADS_OFF });
    if (uploading) return reply(429, { error: 'busy', message: 'Un autre envoi est en cours.' });
    uploading = true;
    try {
      const [{ romsDir }, systemIds] = await Promise.all([getDirs(), getSystemIds()]);
      const result = await receiveUpload(req, { path: url.searchParams.get('path') ?? '', romsDir, systemIds, ...(getFreeBytes && { getFreeBytes }) });
      if (result.status === 201) {
        console.log(`Partage : fichier reçu du téléphone : ${result.body.path}`);
        try { onUploaded(); } catch { /* la liste des jeux sera refaite au prochain ajout */ }
      }
      return reply(result.status, result.body);
    } finally {
      uploading = false;
    }
  }

  /** Vrai si la requête porte le jeton d'un téléphone associé. */
  function hasToken(req) {
    return pairing.isValidToken(/^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization ?? '')?.[1]);
  }
}

const NOT_PAIRED = { error: 'not-paired', message: 'Ce téléphone n\'est pas (ou plus) associé à ce Mac.' };
/** T44 : réponse quand la réception n'est pas permise sur le Mac. */
export const UPLOADS_OFF = 'Le Mac n\'accepte pas les jeux du téléphone : sur le Mac, « Dossiers », « Partager avec le téléphone », « Accepter les jeux du téléphone ».';

/** systems.json -> ids des machines. */
export async function readSystemIds(root) {
  const data = JSON.parse(await readFile(join(root, 'systems.json'), 'utf8'));
  return data.systems.map((s) => s.id);
}

/**
 * T51 : vrai si l'erreur TLS d'une connexion vient d'un appareil qui REFUSE le certificat du Mac (alerte « certificat inconnu », « autorité
 * inconnue »...), c'est-à-dire, le plus souvent, d'un téléphone où le certificat n'est pas installé.
 * @param {Error & {code?: string}} err @returns {boolean}
 */
export function isCertificateRejection(err) {
  const text = `${err?.code ?? ''} ${err?.message ?? ''}`;
  return /alert (number )?(42|43|44|45|46|48)\b|certificate[ _]unknown|unknown[ _]ca|bad[ _]certificate|ALERT_(CERTIFICATE_UNKNOWN|UNKNOWN_CA|BAD_CERTIFICATE)/i.test(text);
}

/**
 * Démarre le serveur HTTPS de partage.
 * @param {{tls: {key: string, cert: string}, port: number, host?: string, handler: Function, onCertificateRejected?: (address: string) => void}} options
 *   `onCertificateRejected` (T51) : un appareil a refusé le certificat (adresse IPv4 de l'appareil)
 * @returns {Promise<https.Server>} @throws {Error} port occupé
 */
export function startSyncServer({ tls, port, host = '0.0.0.0', handler, onCertificateRejected = () => {} }) {
  return new Promise((resolve, reject) => {
    // T44 : un jeu de 1 Go par le Wi-Fi peut dépasser les 5 minutes par défaut de Node (requestTimeout) : 1 heure.
    const server = https.createServer({ key: tls.key, cert: tls.cert, requestTimeout: 60 * 60 * 1000 }, handler);
    server.on('tlsClientError', (err, socket) => {
      if (isCertificateRejection(err)) onCertificateRejected(String(socket?.remoteAddress ?? '').replace(/^::ffff:/, ''));
    });
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(server); });
  });
}
