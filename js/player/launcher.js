// Lancement d'EmulatorJS (T7) : transforme (machine de systems.json, jeu de games.json) en variables EJS_* et charge loader.js.
// Dépend de config.js, data.js (assetUrl, isRelativePath).
// INVARIANT : c'est le SEUL module qui connaît EmulatorJS (CLAUDE.md règle 4). Les autres ne voient que pauseEmulator/resumeEmulator.
// INVARIANT : les variables EJS_* sont posées AVANT l'injection de loader.js (le loader les lit une seule fois à son chargement).
//
// TODO(T0) : tout ce qui touche à EmulatorJS ci-dessous suit la doc (https://emulatorjs.org/docs/options) et n'a pas été
// essayé avec de vraies ROMs. À valider avec de vrais fichiers : (1) EJS_gameUrl avec un chemin encodé (%20, accents),
// (2) EJS_biosUrl = 'bios/neogeo.zip' et 'bios/kick40068.A1200' retrouvés par fbneo et puae, (3) EJS_onGameStart existe
// bien dans la version stable du CDN, (4) EJS_emulator.pause()/play() existent et coupent le son.
import { EJS_CDN_URL, BIOS_DIR } from '../config.js';
import { assetUrl, isRelativePath } from '../data.js';

/** Id de l'élément qui reçoit EmulatorJS (EJS_player = '#game'). */
export const GAME_ELEMENT_ID = 'game';

const withTrailingSlash = (url) => (url.endsWith('/') ? url : `${url}/`);

/**
 * BIOS à utiliser : la surcharge du jeu (obligatoire, la personne l'a demandée), sinon celle de la machine
 * (role "default"), requise ou non selon systems.json.
 * @param {object} system machine de systems.json
 * @param {object} game jeu de games.json
 * @returns {{file: string, required: boolean}|null} null = pas de BIOS à fournir
 * @throws {Error} si la surcharge du jeu n'est pas un chemin relatif sûr (jamais en dehors de bios/)
 */
export function resolveBios(system, game) {
  if (game.bios != null) {
    if (!isRelativePath(game.bios)) throw new Error(`BIOS du jeu invalide : ${game.bios}`);
    return { file: game.bios, required: true };
  }
  const fallback = (system.bios ?? []).find((b) => b.role === 'default');
  return fallback ? { file: fallback.file, required: fallback.required === true } : null;
}

/**
 * Plan de lancement (fonction pure) : variables globales d'EmulatorJS, URL du loader, fichiers à contrôler.
 * @param {{system: object, game: object, cdnUrl?: string}} input `cdnUrl` : surcharge pour les tests (défaut config.js)
 * @returns {{globals: Object<string, any>, loaderUrl: string, files: {kind: 'game'|'bios', path: string, url: string, required: boolean}[]}}
 * @throws {Error} cœur absent, BIOS invalide
 */
export function buildLaunchPlan({ system, game, cdnUrl = EJS_CDN_URL }) {
  if (!system.emulatorjsCore) throw new Error(`Aucun cœur EmulatorJS déclaré pour ${system.name ?? system.id}`);
  const dataUrl = withTrailingSlash(cdnUrl);
  const bios = resolveBios(system, game);
  const biosPath = bios && `${BIOS_DIR}/${bios.file}`;
  const globals = {
    EJS_player: `#${GAME_ELEMENT_ID}`,
    EJS_core: system.emulatorjsCore,
    EJS_gameUrl: assetUrl(game.file),
    EJS_pathtodata: dataUrl,
    EJS_gameName: game.title,
    EJS_startOnLoaded: true,
    EJS_askBeforeExit: false, // la sortie passe par notre confirmation (exit-guard + dialog), pas par beforeunload
  };
  if (bios) globals.EJS_biosUrl = assetUrl(biosPath);
  const files = [{ kind: 'game', path: game.file, url: globals.EJS_gameUrl, required: true }];
  if (bios) files.push({ kind: 'bios', path: biosPath, url: globals.EJS_biosUrl, required: bios.required });
  return { globals, loaderUrl: `${dataUrl}loader.js`, files };
}

/**
 * Fichiers requis introuvables. Une erreur réseau compte comme introuvable (jamais de rejet).
 * @param {{files: object[]}} plan
 * @param {(url: string) => Promise<boolean>} head vrai si le fichier répond (défaut du navigateur : headExists)
 */
export async function findMissingFiles(plan, head) {
  const checked = await Promise.all(plan.files.map(async (f) => {
    const ok = await head(f.url).catch(() => false);
    return !ok && f.required ? f : null;
  }));
  return checked.filter(Boolean);
}

/** Contrôle par requête HEAD (le serveur local la gère, GitHub Pages aussi). */
export const headExists = async (url) => (await fetch(url, { method: 'HEAD', cache: 'no-cache' })).ok;

/**
 * Messages d'erreur pour les fichiers manquants (docs/ux.md 3.4 : raison connue en clair).
 * @param {{kind: string, path: string}[]} missing
 * @returns {{title: string, detail: string}[]}
 */
export const describeMissing = (missing) => missing.map((f) => (f.kind === 'bios'
  ? { title: 'BIOS manquant', detail: `Placez ${f.path.slice(BIOS_DIR.length + 1)} dans le dossier ${BIOS_DIR}/ (nom exact, voir le README).` }
  : { title: 'Jeu introuvable', detail: `Le fichier ${f.path} n'existe plus. Relancez node scripts/generate-games.mjs puis rechargez la liste.` }));

/**
 * Pose les variables EJS_* puis charge loader.js depuis le CDN.
 * @param {{globals: object, loaderUrl: string}} plan
 * @param {{win?: Window, doc?: Document, onStart?: () => void}} [env] injectable pour les tests ; onStart : le jeu a démarré
 * @returns {Promise<void>} résolu quand loader.js est chargé (EmulatorJS charge ensuite le cœur et le jeu tout seul)
 * @throws {Error} #game absent, ou CDN inaccessible
 */
export function loadEmulator(plan, { win = globalThis.window, doc = globalThis.document, onStart = () => {} } = {}) {
  return new Promise((resolve, reject) => {
    if (!doc.getElementById(GAME_ELEMENT_ID)) { reject(new Error(`Élément #${GAME_ELEMENT_ID} absent de la page`)); return; }
    Object.assign(win, plan.globals);
    win.EJS_onGameStart = onStart;
    const script = doc.createElement('script');
    script.src = plan.loaderUrl;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('EmulatorJS inaccessible : vérifiez la connexion internet (le moteur est chargé depuis son CDN).'));
    doc.head.append(script);
  });
}

/**
 * Appelle une méthode d'EmulatorJS sans jamais lever : avant que le cœur soit chargé, pause()/play() lèvent
 * (constaté : "Cannot read properties of undefined (reading 'toggleMainLoop')"), ce qui bloquerait la confirmation de sortie.
 */
function callEmulator(win, method) {
  const emulator = win.EJS_emulator;
  if (typeof emulator?.[method] !== 'function') return false;
  try { emulator[method](); return true; } catch { return false; }
}

/** Met le jeu en pause (et le son avec). @returns {boolean} faux si EmulatorJS n'est pas prêt */
export const pauseEmulator = (win = globalThis.window) => callEmulator(win, 'pause');

/** Reprend le jeu après une pause. @returns {boolean} faux si EmulatorJS n'est pas prêt */
export const resumeEmulator = (win = globalThis.window) => callEmulator(win, 'play');
