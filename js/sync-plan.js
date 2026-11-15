// Synchronisation Mac -> téléphone par le Wi-Fi (T43) : règles PURES partagées par le serveur de partage du Mac (scripts/sync-server.mjs)
// et par le téléphone (js/sync-client.js) : fichiers partagés et leur chemin sur le téléphone, adresse du Mac, code d'appairage,
// liste reçue du Mac, plan de copie (ce qu'il faut copier, remplacer ou retirer) et message de fin.
// Dépend de config.js (ROMS_DIR, BIOS_DIR) et logo-source.js (LOGOS_DIR). Aucun accès réseau ni disque ici.
// INVARIANT : le téléphone ne retire QUE des fichiers venus du Mac par cette synchronisation (liste `synced`) ; un fichier importé à la main
//   (« Mes fichiers », dossier, page web, pochette cherchée par le téléphone) n'est jamais remplacé ni effacé.
import { ROMS_DIR, BIOS_DIR } from './config.js';
import { LOGOS_DIR } from './logo-source.js';

/** Port du serveur de partage du Mac (HTTPS), distinct du serveur de Clone90 (8080, limité au Mac). */
export const SYNC_PORT = 8443;
/** Adresses du serveur de partage, relatives à `https://<Mac>:<port>/`. */
export const SYNC_ROUTES = Object.freeze({ pair: '/sync/pair', manifest: '/sync/manifest', file: '/sync/file', ca: '/clone90-ca.crt' });
/** Durée de validité d'un code d'appairage affiché sur le Mac. */
export const PAIRING_CODE_TTL_MS = 5 * 60 * 1000;
/** Nombre d'essais de code permis avant que le code soit annulé (il faut en demander un autre sur le Mac). */
export const PAIRING_MAX_TRIES = 5;
/** Nombre maximal de fichiers dans la liste du Mac (au-delà, la liste est refusée par le téléphone). */
export const MAX_MANIFEST_FILES = 50000;

const NAME_OK = (s) => typeof s === 'string' && s.length > 0 && s.length <= 255 && !s.startsWith('.') && !/[\u0000-\u001f\u007f\\]/.test(s);

/**
 * Chemin sur le téléphone d'un fichier partagé par le Mac, ou null s'il n'est pas partagé.
 * Partagés : `roms/<machine>/<fichier>` (un niveau de sous-dossier est lu, comme le générateur, et rangé À PLAT comme « Choisir le dossier
 * des jeux », T38), `roms/clone90-logos/<id>.svg` (logos, T29) et `bios/<fichier>`. Jamais de fichier caché, de `..` ni de machine inconnue.
 * @param {string} path chemin relatif sur le Mac, séparateur `/`
 * @param {Iterable<string>} systemIds ids de systems.json
 * @returns {string|null}
 */
export function syncTargetPath(path, systemIds) {
  if (typeof path !== 'string' || path.length > 1024) return null;
  const parts = path.split('/');
  if (!parts.every(NAME_OK)) return null;
  const ids = new Set(systemIds);
  if (parts[0] === BIOS_DIR && parts.length === 2) return path;
  if (parts[0] !== ROMS_DIR || parts.length < 3 || parts.length > 4) return null;
  if (parts[1] === LOGOS_DIR) return parts.length === 3 && /^[a-z0-9]+\.svg$/.test(parts[2]) ? path : null;
  if (!ids.has(parts[1])) return null;
  return `${ROMS_DIR}/${parts[1]}/${parts[parts.length - 1]}`;
}

const PRIVATE_V4 = [/^10\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./];
const isIPv4 = (h) => /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.test(h) && h.split('.').every((n) => Number(n) <= 255);

/**
 * Adresse du Mac saisie sur le téléphone -> origine HTTPS du serveur de partage.
 * Acceptées : une adresse IPv4 PRIVÉE (192.168.x.x, 10.x.x.x, 172.16-31.x.x) ou un nom `<nom>.local`, avec ou sans `https://` et port.
 * Refusées : `http://`, adresse publique, chemin, identifiants : le téléphone ne parle qu'à un Mac de son réseau, en HTTPS.
 * @param {string} text @returns {string|null} ex. `https://192.168.1.20:8443`
 */
export function normalizeMacAddress(text) {
  if (typeof text !== 'string') return null;
  let raw = text.trim().toLowerCase();
  if (!raw || raw.length > 255) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(raw)) {
    if (!raw.startsWith('https://')) return null;
    raw = raw.slice('https://'.length);
  }
  raw = raw.replace(/\/+$/, '');
  const m = /^([a-z0-9.-]+)(?::(\d{1,5}))?$/.exec(raw);
  if (!m) return null;
  const [, host, portText] = m;
  const port = portText === undefined ? SYNC_PORT : Number(portText);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return null;
  const okHost = isIPv4(host) ? PRIVATE_V4.some((r) => r.test(host)) : /^[a-z0-9]([a-z0-9-]{0,62})\.local$/.test(host);
  return okHost ? `https://${host}:${port}` : null;
}

/** Vrai pour un code d'appairage : 6 chiffres. */
export const isPairingCode = (code) => typeof code === 'string' && /^\d{6}$/.test(code);

/**
 * Liste reçue du Mac (`{files: [{path, size, mtime}]}`), contrôlée : entrées mal formées ou non partagées ignorées, doublons de chemin
 * sur le téléphone gardés une fois (premier vu).
 * @param {unknown} body @param {Iterable<string>} systemIds
 * @returns {{path: string, target: string, size: number, mtime: number}[]|null} null si la réponse n'a pas la forme attendue
 */
export function readManifest(body, systemIds) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.files) || body.files.length > MAX_MANIFEST_FILES) return null;
  const ids = [...systemIds];
  const seen = new Set();
  const out = [];
  for (const f of body.files) {
    if (!f || typeof f !== 'object' || !Number.isSafeInteger(f.size) || f.size < 0 || !Number.isFinite(f.mtime)) continue;
    const target = syncTargetPath(f.path, ids);
    if (!target || seen.has(target)) continue;
    seen.add(target);
    out.push({ path: f.path, target, size: f.size, mtime: f.mtime });
  }
  return out;
}

/** Ordre de copie : logos, images (pochettes), BIOS, puis les jeux du plus petit au plus gros (le plus de jeux possible si la place manque). */
function copyRank(entry) {
  if (entry.target.startsWith(`${ROMS_DIR}/${LOGOS_DIR}/`)) return 0;
  if (/\.(png|jpe?g|webp)$/i.test(entry.target)) return 1;
  if (entry.target.startsWith(`${BIOS_DIR}/`)) return 2;
  return 3;
}

/**
 * Plan de synchronisation (rien n'est fait ici).
 * @param {{remote: {path: string, target: string, size: number, mtime: number}[], local: {path: string, size: number}[],
 *   synced: Record<string, {size: number, mtime: number}>}} input
 *   `remote` : liste du Mac (readManifest) ; `local` : fichiers de la bibliothèque du téléphone ; `synced` : fichiers venus du Mac lors des
 *   synchronisations précédentes (chemin sur le téléphone -> taille et date du Mac)
 * @returns {{copy: object[], replace: object[], remove: string[], kept: number}} `copy` : absents du téléphone ; `replace` : venus du Mac et changés
 *   sur le Mac ; `remove` : venus du Mac et retirés du Mac ; `kept` : fichiers du téléphone de même chemin, gardés tels quels
 */
export function planSync({ remote, local, synced = {} }) {
  const localPaths = new Set(local.map((e) => e.path));
  const remoteTargets = new Set(remote.map((e) => e.target));
  const copy = [];
  const replace = [];
  let kept = 0;
  for (const entry of remote) {
    const previous = Object.hasOwn(synced, entry.target) ? synced[entry.target] : null;
    if (!localPaths.has(entry.target)) copy.push(entry);
    else if (!previous) kept += 1; // fichier mis par la personne sur le téléphone : jamais remplacé
    else if (previous.size !== entry.size || previous.mtime !== entry.mtime) replace.push(entry);
  }
  const remove = Object.keys(synced).filter((t) => !remoteTargets.has(t) && localPaths.has(t)).sort();
  const order = (a, b) => copyRank(a) - copyRank(b) || a.size - b.size || (a.target < b.target ? -1 : 1);
  return { copy: copy.sort(order), replace: replace.sort(order), remove, kept };
}

/**
 * Message de fin d'une synchronisation.
 * @param {{copied?: number, replaced?: number, removed?: number, failed?: number, noSpace?: number, quiet?: boolean}} result
 *   `noSpace` : fichiers non copiés faute de place ; `quiet` (synchronisation automatique) : null si rien n'a changé ni échoué
 * @returns {string|null}
 */
export function describeSyncResult({ copied = 0, replaced = 0, removed = 0, failed = 0, noSpace = 0, quiet = false }) {
  const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;
  const parts = [];
  if (copied) parts.push(`${plural(copied, 'fichier copié', 'fichiers copiés')} depuis le Mac`);
  if (replaced) parts.push(plural(replaced, 'fichier mis à jour', 'fichiers mis à jour'));
  if (removed) parts.push(plural(removed, 'fichier retiré (supprimé sur le Mac)', 'fichiers retirés (supprimés sur le Mac)'));
  if (noSpace) parts.push(`${plural(noSpace, 'fichier non copié', 'fichiers non copiés')} : plus assez de place sur ce téléphone`);
  if (failed) parts.push(plural(failed, 'fichier en échec', 'fichiers en échec'));
  if (!parts.length) return quiet ? null : 'Synchronisation : ce téléphone a déjà tous les fichiers du Mac.';
  return `Synchronisation : ${parts.join(' ; ')}.`;
}
