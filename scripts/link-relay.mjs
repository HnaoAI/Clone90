// Relais du Mac pour « Télécharger depuis une page » (T34) : lit la page donnée par la personne et télécharge les fichiers choisis
// dans roms/<machine>/ ou bios/. Un navigateur ne peut pas lire une page d'un autre site (CORS) : le serveur local le fait à sa place.
// Dépend de js/link-finder.js (analyse, contrôle des choix), sans dépendance npm. Branché par settings-api.mjs (routes api/links...).
// INVARIANT (sécurité, anti-SSRF) : seules des adresses http(s) PUBLIQUES sont contactées. Chaque nom d'hôte est résolu ici, TOUTES ses
//   adresses doivent être publiques, et la connexion est faite vers l'adresse vérifiée (option `lookup` figée) : pas de DNS rebinding.
//   Chaque redirection est vérifiée de la même façon (5 au plus). Tailles limitées pendant la lecture, délai maximal, aucun cookie ni identifiant.
// INVARIANT : jamais d'écrasement (fichier présent = « déjà présent »), écriture dans un fichier temporaire puis renommage.
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { checkDownloadItem, checkPageAddress, formatLinksSummary, fileNameFromDisposition, fileNameFromUrl } from '../js/link-finder.js';
import { exploreSite } from '../js/link-explorer.js';

export { formatLinksSummary };

export const MAX_PAGE_BYTES = 2 * 1024 * 1024;
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;
export const MAX_ITEMS = 200;
export const MAX_REDIRECTS = 5;
export const PAGE_TIMEOUT_MS = 20_000;
/** Délai sans aucune donnée reçue pendant un téléchargement (un gros fichier peut prendre longtemps, mais pas rester muet). */
export const IDLE_TIMEOUT_MS = 60_000;
// T36 : identifiant d'un navigateur courant ; beaucoup de sites refusent d'office un identifiant inconnu (« Clone90 » recevait 403).
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

/** Erreur du relais avec un message français affichable. `code` : invalid-url, blocked-address, dns, http, too-big, not-html, network, timeout, redirects. */
export class RelayError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

// Plages IPv4 non publiques (RFC 6890 et suivantes) : [adresse, longueur du préfixe].
const BLOCKED_V4 = [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]];

const v4ToInt = (ip) => ip.split('.').reduce((n, p) => n * 256 + Number(p), 0);

function isBlockedV4(ip) {
  const n = v4ToInt(ip);
  return BLOCKED_V4.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(v4ToInt(base) / 2 ** (32 - bits)));
}

/** Les 8 groupes de 16 bits d'une adresse IPv6 valide (formes compressée et IPv4 finale comprises). */
function expandV6(ip) {
  let text = ip.split('%')[0].toLowerCase();
  const v4 = /(\d+\.\d+\.\d+\.\d+)$/.exec(text);
  if (v4) {
    const n = v4ToInt(v4[1]);
    text = `${text.slice(0, -v4[1].length)}${(Math.floor(n / 65536)).toString(16)}:${(n % 65536).toString(16)}`;
  }
  const [head, tail] = text.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail ? tail.split(':') : [];
  const fill = tail !== undefined ? Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((g) => parseInt(g, 16));
}

const groupsToV4 = (a, b) => `${a >> 8}.${a & 255}.${b >> 8}.${b & 255}`;

/**
 * Vrai si l'adresse IP n'est pas publique : boucle locale, réseau privé, lien local, CGNAT, multidiffusion, réservée, documentation,
 * et les adresses IPv4 cachées dans une IPv6 (::ffff:x, 64:ff9b::x, 2002:x::).
 * @param {string} ip adresse IPv4 ou IPv6 littérale
 * @returns {boolean} vrai aussi pour une valeur qui n'est pas une adresse IP
 */
export function isBlockedAddress(ip) {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedV4(ip);
  if (family !== 6) return true;
  const g = expandV6(ip);
  if (g.length !== 8 || g.some((x) => !Number.isInteger(x))) return true;
  if (g.slice(0, 7).every((x) => x === 0)) return true; // :: et ::1 (et ::x, IPv4 compatible, obsolète)
  if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) return isBlockedV4(groupsToV4(g[6], g[7]));
  if (g[0] === 0x64 && g[1] === 0xff9b) return isBlockedV4(groupsToV4(g[6], g[7])); // NAT64
  if (g[0] === 0x2002) return isBlockedV4(groupsToV4(g[1], g[2])); // 6to4
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 local unique
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 lien local
  if ((g[0] & 0xffc0) === 0xfec0) return true; // fec0::/10 site local (obsolète)
  if ((g[0] & 0xff00) === 0xff00) return true; // multidiffusion
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentation
  if (g[0] === 0x100 && g[1] === 0 && g[2] === 0 && g[3] === 0) return true; // 100::/64 rejet
  return false;
}

/**
 * Résout un nom d'hôte et vérifie TOUTES ses adresses.
 * @param {string} hostname nom ou adresse littérale (IPv6 entre crochets acceptée)
 * @param {{lookup?: Function, allowAddress?: (ip: string) => boolean}} [options] injectables pour les tests
 * @returns {Promise<{address: string, family: 4|6}>}
 * @throws {RelayError} dns, blocked-address
 */
export async function resolvePublicAddress(hostname, { lookup = dnsLookup, allowAddress = (ip) => !isBlockedAddress(ip) } = {}) {
  const host = hostname.replace(/^\[|\]$/g, '');
  let addresses;
  if (net.isIP(host)) addresses = [{ address: host, family: net.isIP(host) }];
  else {
    try { addresses = await lookup(host, { all: true, verbatim: true }); } catch { throw new RelayError('dns', 'Ce site est introuvable. Vérifie l\'adresse.'); }
  }
  if (!addresses?.length) throw new RelayError('dns', 'Ce site est introuvable. Vérifie l\'adresse.');
  if (addresses.some((a) => !allowAddress(a.address))) {
    throw new RelayError('blocked-address', 'Cette adresse mène à un appareil local ou privé : Clone90 ne la contacte pas.');
  }
  return { address: addresses[0].address, family: addresses[0].family };
}

/** Une requête GET vers une adresse déjà vérifiée, connexion figée sur `pinned`. Renvoie la réponse (corps non lu). */
function requestPinned(url, pinned, signal) {
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(url, {
      method: 'GET', signal, agent: false,
      headers: { 'User-Agent': USER_AGENT, Accept: '*/*', 'Accept-Language': 'fr,en;q=0.8', 'Accept-Encoding': 'identity' },
      // INVARIANT : la connexion va à l'adresse vérifiée, jamais à une nouvelle résolution DNS (anti DNS rebinding).
      lookup: (_host, opts, cb) => (opts?.all ? cb(null, [pinned]) : cb(null, pinned.address, pinned.family)),
    }, resolve);
    req.on('error', reject);
    req.end();
  });
}

/**
 * Ouvre une adresse publique en suivant au plus MAX_REDIRECTS redirections, chacune vérifiée.
 * @param {string} address adresse http(s)
 * @param {{signal?: AbortSignal, lookup?: Function, allowAddress?: Function}} [options]
 * @returns {Promise<{response: http.IncomingMessage, url: string}>} réponse 2xx, corps non lu ; `url` : adresse finale
 * @throws {RelayError}
 */
export async function openPublicUrl(address, options = {}) {
  let current = address;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const checked = checkPageAddress(current);
    if (!checked.ok || !/^https?:\/\//i.test(current)) throw new RelayError('invalid-url', checked.message ?? 'Adresse refusée.');
    const url = new URL(checked.url);
    const pinned = await resolvePublicAddress(url.hostname, options);
    let response;
    try { response = await requestPinned(url, pinned, options.signal); } catch (err) {
      if (options.signal?.aborted) throw new RelayError('timeout', 'Le site met trop de temps à répondre.');
      throw new RelayError('network', `Le site ne répond pas (${err.code ?? 'erreur réseau'}).`);
    }
    const status = response.statusCode ?? 0;
    if (status >= 300 && status < 400 && response.headers.location) {
      response.resume();
      try { current = new URL(response.headers.location, url).href; } catch { throw new RelayError('invalid-url', 'Redirection vers une adresse illisible.'); }
      continue;
    }
    if (status < 200 || status >= 300) {
      response.resume();
      throw new RelayError('http', `Le site a répondu « erreur ${status} ».`);
    }
    return { response, url: url.href };
  }
  throw new RelayError('redirects', 'Trop de redirections.');
}

/** Lit tout le corps en mémoire, au plus `max` octets. @throws {RelayError} too-big */
function readLimited(response, max) {
  const declared = Number(response.headers['content-length']);
  if (Number.isFinite(declared) && declared > max) {
    response.destroy();
    return Promise.reject(new RelayError('too-big', 'Cette page est trop grande pour être analysée.'));
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    response.on('data', (c) => {
      size += c.length;
      if (size > max) { response.destroy(); reject(new RelayError('too-big', 'Cette page est trop grande pour être analysée.')); } else chunks.push(c);
    });
    response.on('end', () => resolve(Buffer.concat(chunks)));
    response.on('error', () => reject(new RelayError('network', 'La lecture de la page a été interrompue.')));
  });
}

/** Signal d'une requête : délai propre, et arrêt demandé par la personne s'il y en a un (AbortSignal.any : Node 20+, sinon délai seul). */
function requestSignal(stop, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  return stop && AbortSignal.any ? AbortSignal.any([stop, timeout]) : timeout;
}

/** Lit une page web (2 Mo au plus). @returns {Promise<{url: string, html: string}>} @throws {RelayError} */
async function fetchPublicPage(address, options, stop) {
  const { response, url } = await openPublicUrl(address, { ...options, signal: requestSignal(stop, PAGE_TIMEOUT_MS) });
  const type = String(response.headers['content-type'] ?? '').toLowerCase();
  if (type && !/^(text\/|application\/(xhtml\+)?xml)/.test(type)) {
    response.destroy();
    throw new RelayError('not-html', 'Cette adresse n\'est pas une page web. Pour un fichier seul, donne l\'adresse de la page qui le propose.');
  }
  return { url, html: (await readLimited(response, MAX_PAGE_BYTES)).toString('utf8') };
}

/** Nom de fichier d'un lien sans nom (T36) : en-tête Content-Disposition, sinon dernier segment de l'adresse finale. Le corps n'est pas lu. */
async function probeName(address, options, stop) {
  const { response, url } = await openPublicUrl(address, { ...options, signal: requestSignal(stop, PAGE_TIMEOUT_MS) });
  response.destroy();
  return fileNameFromDisposition(response.headers['content-disposition']) ?? fileNameFromUrl(url);
}

/**
 * Analyse une page et, selon `depth`, les pages du même site qu'elle relie (T36, js/link-explorer.js). Chaque requête passe par openPublicUrl.
 * @param {string} address adresse saisie @param {object[]} systems machines de systems.json
 * @param {{depth?: number, signal?: AbortSignal, onProgress?: Function, limits?: object, lookup?: Function, allowAddress?: Function}} [options]
 *   `signal` : arrêt demandé (on rend ce qui a été trouvé)
 * @returns {Promise<{url: string, files: object[], truncated: boolean, stopped: boolean, stats: object}>}
 * @throws {RelayError} si la page de départ ne peut pas être lue
 */
export async function scanPage(address, systems, { depth = 0, signal, onProgress, limits, ...options } = {}) {
  const checked = checkPageAddress(address);
  if (!checked.ok) throw new RelayError('invalid-url', checked.message);
  return exploreSite({
    start: checked.url, systems, depth, signal, onProgress, limits,
    fetchPage: (url) => fetchPublicPage(url, options, signal),
    probe: (url) => probeName(url, options, signal),
  });
}

const exists = (p) => stat(p).then(() => true, () => false);

/** Écrit le corps dans `dest` via un fichier temporaire, au plus `max` octets ; supprime le temporaire en cas d'échec. @throws {RelayError} */
async function saveTo(response, dest, tmp, max) {
  const declared = Number(response.headers['content-length']);
  if (Number.isFinite(declared) && declared > max) { response.destroy(); throw new RelayError('too-big', 'Fichier trop gros.'); }
  let idle;
  try {
    await new Promise((resolve, reject) => {
      const out = createWriteStream(tmp, { flags: 'wx' });
      let size = 0;
      let last = Date.now();
      const fail = (err) => { response.unpipe(out); response.destroy(); out.destroy(); reject(err); };
      idle = setInterval(() => { if (Date.now() - last > IDLE_TIMEOUT_MS) fail(new RelayError('timeout', 'Le téléchargement s\'est arrêté.')); }, 1000);
      response.on('data', (c) => {
        last = Date.now();
        size += c.length;
        if (size > max) fail(new RelayError('too-big', 'Fichier trop gros.'));
      });
      response.on('aborted', () => fail(new RelayError('network', 'Le téléchargement a été interrompu.')));
      response.on('error', () => fail(new RelayError('network', 'Le téléchargement a été interrompu.')));
      out.on('error', () => fail(new RelayError('write', 'Écriture impossible dans le dossier.')));
      out.on('finish', () => (response.complete ? resolve() : reject(new RelayError('network', 'Le téléchargement a été interrompu.'))));
      response.pipe(out);
    });
    await rename(tmp, dest);
  } catch (err) {
    await unlink(tmp).catch(() => {});
    throw err;
  } finally { clearInterval(idle); }
}

/**
 * Télécharge les fichiers choisis, un par un.
 * @param {{url: string, target: string}[]} items `target` : id de machine ou 'bios'
 * @param {{romsDir: string, biosDir: string, systems: object[], onProgress?: Function, maxFileBytes?: number, lookup?: Function, allowAddress?: Function}} options
 * @returns {Promise<{downloaded: string[], present: string[], failed: {name: string, message: string}[]}>} noms relatifs (`amiga/jeu.adf`, `bios/x`)
 */
export async function downloadLinks(items, { romsDir, biosDir, systems, onProgress = () => {}, maxFileBytes = MAX_FILE_BYTES, ...options }) {
  const summary = { downloaded: [], present: [], failed: [] };
  const list = items.slice(0, MAX_ITEMS);
  for (const [i, item] of list.entries()) {
    const checked = checkDownloadItem(item, systems);
    const label = checked.ok ? `${checked.target}/${checked.name}` : String(item?.url ?? '?').split('/').pop();
    onProgress({ phase: 'downloading', done: i, total: list.length, name: label });
    if (!checked.ok) { summary.failed.push({ name: label, message: checked.message }); continue; }
    const dir = checked.target === 'bios' ? biosDir : join(romsDir, checked.target);
    const dest = join(dir, checked.name);
    if (await exists(dest)) { summary.present.push(label); continue; }
    try {
      await mkdir(dir, { recursive: true });
      const { response } = await openPublicUrl(checked.url, options);
      // T36 : un lien sans nom a été nommé à l'analyse (Content-Disposition) ; le nom écrit reste celui vérifié par checkDownloadItem.
      await saveTo(response, dest, join(dir, `.${checked.name}.clone90-part`), maxFileBytes);
      summary.downloaded.push(label);
    } catch (err) {
      summary.failed.push({ name: label, message: err instanceof RelayError ? err.message : 'Téléchargement impossible.' });
    }
  }
  onProgress({ phase: 'downloading', done: list.length, total: list.length });
  return summary;
}
