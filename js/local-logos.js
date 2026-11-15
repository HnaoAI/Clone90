// Vrais logos des machines dans le navigateur (T42, téléphone surtout) : comme le Mac (scripts/machine-logos.mjs, T29), lit le logo de chaque
// machine qui a un `logoTheme` dans le thème libre es-theme-carbon (RetroPie) et le range dans la bibliothèque locale sous le même chemin
// que sur le Mac (`roms/clone90-logos/<id>.svg`) : sw.js le sert comme un jeu importé, et loadData (js/data.js) le donne à l'accueil.
// Lancé avec la recherche des pochettes (js/app.js : après un ajout de jeux dans « Mes fichiers » et sur « Chercher les pochettes manquantes »).
// Dépend de logo-source.js (adresse, chemin, contrôle du SVG, partagés avec le Mac), local-covers.js (lecture limitée), config.js.
// INVARIANT (CLAUDE.md règle 5, exception b) : seulement des lectures d'images sur raw.githubusercontent.com (`logoUrl`), déclenchées par un
//   geste de la personne ; aucun nom de jeu ni donnée de Clone90 n'est envoyé.
// INVARIANT : on ne remplace jamais un fichier de la bibliothèque ; on n'écrit qu'un SVG accepté par `checkSvg` ; aucune exception.
import { MAX_LOGO_BYTES, LOGOS_DIR, logoUrl, logoTargetPath, checkSvg } from './logo-source.js';
import { browserFetchBytes } from './local-covers.js';
import { openLocalLibrary } from './local-library.js';
import { ROMS_DIR } from './config.js';

/** Chemin du logo d'une machine dans la bibliothèque : `roms/clone90-logos/<id>.svg`. @throws {Error} si l'id est invalide */
export const localLogoPath = (systemId) => `${ROMS_DIR}/${logoTargetPath(systemId)}`;

/** Vrai pour un chemin de la bibliothèque rangé parmi les logos (à ne pas montrer comme un fichier de la personne dans « Mes fichiers »). */
export const isLocalLogoPath = (path) => typeof path === 'string' && path.startsWith(`${ROMS_DIR}/${LOGOS_DIR}/`);

/**
 * Logos présents dans la bibliothèque, par machine (fonction pure).
 * @param {object[]} systems machines de systems.json @param {string[]} paths chemins de la bibliothèque
 * @returns {Record<string, string>} id de machine vers chemin
 */
export function localLogoPaths(systems, paths) {
  const present = new Set(paths);
  const logos = {};
  for (const s of systems) {
    let path;
    try { path = localLogoPath(s.id); } catch { continue; }
    if (present.has(path)) logos[s.id] = path;
  }
  return logos;
}

/**
 * Lit la bibliothèque et renvoie ses logos. Ne lève jamais : sans bibliothèque, aucun logo.
 * @param {object[]} systems @param {{openLibrary?: Function}} [env] injectable pour les tests
 * @returns {Promise<Record<string, string>>}
 */
export async function loadLocalLogos(systems, { openLibrary = openLocalLibrary } = {}) {
  try {
    const library = await openLibrary();
    return localLogoPaths(systems, (await library.list()).map((e) => e.path));
  } catch {
    return {};
  }
}

const errorText = (err) => err?.message ?? String(err);

/**
 * Télécharge et range les logos manquants. Ne lève jamais.
 * @param {object} input
 * @param {object[]} input.systems machines de systems.json (`logoTheme`) ; une machine sans `logoTheme` garde son logo maison
 * @param {{list: Function, put: (path: string, blob: Blob) => Promise<void>}} input.library bibliothèque locale (local-library.js)
 * @param {(url: string, options: {maxBytes: number}) => Promise<Uint8Array>} [input.fetchBytes] lecture réseau (navigateur par défaut)
 * @returns {Promise<{found: string[], alreadyHave: number, failed: {system: string, reason: string}[]}>} noms des machines
 */
export async function findLocalLogos({ systems, library, fetchBytes = browserFetchBytes }) {
  const summary = { found: [], alreadyHave: 0, failed: [] };
  let present;
  try { present = new Set((await library.list()).map((e) => e.path)); } catch { return summary; }
  for (const system of systems.filter((s) => s.logoTheme)) {
    try {
      const path = localLogoPath(system.id);
      if (present.has(path)) { summary.alreadyHave += 1; continue; }
      const bytes = await fetchBytes(logoUrl(system.logoTheme), { maxBytes: MAX_LOGO_BYTES });
      const text = new TextDecoder().decode(bytes);
      const problem = checkSvg(text);
      if (problem) throw new Error(problem);
      // Relecture juste avant l'écriture : un logo arrivé entre-temps (autre onglet) n'est jamais remplacé.
      if ((await library.list()).some((e) => e.path === path)) { summary.alreadyHave += 1; continue; }
      await library.put(path, new Blob([text], { type: 'image/svg+xml' }));
      present.add(path);
      summary.found.push(system.name);
    } catch (err) {
      summary.failed.push({ system: system.name, reason: errorText(err) });
    }
  }
  return summary;
}
