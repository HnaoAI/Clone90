// Suppression d'un jeu depuis l'écran Jouer (T39, « Supprimer le fichier ») : quels fichiers retirer, textes de la confirmation, et deux voies :
// jeu importé dans « Mes fichiers » (bibliothèque du navigateur, IndexedDB, js/local-library.js) ou jeu du disque du Mac ou du PC
// (API locale POST api/games/delete, scripts/game-delete.mjs). Logique pure + bibliothèque, boîte et requête reçues en paramètre (testables).
// Dépend de games-builder.js (parseM3u, extOf) et config.js (ROMS_DIR).
// INVARIANT : toujours une confirmation qui montre le nom du jeu et dit que c'est définitif ; refus = rien n'est supprimé (Hicham, 2026-11-14).
// INVARIANT : on ne retire que des fichiers du dossier de la machine du jeu sous roms/ : jamais bios/, jamais un dossier entier.
import { parseM3u, extOf } from './games-builder.js';
import { ROMS_DIR } from './config.js';

/** Libellé du bouton de l'écran Jouer. */
export const DELETE_LABEL = 'Supprimer le fichier';

/**
 * Vrai si le jeu peut être supprimé depuis Clone90 : jeu importé sur cet appareil (« Mes fichiers »).
 * @param {object|null} game
 */
export const canDeleteGame = (game) => game?.local === true;

/** Découpe un chemin web `roms/...` normalisé (sans `.`, `..` ni segment vide). @returns {string[]|null} */
const segments = (path) => {
  if (typeof path !== 'string' || path.includes('\\')) return null;
  const parts = path.split('/');
  return parts[0] === ROMS_DIR && parts.length >= 3 && parts.length <= 4 && parts.every((p) => p && p !== '.' && p !== '..') ? parts : null;
};

/**
 * Fichiers qui forment un jeu : fichier principal, disquettes, pistes d'un .cue, disques d'un .m3u, jaquette (T39).
 * Partagé par le navigateur (bibliothèque locale, plate) et le serveur du Mac ou du PC (scripts/game-delete.mjs, un niveau de sous-dossier
 * comme le générateur). INVARIANT : seuls des chemins `roms/<dossier de la machine du jeu>/[sous-dossier/]fichier` sont rendus, jamais bios/.
 * @param {object} game jeu au format de games.json
 * @param {{m3uText?: string}} [options] contenu du .m3u si le fichier principal en est un
 * @returns {string[]} chemins dans l'ordre (fichier, disquettes, pistes, disques du .m3u, jaquette), sans doublon
 */
export function gameFilePaths(game, { m3uText = '' } = {}) {
  const main = segments(game?.file);
  if (!main) return [];
  const prefix = `${ROMS_DIR}/${main[1]}/`;
  const inMachine = (p) => Boolean(segments(p)) && p.startsWith(prefix);
  const base = game.file.slice(0, game.file.lastIndexOf('/') + 1);
  const fromM3u = extOf(game.file) === 'm3u' ? parseM3u(m3uText).filter((l) => !l.startsWith('/')).map((l) => base + l) : [];
  const all = [game.file, ...(game.disks ?? []), ...(game.extraFiles ?? []).map((x) => x?.file), ...fromM3u, game.cover];
  return [...new Set(all.filter(inMachine))];
}

/**
 * Fichiers de la bibliothèque du navigateur qui forment un jeu importé. La bibliothèque est plate (T27/T38) : `roms/<machine>/<fichier>`.
 * @param {object} game jeu avec `local: true` @param {{m3uText?: string}} [options]
 * @returns {string[]} [] si le jeu n'est pas local
 */
export const localGameFiles = (game, options) => (canDeleteGame(game) ? gameFilePaths(game, options).filter((p) => p.split('/').length === 3) : []);

/**
 * Textes de la confirmation (boîte createConfirmDialog, focus sur Annuler).
 * @param {string} title titre du jeu @param {number} count nombre de fichiers retirés
 * @param {'device'|'disk'} [where] bibliothèque de cet appareil (navigateur) ou disque de l'ordinateur (Mac, PC)
 */
export const deleteGameDialogOptions = (title, count = 1, where = 'device') => ({
  title: `Supprimer ${title} ?`,
  message: where === 'disk'
    ? `${title} sera effacé du disque de cet ordinateur, dans le dossier des jeux${count > 1 ? ` (${count} fichiers)` : ''}. La suppression est définitive : le fichier ne passe pas par la corbeille.`
    : `${title} sera effacé de cet appareil${count > 1 ? ` (${count} fichiers)` : ''}. La suppression est définitive : pour y rejouer, il faudra l'importer à nouveau.`,
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

/**
 * Jeu du disque du Mac ou du PC (games.json) : confirmation (« disque », définitif) puis demande au serveur local, qui ne reçoit que l'id du jeu.
 * Refus : AUCUNE demande. Ne lève jamais.
 * @param {{game: object, confirm: Function, request: (gameId: string) => Promise<{status: string, removed?: number, failed?: number, message?: string}>}} input
 * @returns {Promise<{status: 'cancelled'}|{status: 'deleted', removed: number, failed: number}|{status: 'error', message?: string}>}
 */
export async function confirmAndDeleteDiskGame({ game, confirm, request }) {
  try {
    const count = gameFilePaths(game).length;
    if (!(await confirm(deleteGameDialogOptions(game.title, count, 'disk')))) return { status: 'cancelled' };
    const r = await request(game.id);
    return r?.status === 'ok' && r.removed > 0 ? { status: 'deleted', removed: r.removed, failed: r.failed ?? 0 } : { status: 'error', message: r?.message };
  } catch {
    return { status: 'error' };
  }
}
