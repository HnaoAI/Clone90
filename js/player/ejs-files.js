// Fichiers qu'EmulatorJS télécharge sur son CDN pour lancer une machine (T46, jouer hors ligne). Pur, sans DOM ni réseau.
// Importé par launcher.js seulement, qui le réexporte (CLAUDE.md règle 4 : seul launcher.js et ses modules connaissent EmulatorJS).
// Dépend de config.js (ejsDataUrl, EJS_CDN_VERSION).
// Relevé dans le code d'EmulatorJS 4.2.3 (paquet npm @emulatorjs/emulatorjs) : data/loader.js (emulator.min.js, emulator.min.css,
// localization/<langue>.json), src/emulator.js (getCores, downloadGameCore : cores/reports/<cœur>.json puis cores/<cœur>[-thread][-legacy]-wasm.data)
// et src/compression.js (compression/extract7z.js, extractzip.js, libunrar.js et .wasm). 4.2.1 (Amiga, T21) a les mêmes noms.
// INVARIANT : à relire si EJS_CDN_VERSION ou un `ejsVersion` change (README, « Relever la version d'EmulatorJS ») : un nom changé ici
// casse seulement le jeu hors ligne (en ligne, sw.js garde de toute façon ce qu'EmulatorJS demande vraiment).
import { ejsDataUrl, EJS_CDN_VERSION } from '../config.js';

/**
 * Cœur par défaut de chaque nom de système d'EmulatorJS (getCores de src/emulator.js 4.2.3, premier de la liste).
 * Seuls les systèmes possibles dans systems.json comptent ; un nom absent est déjà un nom de cœur (« fceumm »).
 */
const DEFAULT_CORES = {
  amiga: 'puae', arcade: 'fbneo', nes: 'fceumm', snes: 'snes9x', gb: 'gambatte', gba: 'mgba', segaMS: 'smsplus', segaMD: 'genesis_plus_gx',
  segaGG: 'genesis_plus_gx', segaCD: 'genesis_plus_gx', sega32x: 'picodrive', sega: 'genesis_plus_gx', pce: 'mednafen_pce', pcfx: 'mednafen_pcfx',
  ngp: 'mednafen_ngp', ws: 'mednafen_wswan', lynx: 'handy', mame: 'mame2003_plus', psx: 'pcsx_rearmed', n64: 'mupen64plus_next', nds: 'melonds',
  atari2600: 'stella2014', atari5200: 'a5200', atari7800: 'prosystem', jaguar: 'virtualjaguar', vb: 'beetle_vb', coleco: 'gearcoleco', c64: 'vice_x64sc',
};

/** Cœurs qui exigent WebGL 2 (requiresWebGL2 d'EmulatorJS) : jamais de variante « legacy ». */
const WEBGL2_ONLY = ['ppsspp'];

/** Fichiers communs à toutes les machines, relatifs au dossier data/ du CDN. libunrar : jeux en .rar, rares mais possibles. */
export const ENGINE_BASE_FILES = Object.freeze([
  'loader.js', 'emulator.min.js', 'emulator.min.css',
  'compression/extract7z.js', 'compression/extractzip.js', 'compression/libunrar.js', 'compression/libunrar.wasm',
]);

/** Langue au format d'EmulatorJS (« fr-FR ») : lettres, chiffres et tirets seulement, sinon pas de fichier de traduction. */
const LOCALE = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3}$/;

/**
 * Nom du cœur qu'EmulatorJS télécharge pour `EJS_core` (champ `emulatorjsCore` de systems.json).
 * @param {string} emulatorjsCore @returns {string}
 */
export const ejsCoreFor = (emulatorjsCore) => DEFAULT_CORES[emulatorjsCore] ?? emulatorjsCore;

/**
 * Version d'EmulatorJS d'une machine : `ejsVersion` (T21), sinon la version par défaut.
 * @param {{ejsVersion?: string}} system @returns {string}
 */
export const engineVersionOf = (system) => system?.ejsVersion ?? EJS_CDN_VERSION;

/**
 * Adresse du rapport du cœur (`cores/reports/<cœur>.json`) : EmulatorJS y lit `options.defaultWebGL2`, qui choisit la variante du cœur.
 * @param {object} system machine de systems.json @returns {string}
 * @throws {Error} si `ejsVersion` est mal formé
 */
export const engineReportUrl = (system) => `${ejsDataUrl(system.ejsVersion)}cores/reports/${ejsCoreFor(system.emulatorjsCore)}.json`;

/**
 * Fichiers du CDN à garder pour lancer `system` sans réseau.
 * Variante du cœur comme dans downloadGameCore : jamais « -thread » (Clone90 ne pose pas EJS_threads), « -legacy » sauf si l'appareil
 * a WebGL 2 et que le rapport le demande (ou que le cœur l'exige). Rapport illisible : EmulatorJS prend « legacy », ici aussi.
 * @param {{system: object, report?: unknown, webgl2?: boolean, locale?: string}} input `locale` : Intl.DateTimeFormat().resolvedOptions().locale
 * @returns {{url: string, optional: boolean}[]} `optional` : absent du CDN sans gêner le jeu (traduction, rapport)
 */
export function engineFiles({ system, report = null, webgl2 = false, locale } = {}) {
  const data = ejsDataUrl(system.ejsVersion);
  const core = ejsCoreFor(system.emulatorjsCore);
  const wantsWebgl2 = WEBGL2_ONLY.includes(core) || (report !== null && typeof report === 'object' && report.options?.defaultWebGL2 === true);
  const legacy = webgl2 && wantsWebgl2 ? '' : '-legacy';
  const files = ENGINE_BASE_FILES.map((f) => ({ url: `${data}${f}`, optional: false }));
  if (typeof locale === 'string' && LOCALE.test(locale)) files.push({ url: `${data}localization/${locale}.json`, optional: true });
  files.push({ url: engineReportUrl(system), optional: true });
  files.push({ url: `${data}cores/${core}${legacy}-wasm.data`, optional: false });
  return files;
}
