// Exploration d'un site pour « Depuis une page web » (T36) : la page donnée, puis les pages du même site qu'elle relie (1 ou 2 niveaux),
// et interrogation des liens de téléchargement sans nom de fichier. Logique pure : la lecture réseau est fournie par l'appelant
// (relais du Mac, scripts/link-relay.mjs, avec ses garde-fous anti-SSRF ; ou navigateur, js/link-download.js).
// INVARIANT : même site seulement, limites de pages, d'octets, de durée et d'interrogations ; arrêt possible à tout moment (signal).
import { extractLinks, classifyFile, isPageLink, isDownloadLike, MAX_FILES } from './link-finder.js';

/** Limites par défaut (plan T36 validé par Hicham le 2026-11-13). */
export const EXPLORE_LIMITS = Object.freeze({ maxDepth: 2, maxPages: 40, maxBytes: 10 * 1024 * 1024, timeoutMs: 90_000, maxProbes: 60 });

/**
 * Explore à partir d'une page.
 * @param {object} options
 * @param {string} options.start adresse vérifiée de la page donnée
 * @param {object[]} options.systems machines de systems.json
 * @param {number} [options.depth] 0 : cette page seulement ; 1 : plus les pages reliées ; 2 : un niveau de plus (borné par EXPLORE_LIMITS.maxDepth)
 * @param {(url: string) => Promise<{url: string, html: string}>} options.fetchPage lit une page ; lève une erreur avec `message` français si impossible
 * @param {(url: string) => Promise<string|null>} [options.probe] nom de fichier d'un lien sans nom (Content-Disposition, adresse finale) ; absent : pas d'interrogation
 * @param {(p: {pages: number, queued: number, files: number}) => void} [options.onProgress]
 * @param {AbortSignal} [options.signal] arrêt demandé par la personne : on rend ce qui a été trouvé
 * @param {Partial<typeof EXPLORE_LIMITS>} [options.limits] @param {() => number} [options.now]
 * @returns {Promise<{url: string, files: object[], truncated: boolean, stopped: boolean, stats: {pages: number, links: number, probes: number, failedPages: number}}>}
 * @throws l'erreur de `fetchPage` pour la page de départ seulement (les sous-pages en échec sont comptées et ignorées)
 */
export async function exploreSite({ start, systems, depth = 1, fetchPage, probe, onProgress = () => {}, signal, limits = {}, now = Date.now }) {
  const lim = { ...EXPLORE_LIMITS, ...limits };
  const maxDepth = Math.max(0, Math.min(Number(depth) || 0, lim.maxDepth));
  const deadline = now() + lim.timeoutMs;
  const stats = { pages: 0, links: 0, probes: 0, failedPages: 0 };
  const files = new Map();
  const queued = new Set([start]);
  const queue = [{ url: start, level: 0 }];
  const probed = new Set();
  let bytes = 0;
  let stopped = false;
  let finalStart = start;
  const isOver = () => signal?.aborted || now() > deadline || bytes > lim.maxBytes || files.size >= MAX_FILES;

  while (queue.length) {
    if (isOver()) { stopped = Boolean(signal?.aborted); break; }
    const { url, level } = queue.shift();
    let page;
    try { page = await fetchPage(url); } catch (err) {
      if (level === 0) throw err;
      stats.failedPages += 1;
      continue;
    }
    if (level === 0) finalStart = page.url;
    stats.pages += 1;
    bytes += page.html.length;
    const links = extractLinks(page.html, page.url);
    stats.links += links.length;
    for (const link of links) {
      if (files.has(link)) continue;
      const info = classifyFile(link, systems);
      if (info) { files.set(link, { url: link, ...info, page: page.url }); continue; }
      if (probe && isDownloadLike(link) && !probed.has(link) && stats.probes < lim.maxProbes && !isOver()) {
        probed.add(link);
        stats.probes += 1;
        const name = await probe(link).catch(() => null);
        const found = name ? classifyFile(link, systems, name) : null;
        if (found) { files.set(link, { url: link, ...found, page: page.url, named: true }); continue; }
      }
      if (level < maxDepth && !queued.has(link) && queued.size < lim.maxPages && isPageLink(link, finalStart)) {
        queued.add(link);
        queue.push({ url: link, level: level + 1 });
      }
    }
    onProgress({ pages: stats.pages, queued: queued.size, files: files.size });
  }
  if (signal?.aborted) stopped = true;
  const list = [...files.values()];
  return { url: finalStart, files: list.slice(0, MAX_FILES), truncated: list.length >= MAX_FILES, stopped, stats };
}

/**
 * Message d'une analyse qui n'a rien trouvé, avec ce qui a été lu et les causes probables.
 * @param {{pages: number, links: number}} stats
 */
export function describeEmptyScan(stats) {
  const read = `${stats.links} lien${stats.links > 1 ? 's' : ''} lu${stats.links > 1 ? 's' : ''} sur ${stats.pages} page${stats.pages > 1 ? 's' : ''}`;
  return `${read}, aucun fichier de jeu ou de BIOS reconnu. Cette page fabrique peut-être ses liens par JavaScript, demande une connexion, `
    + 'ou propose ses fichiers sur un autre site. Essaie l\'adresse de la page d\'un jeu, ou une profondeur plus grande.';
}

/** Texte d'avancement de l'analyse. */
export const describeScanProgress = (p) => `Analyse : ${p?.pages ?? 0} page${(p?.pages ?? 0) > 1 ? 's' : ''} lue${(p?.pages ?? 0) > 1 ? 's' : ''}`
  + ` sur ${p?.queued ?? 1}, ${p?.files ?? 0} fichier${(p?.files ?? 0) > 1 ? 's' : ''} trouvé${(p?.files ?? 0) > 1 ? 's' : ''}...`;
