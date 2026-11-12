// Jeux de la bibliothèque locale (T27) : même règle que le générateur (js/games-builder.js, buildSystemGames) appliquée aux fichiers
// importés dans le navigateur. Les jeux obtenus ont les mêmes chemins que sur le Mac (`roms/<machine>/...`) et `local: true`.
// Dépend de games-builder.js, local-library.js, config.js. Aucune liste de machines ici (CLAUDE.md règle 2) : tout vient de `systems`.
import { buildSystemGames, extOf } from './games-builder.js';
import { TEXT_EXTENSIONS, openLocalLibrary } from './local-library.js';
import { ROMS_DIR } from './config.js';

/** Fichier des titres arcade et Neo Geo (commité, comme pour le générateur). */
export const TITLES_URL = 'data/titles.json';

/**
 * Jeux construits à partir des chemins de la bibliothèque (fonction pure).
 * @param {{systems: object[], paths: string[], texts?: Record<string, string>, titles?: object|null}} input
 *   `paths` : chemins de la bibliothèque (`roms/<machine>/<fichier>`, les autres sont ignorés) ; `texts` : contenu des .m3u/.cue/.bios, par chemin complet
 * @returns {object[]} jeux au format de games.json, avec `local: true`
 */
export function buildLocalGames({ systems, paths, texts = {}, titles = null }) {
  const games = [];
  for (const system of systems) {
    const prefix = `${ROMS_DIR}/${system.id}/`;
    const files = paths.filter((p) => p.startsWith(prefix)).map((p) => p.slice(prefix.length)).filter((f) => f && !f.includes('/')).sort();
    if (!files.length) continue;
    const systemTexts = Object.fromEntries(files.filter((f) => Object.hasOwn(texts, prefix + f)).map((f) => [f, texts[prefix + f]]));
    const { games: built } = buildSystemGames({ system, files, texts: systemTexts, titles });
    games.push(...built.map((g) => ({ ...g, local: true })));
  }
  return games;
}

/** Chemins de la bibliothèque dont le contenu texte compte pour la liste (.m3u, .cue, .bios). */
export const textPaths = (paths) => paths.filter((p) => TEXT_EXTENSIONS.includes(extOf(p)));

/**
 * Lit la bibliothèque et construit ses jeux. Ne lève jamais : sans bibliothèque (navigateur incompatible, base refusée), liste vide.
 * @param {object[]} systems machines de systems.json
 * @param {{openLibrary?: Function, fetchJson?: (url: string) => Promise<unknown>}} [env] injectables pour les tests
 * @returns {Promise<object[]>}
 */
export async function loadLocalGames(systems, { openLibrary = openLocalLibrary, fetchJson } = {}) {
  try {
    const library = await openLibrary();
    const paths = (await library.list()).map((e) => e.path);
    if (!paths.some((p) => p.startsWith(`${ROMS_DIR}/`))) return [];
    const texts = {};
    for (const p of textPaths(paths)) texts[p] = await library.readText(p).catch(() => '');
    let titles = null;
    try {
      const raw = await (fetchJson ?? (async (url) => (await fetch(url)).json()))(TITLES_URL);
      if (raw && typeof raw === 'object' && !Array.isArray(raw)) titles = raw;
    } catch { /* titres tirés des noms de fichiers */ }
    return buildLocalGames({ systems, paths, texts, titles });
  } catch {
    return [];
  }
}
