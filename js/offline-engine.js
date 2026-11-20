// Préparation du jeu hors ligne (T46) : bouton « Préparer le jeu hors ligne » de « Mes fichiers ». Garde d'avance, dans le Cache Storage,
// le moteur EmulatorJS et le cœur de chaque machine qui a des jeux ; sw.js les rend ensuite sans réseau (même cache, mêmes adresses).
// Dépend de player/launcher.js (liste des fichiers d'EmulatorJS, règle 4) et de ui/library-screen.js (formatSize). Cache Storage et fetch injectables.
// INVARIANT : ENGINE_CACHE_PREFIX identique à celui de sw.js (tests/sw.test.mjs). Seuls des fichiers du CDN EmulatorJS entrent ici :
// jamais de ROM ni de BIOS (CLAUDE.md règle 6). Aucune donnée de la personne n'est envoyée : lectures du CDN, sans cookies.
import { engineFiles, engineReportUrl, engineVersionOf } from './player/launcher.js';
import { EJS_VERSION_FORMAT } from './config.js';
import { formatSize } from './ui/library-screen.js';

/** Préfixe des caches du moteur : un cache par version d'EmulatorJS, `clone90-ejs-4.2.3`. */
export const ENGINE_CACHE_PREFIX = 'clone90-ejs-';

/** Lecture du CDN : CORS (réponse lisible, donc contrôlable avant d'être gardée), sans cookies. */
const FETCH_INIT = { mode: 'cors', credentials: 'omit' };

/**
 * Nom du cache d'une version d'EmulatorJS.
 * @param {string} version x.y.z @returns {string}
 * @throws {Error} version mal formée (jamais « stable », dont le contenu change)
 */
export function engineCacheName(version) {
  if (typeof version !== 'string' || !EJS_VERSION_FORMAT.test(version)) throw new Error(`Version d'EmulatorJS invalide : ${String(version)}`);
  return `${ENGINE_CACHE_PREFIX}${version}`;
}

/**
 * Machines qui ont au moins un jeu, dans l'ordre de systems.json.
 * @param {object[]} systems @param {{system: string}[]|null} games
 */
export const machinesWithGames = (systems, games) => {
  const used = new Set((games ?? []).map((g) => g.system));
  return systems.filter((s) => used.has(s.id));
};

/**
 * Vrai si ce navigateur peut garder le moteur (Cache Storage et service worker, donc HTTPS ou localhost).
 * @param {object} win window
 */
export const offlineEngineSupported = (win) => Boolean(win?.caches && win?.navigator?.serviceWorker);

/** Lit `url` au réseau ; réponse ok ou null (erreur HTTP ou pas de réseau). */
async function download(fetchFn, url) {
  try {
    const res = await fetchFn(url, FETCH_INIT);
    return res.ok ? res : null;
  } catch { return null; }
}

/** Rapport du cœur (JSON), depuis le cache ou le réseau (gardé s'il est lisible au réseau) ; null s'il est absent ou abîmé. */
async function readReport(cache, fetchFn, url, onDownloaded) {
  let res = await cache.match(url);
  if (!res) {
    res = await download(fetchFn, url);
    if (!res) return null;
    const bytes = await res.clone().arrayBuffer();
    await cache.put(url, res.clone());
    onDownloaded(bytes.byteLength);
  }
  try { return JSON.parse(await res.text()); } catch { return null; }
}

/**
 * Télécharge ce qui manque du moteur pour les machines qui ont des jeux, puis efface les caches des versions qui ne servent plus.
 * Ne lève jamais.
 * @param {{systems: object[], games: object[], cacheStorage?: CacheStorage, fetchFn?: typeof fetch, webgl2?: boolean, locale?: string,
 *   onProgress?: (p: {done: number, total: number}) => void}} input
 * @returns {Promise<{unsupported?: boolean, ready: string[], failed: string[], downloaded: number}>}
 *   `ready` : noms des machines prêtes ; `failed` : adresses obligatoires non téléchargées ; `downloaded` : octets téléchargés
 */
export async function prepareOfflineEngine({ systems, games, cacheStorage = globalThis.caches, fetchFn = globalThis.fetch, webgl2 = false, locale, onProgress = () => {} }) {
  if (!cacheStorage) return { unsupported: true, ready: [], failed: [], downloaded: 0 };
  const machines = machinesWithGames(systems, games);
  let downloaded = 0;
  const added = (n) => { downloaded += n; };
  const failed = new Set();
  const plans = [];
  for (const system of machines) {
    let cache;
    try { cache = await cacheStorage.open(engineCacheName(engineVersionOf(system))); } catch { failed.add(engineReportUrl(system)); continue; }
    const report = await readReport(cache, fetchFn, engineReportUrl(system), added);
    plans.push({ system, cache, files: engineFiles({ system, report, webgl2, locale }).filter((f) => f.url !== engineReportUrl(system)) });
  }
  const todo = [];
  const seen = new Set();
  for (const { cache, files } of plans) {
    for (const file of files) {
      if (seen.has(file.url)) continue;
      seen.add(file.url);
      if (!(await cache.match(file.url))) todo.push({ ...file, cache });
    }
  }
  onProgress({ done: 0, total: todo.length });
  for (const [i, file] of todo.entries()) {
    const res = await download(fetchFn, file.url);
    if (res) {
      const bytes = await res.clone().arrayBuffer();
      try { await file.cache.put(file.url, res); added(bytes.byteLength); } catch { if (!file.optional) failed.add(file.url); }
    } else if (!file.optional) failed.add(file.url);
    onProgress({ done: i + 1, total: todo.length });
  }
  const ready = plans.filter((p) => p.files.every((f) => f.optional || !failed.has(f.url))).map((p) => p.system.name);
  await removeStaleEngineCaches(cacheStorage, plans.map((p) => engineCacheName(engineVersionOf(p.system))));
  return { ready, failed: [...failed], downloaded };
}

/** Efface les caches `clone90-ejs-*` qui ne sont pas dans `keep` ; les autres caches (coquille, autres applications) restent. */
async function removeStaleEngineCaches(cacheStorage, keep) {
  if (!keep.length) return;
  try {
    const names = await cacheStorage.keys();
    await Promise.all(names.filter((n) => n.startsWith(ENGINE_CACHE_PREFIX) && !keep.includes(n)).map((n) => cacheStorage.delete(n)));
  } catch { /* nettoyage facultatif */ }
}

/**
 * Message d'une ligne après « Préparer le jeu hors ligne ».
 * @param {{unsupported?: boolean, ready: string[], failed: string[], downloaded: number}} result
 * @returns {string}
 */
export function describeOfflineResult({ unsupported = false, ready = [], failed = [], downloaded = 0 }) {
  if (unsupported) return 'Ce navigateur ne peut pas garder le moteur d\'émulation (il faut HTTPS, hors navigation privée).';
  if (failed.length) {
    const prefix = ready.length ? `Jeu hors ligne prêt pour ${ready.join(', ')}, mais préparation incomplète` : 'Préparation incomplète';
    return `${prefix} : ${failed.length} fichier${failed.length > 1 ? 's' : ''} du moteur non téléchargé${failed.length > 1 ? 's' : ''}. Vérifiez le réseau et réessayez.`;
  }
  if (!ready.length) return 'Aucun jeu sur cet appareil : ajoutez d\'abord des jeux, puis préparez le jeu hors ligne.';
  return `Jeu hors ligne prêt pour ${ready.join(', ')} (${downloaded > 0 ? `${formatSize(downloaded)} téléchargés` : 'déjà sur cet appareil'}).`;
}
