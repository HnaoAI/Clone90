// Analyse d'une page web pour l'écran « Télécharger depuis une page » (T34) : liens de la page, fichiers de types reconnus, machine devinée.
// Fonctions pures, sans dépendance : partagées par le navigateur (téléphone, js/link-download.js) et le relais du Mac (scripts/link-relay.mjs).
// INVARIANT (CLAUDE.md règle 2) : aucune liste de machines ni d'extensions ici, tout vient de systems.json (extensions, noms de BIOS, id et noms).
// INVARIANT (T34) : outil neutre, aucun site écrit dans le code ; seule l'adresse donnée par la personne est lue.

/** Nombre maximal de fichiers proposés pour une page (une page énorme ne doit pas bloquer l'écran). */
export const MAX_FILES = 500;
/** Longueur maximale d'une adresse acceptée. */
export const MAX_URL_LENGTH = 2048;

const ENTITIES = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };

/** Décode les entités HTML courantes d'une valeur d'attribut (`&amp;`, `&#38;`, `&#x26;`). */
export function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[code.toLowerCase()] ?? all;
  });
}

/**
 * Vérifie l'adresse saisie. Sans protocole, `https://` est ajouté.
 * @param {string} text
 * @returns {{ok: true, url: string} | {ok: false, message: string}}
 */
export function checkPageAddress(text) {
  const raw = typeof text === 'string' ? text.trim() : '';
  if (!raw) return { ok: false, message: 'Saisis l\'adresse d\'une page web.' };
  if (raw.length > MAX_URL_LENGTH) return { ok: false, message: 'Cette adresse est trop longue.' };
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  let url;
  try { url = new URL(withScheme); } catch { return { ok: false, message: 'Cette adresse n\'est pas valide.' }; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { ok: false, message: 'Seules les adresses http:// et https:// sont acceptées.' };
  if (url.username || url.password) return { ok: false, message: 'Une adresse avec identifiant ou mot de passe n\'est pas acceptée.' };
  if (!url.hostname) return { ok: false, message: 'Cette adresse n\'est pas valide.' };
  url.hash = '';
  return { ok: true, url: url.href };
}

/**
 * Liens absolus http(s) d'une page, sans ancre, sans doublon, balise <base> respectée. Lus dans (T36) : attributs href et src, attributs data-*
 * dont le nom parle d'adresse ou de fichier (data-url, data-href, data-file, data-download...), redirection <meta refresh>, et adresses
 * absolues écrites en clair dans le texte ou les scripts (y compris `https:\/\/` échappé en JSON).
 * @param {string} html @param {string} pageUrl adresse finale de la page (après redirections)
 * @returns {string[]} attributs d'abord (ordre de la page), puis adresses en clair
 */
export function extractLinks(html, pageUrl) {
  const text = String(html ?? '');
  let base = pageUrl;
  const baseTag = /<base\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/i.exec(text);
  if (baseTag) { try { base = new URL(decodeEntities(baseTag[1] ?? baseTag[2] ?? baseTag[3]), pageUrl).href; } catch { /* base illisible : on garde la page */ } }
  const seen = new Set();
  const links = [];
  const add = (raw) => {
    const value = decodeEntities(raw.trim());
    if (!value) return;
    let url;
    try { url = new URL(value, base); } catch { return; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
    url.hash = '';
    if (!seen.has(url.href)) { seen.add(url.href); links.push(url.href); }
  };
  const body = text.replace(/<base\b[^>]*>/gi, '');
  const attr = /\s(?:href|src|data-[\w-]*(?:url|href|src|file|download|link)[\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/gi;
  for (const m of body.matchAll(attr)) add(m[1] ?? m[2] ?? m[3]);
  for (const m of body.matchAll(/<meta\b[^>]*http-equiv\s*=\s*["']?refresh[^>]*content\s*=\s*["'][^"']*?url\s*=\s*([^"'>\s]+)/gi)) add(m[1]);
  for (const m of body.replace(/\\\//g, '/').matchAll(/https?:\/\/[^\s"'<>()\\`]+/gi)) add(m[0].replace(/[.,;:!?]+$/, ''));
  return links;
}

/** Nom de fichier d'une adresse : dernier segment du chemin, décodé ; null s'il est vide ou illisible. */
export function fileNameFromUrl(url) {
  let path;
  try { path = new URL(url).pathname; } catch { return null; }
  const last = path.split('/').pop() ?? '';
  let name;
  try { name = decodeURIComponent(last); } catch { return null; }
  // eslint-disable-next-line no-control-regex
  name = name.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().replace(/^\.+/, '');
  return name || null;
}

/** Extension en minuscules, sans le point ; '' s'il n'y en a pas. */
export const extensionOf = (name) => (/\.([^.]+)$/.exec(name)?.[1] ?? '').toLowerCase();

/** Forme normalisée d'un mot pour comparer les noms : minuscules, lettres et chiffres seulement (« Mega-CD » -> « megacd »). */
const normalize = (s) => String(s).toLowerCase().normalize('NFD').replace(/[^a-z0-9]/g, '');

/**
 * Machine devinée d'après le chemin de l'adresse, parmi les machines candidates : un mot du chemin (ou 2 ou 3 mots collés) égal à l'id ou au nom
 * normalisé d'une machine. Mots entiers seulement (« genesis » ne donne pas « nes ») ; le plus long gagne (« game boy color » avant « game boy »).
 * @param {string} url @param {object[]} candidates machines de systems.json
 * @returns {string|null} id de la machine, ou null si rien ne permet de choisir
 */
export function guessSystemFromPath(url, candidates) {
  let path;
  try { path = decodeURIComponent(new URL(url).pathname); } catch { try { path = new URL(url).pathname; } catch { return null; } }
  const words = path.toLowerCase().normalize('NFD').split(/[^a-z0-9]+/).filter(Boolean);
  const grams = new Set();
  for (let i = 0; i < words.length; i++) {
    for (let n = 1; n <= 3 && i + n <= words.length; n++) grams.add(words.slice(i, i + n).join(''));
  }
  let best = null;
  let bestLength = 0;
  for (const s of candidates) {
    for (const hint of [normalize(s.id), normalize(s.name)]) {
      if (hint && grams.has(hint) && hint.length > bestLength) { best = s.id; bestLength = hint.length; }
    }
  }
  return best;
}

/**
 * Nature d'un fichier pour Clone90.
 * Un nom de BIOS déclaré dans systems.json (sans tenir compte de la casse) est un BIOS, même si son extension est aussi celle d'un jeu (neogeo.zip).
 * @param {string} url @param {object[]} systems @param {string|null} [name] nom du fichier, si l'adresse ne le donne pas (T36 : Content-Disposition)
 * @returns {{name: string, kind: 'bios', target: 'bios', candidates: []} | {name: string, kind: 'rom', target: string|null, candidates: string[]} | null}
 *   `target` : machine devinée (null : à choisir) ; `candidates` : machines qui acceptent cette extension ; null si le type n'est pas reconnu
 */
export function classifyFile(url, systems, name = fileNameFromUrl(url)) {
  if (!name) return null;
  const declared = systems.flatMap((s) => s.bios ?? []).map((b) => b.file).filter((f) => typeof f === 'string');
  const bios = declared.find((f) => f.toLowerCase() === name.toLowerCase());
  if (bios) return { name: bios, kind: 'bios', target: 'bios', candidates: [] };
  const ext = extensionOf(name);
  if (!ext) return null;
  const candidates = systems.filter((s) => (s.extensions ?? []).some((e) => e.toLowerCase() === ext));
  if (!candidates.length) return null;
  const target = candidates.length === 1 ? candidates[0].id : guessSystemFromPath(url, candidates);
  return { name, kind: 'rom', target, candidates: candidates.map((s) => s.id) };
}

/** Nettoie un nom de fichier venu d'un site : dernier segment, sans caractère de contrôle ni point initial. @returns {string|null} */
export function sanitizeName(name) {
  // eslint-disable-next-line no-control-regex
  const cleaned = String(name ?? '').split(/[\\/]/).pop().replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/^\.+/, '');
  return cleaned && cleaned.length <= 255 ? cleaned : null;
}

/**
 * Nom de fichier d'un en-tête Content-Disposition (T36) : `filename*=UTF-8''...` d'abord, sinon `filename="..."`.
 * @param {string|undefined} header @returns {string|null} nom nettoyé, ou null
 */
export function fileNameFromDisposition(header) {
  const text = String(header ?? '');
  const star = /filename\*\s*=\s*(?:[\w-]+)?'[^']*'([^;]+)/i.exec(text);
  if (star) { try { return sanitizeName(decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''))); } catch { /* encodage illisible : on essaie filename= */ } }
  const plain = /filename\s*=\s*(?:"([^"]*)"|([^;]+))/i.exec(text);
  return plain ? sanitizeName((plain[1] ?? plain[2]).trim()) : null;
}

/** Extensions des pages web (liens à explorer, T36). Un dernier segment sans point est aussi une page. */
const PAGE_EXTENSIONS = ['html', 'htm', 'shtml', 'php', 'asp', 'aspx', 'jsp', 'cgi'];
const sameSite = (a, b) => a.replace(/^www\./, '') === b.replace(/^www\./, '');

/**
 * Vrai si le lien mène sans doute à une autre page du même site (à explorer, T36) : même site (www. ignoré), dernier segment sans extension ou
 * d'une extension de page. Les fichiers (images, styles, scripts, documents) ne sont jamais explorés.
 * @param {string} url @param {string} startUrl adresse donnée par la personne
 */
export function isPageLink(url, startUrl) {
  let u; let s;
  try { u = new URL(url); s = new URL(startUrl); } catch { return false; }
  if (!sameSite(u.hostname, s.hostname)) return false;
  const last = u.pathname.split('/').pop() ?? '';
  return !last.includes('.') || PAGE_EXTENSIONS.includes(extensionOf(last));
}

/**
 * Vrai si le lien ressemble à un téléchargement sans nom de fichier (`/download?id=12`, `/get/34`, `/dl/...`) : à interroger pour lire le nom (T36).
 * @param {string} url
 */
export function isDownloadLike(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  return /(^|[^a-z])(download|downloads|dl|get|getfile|file|files|fetch|telecharger|telechargement)([^a-z]|$)/i.test(`${u.pathname}?${u.search}`);
}

/**
 * Fichiers téléchargeables d'une page : liens dont le type est reconnu par Clone90, au plus MAX_FILES.
 * @param {string} html @param {string} pageUrl @param {object[]} systems machines de systems.json
 * @returns {{files: {url: string, name: string, kind: 'rom'|'bios', target: string|null, candidates: string[]}[], truncated: boolean}}
 */
export function findDownloadableFiles(html, pageUrl, systems) {
  const files = [];
  for (const url of extractLinks(html, pageUrl)) {
    const info = classifyFile(url, systems);
    if (info) files.push({ url, ...info });
  }
  return { files: files.slice(0, MAX_FILES), truncated: files.length > MAX_FILES };
}

/**
 * Vérifie un choix de téléchargement (relais du Mac et téléphone) : la machine accepte l'extension, ou le nom est un BIOS déclaré.
 * @param {{url: string, target: string, name?: string}} item `target` : id de machine ou 'bios' ; `name` (T36) : nom lu dans Content-Disposition,
 *   pour un lien sans nom de fichier (revérifié ici comme un nom d'adresse)
 * @param {object[]} systems
 * @returns {{ok: true, url: string, name: string, target: string} | {ok: false, message: string}} `name` : nom à écrire (nom exact déclaré pour un BIOS)
 */
export function checkDownloadItem(item, systems) {
  if (!item || typeof item.url !== 'string' || typeof item.target !== 'string') return { ok: false, message: 'Choix invalide.' };
  const address = checkPageAddress(item.url);
  if (!address.ok || !/^https?:\/\//i.test(item.url.trim())) return { ok: false, message: 'Adresse refusée.' };
  if (item.name !== undefined && (typeof item.name !== 'string' || !sanitizeName(item.name))) return { ok: false, message: 'Nom de fichier illisible.' };
  const name = item.name !== undefined ? sanitizeName(item.name) : fileNameFromUrl(address.url);
  const info = classifyFile(address.url, systems, name);
  if (!info) return { ok: false, message: 'Type de fichier non reconnu.' };
  if (item.target === 'bios') {
    return info.kind === 'bios' ? { ok: true, url: address.url, name: info.name, target: 'bios' } : { ok: false, message: 'Ce nom n\'est pas celui d\'un BIOS attendu.' };
  }
  const system = systems.find((s) => s.id === item.target);
  if (!system) return { ok: false, message: 'Machine inconnue.' };
  const ext = extensionOf(info.name);
  if (!(system.extensions ?? []).some((e) => e.toLowerCase() === ext)) return { ok: false, message: `${system.name} n'accepte pas les fichiers .${ext}.` };
  return { ok: true, url: address.url, name: info.name, target: system.id };
}

/**
 * Résumé en français d'un téléchargement (Mac et téléphone).
 * @param {{downloaded: string[], present: string[], failed: {name: string, message: string}[]}} summary
 * @returns {string[]} lignes ; les 10 premiers échecs sont détaillés
 */
export function formatLinksSummary(summary) {
  const lines = [`Fichiers téléchargés : ${summary.downloaded.length}`];
  if (summary.present.length) lines.push(`Déjà présents : ${summary.present.length}`);
  if (summary.failed.length) lines.push(`Échecs : ${summary.failed.length}`, ...summary.failed.slice(0, 10).map((f) => `- ${f.name} : ${f.message}`));
  return lines;
}
