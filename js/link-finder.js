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
 * Liens absolus http(s) d'une page : attributs href et src (guillemets doubles, simples ou sans), balise <base> respectée, sans ancre, sans doublon.
 * @param {string} html @param {string} pageUrl adresse finale de la page (après redirections)
 * @returns {string[]} dans l'ordre de la page
 */
export function extractLinks(html, pageUrl) {
  const text = String(html ?? '');
  let base = pageUrl;
  const baseTag = /<base\b[^>]*\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/i.exec(text);
  if (baseTag) { try { base = new URL(decodeEntities(baseTag[1] ?? baseTag[2] ?? baseTag[3]), pageUrl).href; } catch { /* base illisible : on garde la page */ } }
  const seen = new Set();
  const links = [];
  const attr = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`]+))/gi;
  for (const m of text.replace(/<base\b[^>]*>/gi, '').matchAll(attr)) {
    const value = decodeEntities((m[1] ?? m[2] ?? m[3]).trim());
    if (!value) continue;
    let url;
    try { url = new URL(value, base); } catch { continue; }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
    url.hash = '';
    if (!seen.has(url.href)) { seen.add(url.href); links.push(url.href); }
  }
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
 * @param {string} url @param {object[]} systems
 * @returns {{name: string, kind: 'bios', target: 'bios', candidates: []} | {name: string, kind: 'rom', target: string|null, candidates: string[]} | null}
 *   `target` : machine devinée (null : à choisir) ; `candidates` : machines qui acceptent cette extension ; null si le type n'est pas reconnu
 */
export function classifyFile(url, systems) {
  const name = fileNameFromUrl(url);
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
 * @param {{url: string, target: string}} item `target` : id de machine ou 'bios'
 * @param {object[]} systems
 * @returns {{ok: true, url: string, name: string, target: string} | {ok: false, message: string}} `name` : nom à écrire (nom exact déclaré pour un BIOS)
 */
export function checkDownloadItem(item, systems) {
  if (!item || typeof item.url !== 'string' || typeof item.target !== 'string') return { ok: false, message: 'Choix invalide.' };
  const address = checkPageAddress(item.url);
  if (!address.ok || !/^https?:\/\//i.test(item.url.trim())) return { ok: false, message: 'Adresse refusée.' };
  const info = classifyFile(address.url, systems);
  if (!info) return { ok: false, message: 'Type de fichier non reconnu.' };
  if (item.target === 'bios') {
    return info.kind === 'bios' ? { ok: true, url: address.url, name: info.name, target: 'bios' } : { ok: false, message: 'Ce nom n\'est pas celui d\'un BIOS attendu.' };
  }
  const system = systems.find((s) => s.id === item.target);
  if (!system) return { ok: false, message: 'Machine inconnue.' };
  const ext = extensionOf(fileNameFromUrl(address.url));
  if (!(system.extensions ?? []).some((e) => e.toLowerCase() === ext)) return { ok: false, message: `${system.name} n'accepte pas les fichiers .${ext}.` };
  return { ok: true, url: address.url, name: fileNameFromUrl(address.url), target: system.id };
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
