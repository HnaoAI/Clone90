// Chargement et validation de systems.json et games.json (T3). Aucune dépendance DOM : fetch est injectable.
// INVARIANT : systems.json est la seule source de vérité des machines (CLAUDE.md règle 2) ; rien ici n'en liste.
import { SYSTEMS_URL, GAMES_URL, EJS_VERSION_FORMAT } from './config.js';
import { compareTitles } from './sort.js';

const SYSTEM_ID = /^[a-z0-9]+$/;
/** Dossier des logos téléchargés dans le dossier des ROMs (T29) : même valeur que LOGOS_DIR de scripts/generate-games.mjs. */
const LOGOS_DIR = 'clone90-logos';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNonEmptyString = (v) => typeof v === 'string' && v.length > 0;

/** Chemin relatif sûr (aussi utilisé par player/launcher.js pour la BIOS d'un jeu) : pas de schéma (http:), pas de / initial, pas de segment `..`. */
export const isRelativePath = (p) => isNonEmptyString(p)
  && !/^[a-z][a-z0-9+.-]*:/i.test(p) && !p.startsWith('/') && !p.split('/').includes('..');

/**
 * `samples` (optionnel, T22) : packs de sons des cœurs fbneo. `dir` = dossier sous bios/ (chemin relatif sûr), `fsDir` = dossier du système de
 * fichiers du cœur où le pack est posé (absolu, sans `..`, pas la racine seule).
 */
const hasValidSamples = (s) => s.samples === undefined
  || (isObject(s.samples) && isRelativePath(s.samples.dir) && isNonEmptyString(s.samples.fsDir)
    && /^\/[^/]/.test(s.samples.fsDir) && !s.samples.fsDir.split('/').includes('..'));

/**
 * Valide le contenu de systems.json et renvoie les machines triées par `order`.
 * @param {unknown} raw JSON déjà parsé
 * @returns {object[]} machines
 * @throws {Error} si le schéma (architecture 6.1) n'est pas respecté
 */
export function validateSystems(raw) {
  if (!isObject(raw)) throw new Error('systems.json : objet attendu');
  if (raw.version !== 1) throw new Error(`systems.json : version ${raw.version} non gérée (1 attendue)`);
  if (!Array.isArray(raw.systems)) throw new Error('systems.json : champ systems (liste) manquant');
  if (raw.systems.length === 0) throw new Error('systems.json : liste de machines vide');
  const seen = new Set();
  for (const s of raw.systems) {
    if (!isObject(s) || !isNonEmptyString(s.id) || !SYSTEM_ID.test(s.id)) throw new Error('systems.json : id de machine invalide');
    if (seen.has(s.id)) throw new Error(`systems.json : id dupliqué ${s.id}`);
    seen.add(s.id);
    if (!isNonEmptyString(s.name)) throw new Error(`systems.json : ${s.id} : name manquant`);
    if (!Number.isInteger(s.order)) throw new Error(`systems.json : ${s.id} : order entier attendu`);
    if (s.ejsVersion !== undefined && !(typeof s.ejsVersion === 'string' && EJS_VERSION_FORMAT.test(s.ejsVersion))) throw new Error(`systems.json : ${s.id} : ejsVersion invalide (x.y.z attendu)`); // T21
    if (!hasValidSamples(s)) throw new Error(`systems.json : ${s.id} : samples invalide ({dir, fsDir} attendu)`); // T22
    if (!Array.isArray(s.extensions)) throw new Error(`systems.json : ${s.id} : extensions (liste) manquant`);
  }
  return [...raw.systems].sort((a, b) => a.order - b.order);
}

/** `disks` (optionnel, T10) : au moins deux chemins relatifs sûrs, le premier étant `file`. Un jeu simple n'a pas ce champ. */
const hasValidDisks = (g) => g.disks === undefined
  || (Array.isArray(g.disks) && g.disks.length >= 2 && g.disks.every(isRelativePath) && g.disks[0] === g.file);

/** `extraFiles` (optionnel, T15) : fichiers cités par un .cue (Mega-CD), `file` = chemin sous roms/, `as` = nom écrit dans le .cue (chemin relatif sûr). */
const hasValidExtraFiles = (g) => g.extraFiles === undefined
  || (Array.isArray(g.extraFiles) && g.extraFiles.every((e) => isObject(e) && isRelativePath(e.file) && isRelativePath(e.as)));

const isValidGame = (g, systemIds) => isObject(g)
  && isNonEmptyString(g.id) && isNonEmptyString(g.title)
  && systemIds.includes(g.system) && g.id.startsWith(`${g.system}/`)
  && isRelativePath(g.file)
  && (g.cover === null || g.cover === undefined || isRelativePath(g.cover))
  && hasValidDisks(g)
  && hasValidExtraFiles(g);

/**
 * Valide games.json : les entrées invalides (champ manquant, machine inconnue, id dupliqué,
 * chemin absolu ou remontant) sont écartées et comptées, pour ne pas bloquer toute la grille.
 * @param {unknown} raw JSON déjà parsé
 * @param {string[]} systemIds ids connus (venant de systems.json)
 * T29 : `logos` (facultatif) = logos de machines téléchargés ; seul le chemin exact `roms/clone90-logos/<id>.svg` d'une machine connue est gardé.
 * @returns {{games: object[], skipped: number, logos: Record<string, string>}}
 * @throws {Error} si l'enveloppe est invalide (version, liste)
 */
export function validateGames(raw, systemIds) {
  if (!isObject(raw)) throw new Error('games.json : objet attendu');
  if (raw.version !== 1) throw new Error(`games.json : version ${raw.version} non gérée (1 attendue)`);
  if (!Array.isArray(raw.games)) throw new Error('games.json : champ games (liste) manquant');
  const ids = new Set();
  const games = [];
  for (const g of raw.games) {
    if (isValidGame(g, systemIds) && !ids.has(g.id)) { ids.add(g.id); games.push(g); }
  }
  return { games, skipped: raw.games.length - games.length, logos: validateLogos(raw.logos, systemIds) };
}

/** Logos téléchargés valides (T29) : chemin fixe par machine, rien d'autre (pas de chemin venu du fichier). */
function validateLogos(raw, systemIds) {
  const logos = {};
  if (!isObject(raw)) return logos;
  for (const id of systemIds) {
    const expected = `roms/${LOGOS_DIR}/${id}.svg`;
    if (Object.hasOwn(raw, id) && raw[id] === expected) logos[id] = expected;
  }
  return logos;
}

/** fetchJson par défaut. Lève une erreur portant `status` si la réponse n'est pas ok. */
export async function defaultFetchJson(url) {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) { const e = new Error(`${url} : HTTP ${res.status}`); e.status = res.status; throw e; }
  return res.json();
}

/**
 * Message français pour l'utilisateur quand systems.json n'a pas pu être chargé (T11/A5).
 * Les messages de validation de ce module (déjà en français, commençant par "systems.json") sont conservés.
 * @param {Error & {status?: number}} e erreur d'origine (fetch, parseur JSON ou validation)
 */
function describeSystemsError(e) {
  if (e.status === 404) return 'Le fichier systems.json est introuvable.';
  if (e.status) return `Le serveur n'a pas pu envoyer systems.json (erreur HTTP ${e.status}).`;
  if (e instanceof TypeError) return 'Impossible de joindre le serveur : vous êtes peut-être hors ligne, ou le serveur local est arrêté.';
  if (e instanceof SyntaxError) return 'Le fichier systems.json est abîmé (ce n\'est pas du JSON valide).';
  if (e.message.startsWith('systems.json')) return e.message;
  return 'Le fichier systems.json est illisible.';
}

/** Statut de games.json quand son chargement échoue : 404 = absent, fetch rejeté (TypeError, pas de réponse) = offline, sinon invalid (T11/A6). */
const gamesFailureStatus = (e) => {
  if (e.status === 404) return 'absent';
  return !e.status && e instanceof TypeError ? 'offline' : 'invalid';
};

/**
 * Charge les données de l'application.
 * - systems.json absent ou invalide : erreur fatale (rejet) au message français ; l'erreur d'origine est dans `cause` (à journaliser en console).
 * - games.json : jamais fatal. `gamesStatus` vaut 'ok', 'empty' (aucun jeu), 'absent' (404,
 *   cas normal sur GitHub Pages car gitignoré), 'offline' (serveur injoignable) ou 'invalid' (illisible ou mauvaise version).
 * - T27 : jeux de la bibliothèque locale (fichiers importés sur le téléphone) ajoutés à ceux de games.json, validés de la même façon ;
 *   un jeu de games.json garde la priorité sur un jeu local de même id. Dès qu'il y a au moins un jeu, le statut est 'ok'.
 * @param {(url: string) => Promise<unknown>} [fetchJson] injectable pour les tests
 * @param {(systems: object[]) => Promise<object[]>} [loadLocal] jeux locaux (js/local-games.js, loadLocalGames) ; absent = aucun
 * @returns {Promise<{systems: object[], games: object[], gamesStatus: string, skipped: number, localCount: number}>}
 */
export async function loadData(fetchJson = defaultFetchJson, loadLocal = null) {
  let systems;
  try {
    systems = validateSystems(await fetchJson(SYSTEMS_URL));
  } catch (e) {
    throw new Error(describeSystemsError(e), { cause: e });
  }
  let result;
  try {
    const { games, skipped, logos } = validateGames(await fetchJson(GAMES_URL), systems.map((s) => s.id));
    const withLogos = systems.map((s) => (logos[s.id] ? { ...s, downloadedLogo: logos[s.id] } : s));
    result = { systems: withLogos, games, skipped, gamesStatus: games.length ? 'ok' : 'empty' };
  } catch (e) {
    result = { systems, games: [], skipped: 0, gamesStatus: gamesFailureStatus(e) };
  }
  const local = loadLocal ? await localGames(loadLocal, systems, result.games) : [];
  if (!local.length) return { ...result, localCount: 0 };
  return { ...result, games: [...result.games, ...local], gamesStatus: 'ok', localCount: local.length };
}

/** Jeux locaux valides et d'id libre (T27). Une erreur de la bibliothèque n'empêche jamais l'accueil : liste vide. */
async function localGames(loadLocal, systems, serverGames) {
  try {
    const { games } = validateGames({ version: 1, games: await loadLocal(systems) }, systems.map((s) => s.id));
    const taken = new Set(serverGames.map((g) => g.id));
    return games.filter((g) => !taken.has(g.id)).map((g) => ({ ...g, local: true }));
  } catch {
    return [];
  }
}

/**
 * Regroupe les jeux par machine. Toutes les machines sont présentes (liste vide = "0 jeu"),
 * jeux triés par titre (js/sort.js).
 * @returns {Map<string, object[]>}
 */
export function groupGamesBySystem(systems, games) {
  const map = new Map(systems.map((s) => [s.id, []]));
  for (const g of games) map.get(g.system)?.push(g);
  for (const list of map.values()) list.sort((a, b) => compareTitles(a.title, b.title));
  return map;
}

/**
 * Chemin de fichier ou de jaquette prêt pour une URL : chaque segment est encodé avec encodeURIComponent, les `/` sont conservés.
 * INVARIANT : encodeURI laisserait `#` et `?` intacts (début de fragment ou de requête : le navigateur viserait un autre fichier, T11/A1).
 * null reste null.
 */
export const assetUrl = (path) => (path == null ? null : path.split('/').map(encodeURIComponent).join('/'));

/** Chemin inverse de assetUrl, pour les messages affichés à l'utilisateur. Un encodage invalide est renvoyé tel quel. */
export const assetPathFromUrl = (url) => {
  try { return url.split('/').map(decodeURIComponent).join('/'); } catch { return url; }
};

/** Id de jeu prêt pour une URL (architecture 6.2 : encodeURIComponent). */
export const encodeGameId = (id) => encodeURIComponent(id);
