// Constantes de l'application (T3). Aucune dépendance. Chemins toujours relatifs (GitHub Pages sous /<dépôt>/).

/**
 * Version du CDN EmulatorJS PAR DÉFAUT : SEUL endroit où la changer pour toutes les machines (architecture section 4).
 * Épinglée à 4.2.3 (T10) : les contournements de `guardDiskMenuStartup` (js/player/launcher.js, jeux multi-disquettes) sont propres à
 * cette version, alors que 'stable' change avec le temps et pourrait les casser ou les rendre inutiles sans prévenir.
 * Une machine peut en demander une autre avec le champ facultatif `ejsVersion` de systems.json (T21 : l'Amiga est sur 4.2.1,
 * son cœur puae plante à l'éjection de disquette en 4.2.3). Pour relever la version : voir README, « Relever la version d'EmulatorJS ».
 */
export const EJS_CDN_VERSION = '4.2.3';

/** Format accepté pour une version d'EmulatorJS : x.y.z (jamais 'stable', 'latest' ni 'nightly', dont l'API change, T21). */
export const EJS_VERSION_FORMAT = /^\d+\.\d+\.\d+$/;

/**
 * SEULE fonction qui construit l'URL du CDN EmulatorJS (dossier `data/`, avec / final).
 * @param {string} [version] version voulue (champ `ejsVersion` d'une machine) ; défaut EJS_CDN_VERSION
 * @returns {string}
 * @throws {Error} si la version n'est pas au format x.y.z
 */
export function ejsDataUrl(version = EJS_CDN_VERSION) {
  if (typeof version !== 'string' || !EJS_VERSION_FORMAT.test(version)) throw new Error(`Version d'EmulatorJS invalide : ${String(version)} (x.y.z attendu)`);
  return `https://cdn.emulatorjs.org/${version}/data/`;
}

/** URL du CDN pour la version par défaut. */
export const EJS_CDN_URL = ejsDataUrl();

/** Fichiers de données, relatifs à la page. */
export const SYSTEMS_URL = 'systems.json';
export const GAMES_URL = 'games.json';

/** Dossiers des jeux et BIOS (ignorés par git). Sert aux messages d'aide : `roms/<machine>/`. */
export const ROMS_DIR = 'roms';
export const BIOS_DIR = 'bios';

/** Pages de l'application. */
export const PLAYER_PAGE = 'player.html';
export const HOME_PAGE = 'index.html';
export const SERVICE_WORKER_URL = 'sw.js';

/** Dernière vague de machines livrée (systems.json, champ `wave`). Relevée à 2 par T15 (vague 2 livrée). */
export const MAX_VISIBLE_WAVE = 2;
