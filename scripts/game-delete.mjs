// Suppression d'un jeu sur le disque du Mac ou du PC (T39, « Supprimer le fichier » de l'écran Jouer). Appelé par settings-api.mjs
// (POST /api/games/delete), qui ne reçoit que l'id du jeu : les fichiers sont ceux de games.json (gameFilePaths, partagé avec le navigateur).
// Dépend de js/local-game-delete.js et serve.mjs (isLocalOnlyHost).
// INVARIANT (sécurité, Hicham 2026-11-14) : on n'efface que des FICHIERS (jamais un dossier) situés dans le dossier d'une machine, sous le
//   dossier des jeux utilisé (roms/ du projet ou celui de clone90.local.json), vérifié sur le vrai chemin (realpath : un lien qui sort est refusé).
//   Jamais bios/, jamais un chemin venu du navigateur. Seulement si le serveur n'écoute que sur cet ordinateur (isGameDeleteEnabled).
import { readFile, realpath, lstat, unlink } from 'node:fs/promises';
import { join, dirname, sep } from 'node:path';
import { gameFilePaths } from '../js/local-game-delete.js';
import { isLocalOnlyHost } from './serve.mjs';

/** Taille maximale lue d'un .m3u (liste de disques). */
const MAX_M3U_BYTES = 256 * 1024;

/**
 * La suppression sur le disque n'existe que si le serveur n'écoute que sur cet ordinateur (lanceur du Mac, `--host 127.0.0.1` sur un PC).
 * Ouvert au réseau local : jamais (un autre appareil du Wi-Fi pourrait effacer les jeux). Tout système (Mac, PC).
 * @param {string|undefined} host adresse d'écoute
 */
export const isGameDeleteEnabled = (host) => typeof host === 'string' && isLocalOnlyHost(host);

/** Chemin disque d'une adresse `roms/...` sous le dossier des jeux. */
const toDisk = (romsDir, webPath) => join(romsDir, ...webPath.split('/').slice(1));

/** Vrai si `child` est STRICTEMENT dans `parent` (chemins réels). */
const isInside = (parent, child) => child.startsWith(parent.endsWith(sep) ? parent : parent + sep);

/**
 * Efface les fichiers d'un jeu de games.json.
 * @param {{root: string, romsDir: string, gameId: unknown}} input racine du projet (games.json), dossier des jeux utilisé, id reçu du navigateur
 * @returns {Promise<{status: 'not-found'}|{status: 'ok'|'error', removed: string[], failed: string[], missing: string[]}>}
 *   ok : au moins un fichier effacé ou déjà absent, aucun refus ; error : un fichier refusé (dossier, lien qui sort, droits) ou rien effacé
 */
export async function deleteGameFromDisk({ root, romsDir, gameId }) {
  if (typeof gameId !== 'string' || !gameId || gameId.length > 512) return { status: 'not-found' };
  let games;
  try { games = JSON.parse(await readFile(join(root, 'games.json'), 'utf8')).games; } catch { return { status: 'not-found' }; }
  const game = Array.isArray(games) ? games.find((g) => g && g.id === gameId) : null;
  if (!game) return { status: 'not-found' };
  const realRoms = await realpath(romsDir);
  let m3uText = '';
  if (/\.m3u$/i.test(game.file ?? '')) {
    try {
      const file = toDisk(romsDir, game.file);
      if ((await lstat(file)).size <= MAX_M3U_BYTES) m3uText = await readFile(file, 'utf8');
    } catch { /* .m3u absent : seuls les autres fichiers */ }
  }
  const removed = [];
  const failed = [];
  const missing = [];
  for (const webPath of gameFilePaths(game, { m3uText })) {
    const file = toDisk(romsDir, webPath);
    try {
      const realParent = await realpath(dirname(file));
      // Le dossier parent doit être un dossier de machine (ou son sous-dossier) DANS le dossier des jeux, jamais le dossier des jeux lui-même.
      if (!isInside(realRoms, realParent)) { failed.push(webPath); continue; }
      const info = await lstat(file);
      if (!info.isFile() && !info.isSymbolicLink()) { failed.push(webPath); continue; } // un lien est retiré, jamais sa cible
      await unlink(file);
      removed.push(webPath);
    } catch (err) {
      if (err.code === 'ENOENT') missing.push(webPath); else failed.push(webPath);
    }
  }
  const ok = failed.length === 0 && removed.length + missing.length > 0;
  return { status: ok ? 'ok' : 'error', removed, failed, missing };
}
