// Constantes de l'application (T3). Aucune dépendance. Chemins toujours relatifs (GitHub Pages sous /<dépôt>/).

/** Version du CDN EmulatorJS : SEUL endroit où la changer ou l'épingler (architecture section 4). */
export const EJS_CDN_VERSION = 'stable';
export const EJS_CDN_URL = `https://cdn.emulatorjs.org/${EJS_CDN_VERSION}/data/`;

/** Fichiers de données, relatifs à la page. */
export const SYSTEMS_URL = 'systems.json';
export const GAMES_URL = 'games.json';

/** Dossiers des jeux et BIOS (ignorés par git). Sert aux messages d'aide : `roms/<machine>/`. */
export const ROMS_DIR = 'roms';
export const BIOS_DIR = 'bios';

/** Pages de l'application. */
export const PLAYER_PAGE = 'player.html';

/** Dernière vague de machines livrée (systems.json, champ `wave`). À relever quand la vague 2 est livrée (arbitrage PO, T5). */
export const MAX_VISIBLE_WAVE = 1;
