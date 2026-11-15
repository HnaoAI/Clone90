// Recherche d'une pochette dans la base libre libretro-thumbnails (T28, rendue commune en T40) : adresses GitHub, titre comparable,
// choix de l'image parmi les fichiers de Named_Boxarts, chemin de l'image à côté du jeu, contrôle PNG. Fonctions pures (réseau injecté),
// partagées par scripts/covers.mjs (Mac) et js/local-covers.js (« Mes fichiers », navigateur). Dépend seulement de posix-path.js.
// INVARIANT : `githubUrl` est la SEULE fabrique d'adresses : hôtes GitHub fixes, organisation fixe, nom de dépôt contrôlé.
// INVARIANT : on ne devine pas. Plusieurs candidats aussi bons (images différentes) = ambigu, rien n'est téléchargé.
import { extname } from './posix-path.js';

export const MAX_COVER_BYTES = 2 * 1024 * 1024;
/** Durée de validité d'une liste de pochettes gardée en cache (Mac : fichier, navigateur : IndexedDB). */
export const LISTING_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const ORG = 'libretro-thumbnails';
const BOXARTS = 'Named_Boxarts';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const REPO_NAME = /^[A-Za-z0-9._-]+$/;
const TAG = /\s*[(\[][^)\]]*[)\]]/g;
const UNWANTED_TAG = /\b(beta|proto|prototype|demo|sample|unl|pirate|aftermarket|hack|bootleg|compilation)\b/i;

/** Seule fabrique d'adresses : hôtes GitHub fixes, nom de dépôt contrôlé. @param {'api'|'raw'} kind */
export function githubUrl(kind, repo, rest) {
  if (!REPO_NAME.test(repo)) throw new Error(`Nom de dépôt de pochettes invalide : ${repo}`);
  return kind === 'api'
    ? `https://api.github.com/repos/${ORG}/${repo}/git/trees/${rest}`
    : `https://raw.githubusercontent.com/${ORG}/${repo}/HEAD/${BOXARTS}/${encodeURIComponent(rest)}`;
}

/** Titre comparable : sans étiquettes (…) […], sans accents, casse, ponctuation, « the » et « and » (aussi « & » et « _ ») ignorés. */
export function normalizeTitle(title) {
  const words = title.replace(TAG, ' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.filter((w) => w !== 'the' && w !== 'and').join(' ');
}

/** Rang de région d'un nom de candidat : 0 sans étiquette (nom exact), 1 Europe, 2 USA, 3 World, 4 le reste. Moins = meilleur. */
function regionRank(tags) {
  if (!tags.length) return 0;
  const all = tags.join(',').replace(/[()\[\]]/g, ' ').toLowerCase().split(/[,\s]+/);
  return ['europe', 'usa', 'world'].map((r) => all.includes(r)).indexOf(true) + 1 || 4;
}

/** Nom d'un fichier de la base, `Gods (Europe).png`, séparé en titre (sans étiquettes) et étiquettes. */
function parseCandidateName(name) {
  const stem = name.replace(/\.png$/i, '');
  return { stem, title: stem.replace(TAG, '').trim(), tags: stem.match(/[(\[][^)\]]*[)\]]/g) ?? [] };
}

/**
 * Choisit l'image d'un titre parmi les fichiers d'une base.
 * Correspondance sur le titre normalisé ; à défaut, sur le titre qui précède un sous-titre (` - ` ou ` _ `). Parmi les candidats : les versions
 * « Beta », « Proto », « Compilation »... passent après, puis l'ordre nom exact, Europe, USA, World, autre. Images identiques (même sha) = un seul candidat.
 * @param {string} title titre du jeu
 * @param {{name: string, sha: string, size: number}[]} files fichiers de Named_Boxarts
 * @returns {{status: 'found', file: object}|{status: 'none'}|{status: 'ambiguous', files: object[]}}
 */
export function chooseCover(title, files) {
  const wanted = normalizeTitle(title);
  if (!wanted) return { status: 'none' };
  const parsed = files.filter((f) => /\.png$/i.test(f.name)).map((f) => ({ file: f, ...parseCandidateName(f.name) }));
  let matches = parsed.filter((p) => normalizeTitle(p.title) === wanted);
  if (!matches.length) matches = parsed.filter((p) => normalizeTitle(p.title.split(/\s[-_]\s/)[0]) === wanted);
  if (!matches.length) return { status: 'none' };
  const score = (p) => [UNWANTED_TAG.test(p.tags.join(' ')) ? 1 : 0, regionRank(p.tags)];
  const compare = (a, b) => score(a)[0] - score(b)[0] || score(a)[1] - score(b)[1];
  matches.sort((a, b) => compare(a, b) || (a.file.name < b.file.name ? -1 : 1));
  const best = matches.filter((p) => compare(p, matches[0]) === 0);
  const distinct = [...new Map(best.map((p) => [p.file.sha, p.file])).values()];
  return distinct.length === 1 ? { status: 'found', file: distinct[0] } : { status: 'ambiguous', files: distinct };
}

/**
 * Chemin de l'image à écrire, relatif au dossier des ROMs : celui du jeu, avec son nom sans extension (celui de sa première disquette
 * pour un jeu à plusieurs disquettes, du .m3u ou du .cue sinon) et l'extension .png. C'est un des noms que cherche le générateur (games-builder.js, `covers`).
 * @param {{file: string}} game jeu de games.json (`roms/<dossier>/<fichier>`)
 */
export function coverTargetPath(game) {
  const rel = game.file.replace(/^roms\//, '');
  return `${rel.slice(0, rel.length - extname(rel).length)}.png`;
}

/** Vrai si les octets commencent par la signature PNG. */
export function isPng(bytes) {
  return bytes.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * Liste des images de Named_Boxarts d'un dépôt : deux requêtes (racine puis dossier), car l'arbre récursif de gros dépôts (FBNeo) est refusé par GitHub (erreur 500).
 * @param {string} repo
 * @param {(url: string) => Promise<any>} fetchJson
 * @returns {Promise<{name: string, sha: string, size: number}[]>}
 * @throws {Error} si le dossier est absent ou la liste tronquée
 */
export async function fetchRepoListing(repo, fetchJson) {
  const root = await fetchJson(githubUrl('api', repo, 'HEAD'));
  const folder = root?.tree?.find((e) => e.path === BOXARTS && e.type === 'tree');
  if (!folder) throw new Error(`dossier ${BOXARTS} introuvable dans ${repo}`);
  const list = await fetchJson(githubUrl('api', repo, folder.sha));
  if (!Array.isArray(list?.tree) || list.truncated) throw new Error(`liste incomplète pour ${repo}`);
  return list.tree.filter((e) => e.type === 'blob' && /\.png$/i.test(e.path)).map((e) => ({ name: e.path, sha: e.sha, size: e.size ?? 0 }));
}

/**
 * Liste gardée en cache si elle est bien formée et date de moins de 7 jours, sinon null (à relire sur GitHub).
 * @param {{fetchedAt?: string, files?: unknown}|null|undefined} entry @param {Date} now
 * @returns {{name: string, sha: string, size: number}[]|null}
 */
export function freshListing(entry, now) {
  const valid = entry && Array.isArray(entry.files) && entry.files.every((f) => f && typeof f.name === 'string' && typeof f.sha === 'string' && Number.isFinite(f.size))
    && now - Date.parse(entry.fetchedAt) < LISTING_MAX_AGE_MS; // NaN (date absente ou fausse) : comparaison fausse, donc périmé
  return valid ? entry.files : null;
}
