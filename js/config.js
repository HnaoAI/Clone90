// Constantes de l'application (T3). Aucune dépendance. Chemins toujours relatifs (GitHub Pages sous /<dépôt>/).

/**
 * Version du CDN EmulatorJS : SEUL endroit où la changer (architecture section 4).
 * Épinglée à 4.2.3 (T10) : les contournements de `guardDiskMenuStartup` (js/player/launcher.js, jeux multi-disquettes) sont propres à
 * cette version, alors que 'stable' change avec le temps et pourrait les casser ou les rendre inutiles sans prévenir.
 * Pour relever la version : voir README, section « Relever la version d'EmulatorJS ».
 */
export const EJS_CDN_VERSION = '4.2.3';
export const EJS_CDN_URL = `https://cdn.emulatorjs.org/${EJS_CDN_VERSION}/data/`;

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

/** Dernière vague de machines livrée (systems.json, champ `wave`). À relever quand la vague 2 est livrée (arbitrage PO, T5). */
export const MAX_VISIBLE_WAVE = 1;
