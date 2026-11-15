// Pochettes des jeux de « Mes fichiers » (T40) : dans le navigateur (téléphone surtout), après un import ou sur le bouton « Chercher les pochettes
// manquantes », cherche la pochette de chaque jeu importé qui n'en a pas dans la base libre libretro-thumbnails, comme le Mac (scripts/covers.mjs),
// et la range dans la bibliothèque locale à côté du jeu (`roms/<machine>/<nom du jeu>.png`) : la liste des jeux (games-builder.js) la reconnaît,
// et sw.js la sert comme les jeux. Lecture directe depuis le navigateur : GitHub autorise ces lectures (CORS), le Mac n'est pas nécessaire.
// Dépend de cover-match.js (recherche partagée avec le Mac). Réseau, bibliothèque et cache injectables (tests sans réseau).
// INVARIANT (CLAUDE.md règle 5, exception a) : seulement des lectures d'IMAGES (et des listes de noms d'images) sur GitHub, déclenchées par un
//   geste de la personne (import, bouton) ; rien de Clone90 n'est envoyé (ni cookie, ni adresse du site). Jamais de jeu téléchargé.
// INVARIANT : on ne remplace jamais un fichier de la bibliothèque ; une erreur ne fait jamais échouer l'import (aucune exception).
import { MAX_COVER_BYTES, githubUrl, chooseCover, coverTargetPath, isPng, fetchRepoListing, freshListing } from './cover-match.js';

/** Base IndexedDB des listes de pochettes (cache d'une semaine), À PART de la bibliothèque `clone90-local` partagée avec sw.js. */
export const COVERS_DB = Object.freeze({ name: 'clone90-covers', version: 1, store: 'listings' });

/** Chemin de la pochette d'un jeu dans la bibliothèque : `roms/<machine>/<nom du jeu>.png`. @param {{file: string}} game */
export const localCoverPath = (game) => `roms/${coverTargetPath(game)}`;

const LIMIT_TEXT = 'limite de requêtes de GitHub atteinte, réessayez dans une heure';
const timeout = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(30000) : undefined);
/** Lecture sans cookie ni adresse du site ; aucun en-tête ajouté (pas de requête préalable CORS) ; redirection refusée. */
const READ_INIT = () => ({ credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error', signal: timeout() });

const OFFLINE_TEXT = 'GitHub injoignable (pas de connexion à Internet ?)';
/** Requête de lecture ; une coupure réseau (TypeError « Failed to fetch » en anglais) devient un message français. */
async function read(url, fetchFn) {
  try { return await fetchFn(url, READ_INIT()); } catch { throw new Error(OFFLINE_TEXT); }
}

/** Réponse JSON de l'API de GitHub (lecture seule). @throws {Error} message en français */
export async function browserFetchJson(url, fetchFn = globalThis.fetch) {
  const res = await read(url, fetchFn);
  if (res.status === 403 || res.status === 429) throw new Error(LIMIT_TEXT);
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
  return res.json();
}

/**
 * Octets d'une image (lecture seule), refusée au-delà de `maxBytes` d'après Content-Length puis pendant la lecture.
 * @param {string} url @param {{maxBytes: number, fetchFn?: typeof fetch}} options
 * @returns {Promise<Uint8Array>} @throws {Error} message en français
 */
export async function browserFetchBytes(url, { maxBytes, fetchFn = globalThis.fetch }) {
  const res = await read(url, fetchFn);
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
  const tooBig = new Error('image trop volumineuse');
  if (Number(res.headers.get('content-length')) > maxBytes) { await res.body?.cancel(); throw tooBig; }
  const reader = res.body?.getReader();
  if (!reader) return new Uint8Array(0);
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > maxBytes) { await reader.cancel(); throw tooBig; }
    chunks.push(value);
  }
  const out = new Uint8Array(size);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/**
 * Cache des listes de pochettes (une entrée par dépôt : {repo, fetchedAt, files}). Ne lève jamais : sans IndexedDB, cache toujours vide.
 * @param {IDBFactory|null} [idb]
 * @returns {Promise<{get: (repo: string) => Promise<object|null>, set: (repo: string, entry: object) => Promise<void>}>}
 */
export async function openListingsCache(idb = globalThis.indexedDB) {
  const none = { get: async () => null, set: async () => {} };
  if (!idb) return none;
  try {
    const request = idb.open(COVERS_DB.name, COVERS_DB.version);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(COVERS_DB.store)) request.result.createObjectStore(COVERS_DB.store, { keyPath: 'repo' });
    };
    const db = await done(request);
    const store = (mode) => db.transaction(COVERS_DB.store, mode).objectStore(COVERS_DB.store);
    return {
      get: async (repo) => (await done(store('readonly').get(repo))) ?? null,
      set: async (repo, entry) => { await done(store('readwrite').put({ ...entry, repo })); },
    };
  } catch {
    return none;
  }
}

const errorText = (err) => err?.message ?? String(err);

/**
 * Cherche et range les pochettes des jeux de « Mes fichiers » qui n'en ont pas. Ne lève jamais.
 * @param {object} input
 * @param {object[]} input.systems machines de systems.json (`thumbnailsRepo`)
 * @param {object[]} input.games jeux affichés ; seuls ceux de la bibliothèque (`local: true`) sans `cover` sont cherchés
 * @param {{list: Function, put: (path: string, blob: Blob) => Promise<void>}} input.library bibliothèque locale (local-library.js)
 * @param {{fetchJson?: Function, fetchBytes?: Function}} [input.net] accès réseau (navigateur par défaut)
 * @param {{get: Function, set: Function}} [input.listings] cache des listes (openListingsCache par défaut)
 * @param {Date} [input.now]
 * @param {(e: {phase: 'listing'|'downloading', system?: string, done: number, total: number}) => void} [input.onProgress]
 * @returns {Promise<{found: {title: string, path: string}[], alreadyHave: number, notFound: string[], ambiguous: object[], failed: object[],
 *   listingErrors: object[], noRepo: string[]}>}
 */
export async function findLocalCovers({ systems, games, library, net = {}, listings, now = new Date(), onProgress = () => {} }) {
  const fetchJson = net.fetchJson ?? ((url) => browserFetchJson(url));
  const fetchBytes = net.fetchBytes ?? browserFetchBytes;
  const summary = { found: [], alreadyHave: 0, notFound: [], ambiguous: [], failed: [], listingErrors: [], noRepo: [] };
  const local = games.filter((g) => g?.local === true);
  summary.alreadyHave = local.filter((g) => g.cover).length;
  const todo = local.filter((g) => !g.cover);
  if (!todo.length) return summary;
  const cache = listings ?? await openListingsCache();
  let present;
  try { present = new Set((await library.list()).map((e) => e.path)); } catch { present = new Set(); }
  let count = 0;
  for (const system of systems) {
    const missing = todo.filter((g) => g.system === system.id);
    if (!missing.length) continue;
    const repo = system.thumbnailsRepo;
    if (!repo) { summary.noRepo.push(system.name); count += missing.length; continue; }
    onProgress({ phase: 'listing', system: system.name, done: count, total: todo.length });
    let files = null;
    try { files = freshListing(await cache.get(repo), now); } catch { /* cache illisible : liste relue */ }
    if (!files) {
      try {
        files = await fetchRepoListing(repo, fetchJson);
      } catch (err) {
        summary.listingErrors.push({ system: system.name, reason: errorText(err) });
        count += missing.length;
        continue;
      }
      try { await cache.set(repo, { fetchedAt: now.toISOString(), files }); } catch { /* le cache n'est qu'un confort */ }
    }
    for (const game of missing) {
      onProgress({ phase: 'downloading', system: system.name, done: count, total: todo.length });
      await handleGame({ game, files, repo, present, library, fetchBytes, summary });
      count += 1;
    }
  }
  onProgress({ phase: 'downloading', done: count, total: todo.length });
  return summary;
}

/** Un jeu : choix, contrôles, écriture dans la bibliothèque si aucun fichier n'y porte déjà ce nom. Remplit `summary`. */
async function handleGame({ game, files, repo, present, library, fetchBytes, summary }) {
  const choice = chooseCover(game.title, files);
  if (choice.status === 'none') { summary.notFound.push(game.title); return; }
  if (choice.status === 'ambiguous') { summary.ambiguous.push({ title: game.title, options: choice.files.map((f) => f.name) }); return; }
  const path = localCoverPath(game);
  if (present.has(path)) { summary.alreadyHave += 1; return; }
  if (choice.file.size > MAX_COVER_BYTES) { summary.failed.push({ title: game.title, reason: 'image de plus de 2 Mo' }); return; }
  try {
    const bytes = await fetchBytes(githubUrl('raw', repo, choice.file.name), { maxBytes: MAX_COVER_BYTES });
    if (!isPng(bytes)) throw new Error('le fichier reçu n\'est pas une image PNG');
    // Relecture juste avant l'écriture : une image arrivée entre-temps (autre onglet) n'est jamais remplacée.
    if ((await library.list()).some((e) => e.path === path)) { summary.alreadyHave += 1; return; }
    await library.put(path, new Blob([bytes], { type: 'image/png' }));
    present.add(path);
    summary.found.push({ title: game.title, path });
  } catch (err) {
    summary.failed.push({ title: game.title, reason: errorText(err) });
  }
}

const plural = (n, one, many) => `${n} ${n > 1 ? many : one}`;

/**
 * Résumé d'une ligne pour l'écran « Mes fichiers ». null s'il n'y avait rien à chercher.
 * @param {object} summary résultat de `findLocalCovers`
 * @returns {string|null}
 */
export function describeCoversResult(summary) {
  const s = summary;
  if (s.listingErrors.length && !s.found.length) {
    return `Pochettes indisponibles pour ${s.listingErrors.map((e) => e.system).join(', ')} : ${s.listingErrors[0].reason}`;
  }
  const parts = [
    s.found.length && plural(s.found.length, 'ajoutée', 'ajoutées'),
    s.notFound.length && plural(s.notFound.length, 'introuvable', 'introuvables'),
    s.ambiguous.length && `${s.ambiguous.length} avec plusieurs choix possibles`,
    s.failed.length && plural(s.failed.length, 'échec', 'échecs'),
    s.listingErrors.length && `liste indisponible pour ${s.listingErrors.map((e) => e.system).join(', ')}`,
  ].filter(Boolean);
  if (parts.length) return `Pochettes : ${parts.join(', ')}`;
  return s.alreadyHave ? 'Pochettes : toutes déjà présentes' : null;
}
