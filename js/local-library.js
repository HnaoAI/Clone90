// Bibliothèque locale (T27) : jeux et BIOS choisis par la personne sur SON appareil (téléphone), gardés dans le navigateur (IndexedDB).
// Rien n'est envoyé sur le réseau (CLAUDE.md règle 5) et rien n'entre dans le dépôt ni sur GitHub Pages (règle 1).
// Chaque fichier est rangé sous le chemin qu'il aurait sur le Mac (`roms/<machine>/<nom>`, `bios/<nom>`) : le service worker (sw.js) répond
// à ces adresses avec le fichier local, donc le lanceur et EmulatorJS voient exactement les mêmes URL que sur le Mac (aucun autre chemin de lancement).
// INVARIANT : nom de base, magasin et forme des enregistrements identiques dans sw.js (LOCAL_DB), vérifié par tests/local-library.test.mjs.
// Dépend de config.js (ROMS_DIR, BIOS_DIR). La partie IndexedDB reçoit sa fabrique en paramètre (testable avec un faux).
import { ROMS_DIR, BIOS_DIR } from './config.js';

/** Base IndexedDB : nom, version, magasin (clé = `path`). Enregistrement : {path, blob, size, addedAt}. */
export const LOCAL_DB = Object.freeze({ name: 'clone90-local', version: 1, store: 'files' });

/** Extensions dont le contenu texte sert à la liste des jeux (.m3u, .cue, .bios, comme le générateur). */
export const TEXT_EXTENSIONS = ['m3u', 'cue', 'bios'];

/** Taille maximale lue comme texte (un .cue ou un .m3u fait quelques Ko ; au-delà, ce n'en est pas un). */
const MAX_TEXT_BYTES = 256 * 1024;

/**
 * Nom de fichier sûr pour la bibliothèque : dernier segment seulement (un nom venant d'un sélecteur ne doit jamais créer de dossier),
 * sans caractère de contrôle ni point initial (fichier caché, ignoré par le générateur).
 * @param {string} name nom donné par le sélecteur de fichiers
 * @returns {string|null} null si rien d'utilisable ne reste
 */
export function sanitizeFileName(name) {
  if (typeof name !== 'string') return null;
  const last = name.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const cleaned = last.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/^\.+/, '');
  return cleaned && cleaned !== '..' ? cleaned : null;
}

/**
 * Chemin d'un jeu importé : `roms/<machine>/<nom>`.
 * @param {string} systemId id de systems.json
 * @param {string} fileName
 * @returns {string|null} null si le nom est inutilisable
 */
export function romStoragePath(systemId, fileName) {
  const name = sanitizeFileName(fileName);
  return name && /^[a-z0-9]+$/.test(systemId) ? `${ROMS_DIR}/${systemId}/${name}` : null;
}

/**
 * Chemin d'un BIOS importé : `bios/<nom>`. Si le nom correspond (sans tenir compte de la casse) à un BIOS déclaré dans systems.json,
 * on prend le nom EXACT déclaré (les cœurs cherchent un nom précis, `kick40068.A1200`, `neogeo.zip`), sinon le nom tel quel.
 * @param {string} fileName @param {object[]} systems machines de systems.json
 * @returns {{path: string, known: boolean}|null} known : nom attendu par une machine ; null si le nom est inutilisable
 */
export function biosStoragePath(fileName, systems) {
  const name = sanitizeFileName(fileName);
  if (!name) return null;
  const declared = systems.flatMap((s) => s.bios ?? []).map((b) => b.file).filter((f) => typeof f === 'string');
  const match = declared.find((f) => f.toLowerCase() === name.toLowerCase());
  return { path: `${BIOS_DIR}/${match ?? name}`, known: Boolean(match) };
}

/**
 * BIOS attendus par machine et présence dans la bibliothèque (écran « Mes fichiers »). Seuls les BIOS requis ou par défaut sont listés.
 * @param {object[]} systems @param {string[]} paths chemins présents dans la bibliothèque
 * @returns {{systemId: string, systemName: string, file: string, required: boolean, present: boolean}[]}
 */
export function describeBiosStatus(systems, paths) {
  const present = new Set(paths);
  return systems.flatMap((s) => (s.bios ?? [])
    .filter((b) => typeof b.file === 'string' && (b.required === true || b.role === 'default'))
    .map((b) => ({ systemId: s.id, systemName: s.name, file: b.file, required: b.required === true, present: present.has(`${BIOS_DIR}/${b.file}`) })));
}

/** Promesse d'une requête IndexedDB. */
const done = (request) => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

/**
 * Ouvre la bibliothèque locale.
 * @param {IDBFactory} [idb] fabrique IndexedDB (indexedDB du navigateur par défaut)
 * @returns {Promise<{put: (path: string, blob: Blob) => Promise<void>, list: () => Promise<{path: string, size: number, addedAt: number}[]>,
 *   get: (path: string) => Promise<Blob|null>, readText: (path: string) => Promise<string>, remove: (path: string) => Promise<void>}>}
 * @throws {Error} IndexedDB absent ou refusé (navigation privée de certains navigateurs)
 */
export async function openLocalLibrary(idb = globalThis.indexedDB) {
  if (!idb) throw new Error('Ce navigateur ne permet pas de garder des fichiers.');
  const request = idb.open(LOCAL_DB.name, LOCAL_DB.version);
  request.onupgradeneeded = () => {
    if (!request.result.objectStoreNames.contains(LOCAL_DB.store)) request.result.createObjectStore(LOCAL_DB.store, { keyPath: 'path' });
  };
  const db = await done(request);
  const store = (mode) => db.transaction(LOCAL_DB.store, mode).objectStore(LOCAL_DB.store);
  const get = async (path) => (await done(store('readonly').get(path)))?.blob ?? null;
  return {
    put: async (path, blob) => { await done(store('readwrite').put({ path, blob, size: blob.size, addedAt: Date.now() })); },
    list: async () => (await done(store('readonly').getAll())).map(({ path, size, addedAt }) => ({ path, size, addedAt })),
    get,
    readText: async (path) => {
      const blob = await get(path);
      return blob && blob.size <= MAX_TEXT_BYTES ? blob.text() : '';
    },
    remove: async (path) => { await done(store('readwrite').delete(path)); },
  };
}

/** Vrai si le navigateur peut servir les fichiers locaux au jeu : IndexedDB + service worker (HTTPS ou localhost). */
export const canUseLocalLibrary = (win = globalThis) => Boolean(win.indexedDB && win.isSecureContext && win.navigator && 'serviceWorker' in win.navigator);

/** Demande au navigateur de ne pas effacer la bibliothèque quand la place manque (meilleur effort, sans erreur). */
export async function requestPersistentStorage(nav = globalThis.navigator) {
  try { return (await nav?.storage?.persist?.()) === true; } catch { return false; }
}
