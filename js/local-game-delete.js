// Suppression d'un jeu importé dans « Mes fichiers » (T39), depuis l'écran Jouer : quels fichiers retirer, textes de la confirmation,
// suppression dans la bibliothèque locale (IndexedDB, js/local-library.js). Logique pure + bibliothèque et boîte reçues en paramètre (testables).
// Dépend de games-builder.js (parseM3u, extOf) et config.js (ROMS_DIR).
// INVARIANT : seuls les jeux `local: true` (bibliothèque du navigateur) se suppriment. Les jeux du disque du Mac (games.json) ne sont
// jamais touchés (décision 2026-11-14, en attente d'une réponse de Hicham pour le Mac).
// INVARIANT : on ne retire que des chemins `roms/<machine>/<fichier>` de la machine du jeu : jamais bios/, jamais un autre dossier.
import { parseM3u, extOf } from './games-builder.js';
import { ROMS_DIR } from './config.js';

/** Libellé du bouton de l'écran Jouer. */
export const DELETE_LABEL = 'Supprimer le fichier';

/**
 * Vrai si le jeu peut être supprimé depuis Clone90 : jeu importé sur cet appareil (« Mes fichiers »).
 * @param {object|null} game
 */
export const canDeleteGame = (game) => game?.local === true;

/** Dossier `roms/<machine>/` d'un chemin de jeu, ou null s'il n'a pas cette forme. */
const machineDir = (path) => {
  const parts = typeof path === 'string' ? path.split('/') : [];
  return parts.length === 3 && parts[0] === ROMS_DIR && parts[1] && parts[2] && !parts.includes('..') ? `${ROMS_DIR}/${parts[1]}/` : null;
};

/**
 * Fichiers de la bibliothèque qui forment un jeu importé : fichier principal, disquettes, pistes d'un .cue, disques d'un .m3u, jaquette.
 * La bibliothèque locale est plate (T27/T38) : tout fichier gardé est directement dans `roms/<machine>/`.
 * @param {object} game jeu au format de games.json, avec `local: true`
 * @param {{m3uText?: string}} [options] contenu du .m3u si le fichier principal en est un
 * @returns {string[]} chemins dans l'ordre (fichier, disquettes, pistes, disques du .m3u, jaquette), sans doublon ; [] si le jeu n'est pas local
 */
export function localGameFiles(game, { m3uText = '' } = {}) {
  if (!canDeleteGame(game)) return [];
  const dir = machineDir(game.file);
  if (!dir) return [];
  const inDir = (p) => machineDir(p) === dir;
  const fromM3u = extOf(game.file) === 'm3u' ? parseM3u(m3uText).filter((l) => !l.includes('/')).map((l) => dir + l) : [];
  const all = [game.file, ...(game.disks ?? []), ...(game.extraFiles ?? []).map((x) => x?.file), ...fromM3u, game.cover];
  return [...new Set(all.filter(inDir))];
}

/**
 * Textes de la confirmation (boîte createConfirmDialog, focus sur Annuler).
 * @param {string} title titre du jeu @param {number} count nombre de fichiers retirés
 */
export const deleteGameDialogOptions = (title, count = 1) => ({
  title: `Supprimer ${title} ?`,
  message: `${title} sera effacé de cet appareil${count > 1 ? ` (${count} fichiers)` : ''}. La suppression est définitive : pour y rejouer, il faudra l'importer à nouveau.`,
  cancelLabel: 'Annuler',
  confirmLabel: 'Supprimer',
});

/** Lit le .m3u d'un jeu dans la bibliothèque (vide si ce n'en est pas un ou s'il est illisible). */
const readM3u = async (library, game) => (extOf(game.file ?? '') === 'm3u' ? library.readText(game.file).catch(() => '') : '');

/**
 * Retire de la bibliothèque tous les fichiers du jeu. Continue après un échec.
 * @param {{readText: (p: string) => Promise<string>, remove: (p: string) => Promise<void>}} library
 * @param {object} game
 * @returns {Promise<{removed: number, failed: string[]}>}
 */
export async function deleteLocalGame(library, game) {
  const paths = localGameFiles(game, { m3uText: await readM3u(library, game) });
  const failed = [];
  for (const p of paths) {
    try { await library.remove(p); } catch { failed.push(p); }
  }
  return { removed: paths.length - failed.length, failed };
}

/**
 * Demande la confirmation (nom du jeu affiché) puis supprime. Refus : AUCUNE suppression. Ne lève jamais.
 * @param {{game: object, library: object, confirm: (options: ReturnType<typeof deleteGameDialogOptions>) => Promise<boolean>}} input
 * @returns {Promise<{status: 'unsupported'|'cancelled'}|{status: 'deleted', removed: number, failed: string[]}|{status: 'error', failed?: string[]}>}
 */
export async function confirmAndDeleteGame({ game, library, confirm }) {
  if (!canDeleteGame(game)) return { status: 'unsupported' };
  try {
    const count = localGameFiles(game, { m3uText: await readM3u(library, game) }).length;
    if (!(await confirm(deleteGameDialogOptions(game.title, count)))) return { status: 'cancelled' };
    const result = await deleteLocalGame(library, game);
    return result.removed === 0 ? { status: 'error', failed: result.failed } : { status: 'deleted', ...result };
  } catch {
    return { status: 'error' };
  }
}
