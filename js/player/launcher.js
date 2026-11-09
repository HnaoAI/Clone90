// Lancement d'EmulatorJS (T7) : transforme (machine de systems.json, jeu de games.json) en variables EJS_* et charge loader.js.
// Dépend de config.js, data.js (assetUrl, isRelativePath).
// INVARIANT : c'est le SEUL module qui connaît EmulatorJS (CLAUDE.md règle 4). Les autres ne voient que pauseEmulator/resumeEmulator.
// INVARIANT : les variables EJS_* sont posées AVANT l'injection de loader.js (le loader les lit une seule fois à son chargement).
//
// Validé en T0 avec de vrais fichiers sur le CDN stable (Neo Geo, romset viewpoin) : EJS_onGameStart, EJS_emulator.pause()/play(),
// chemin de jeu encodé, et BIOS Neo Geo gardé zippé (voir "keepZipped" ci-dessous). Reste ouvert (pas de Kickstart ni de jeu Amiga
// réels) : 'bios/kick40068.A1200' retrouvé par puae, IPF, multi-disques.
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
 * @returns {{file: string, required: boolean, keepZipped: boolean}|null} null = pas de BIOS à fournir ; keepZipped : à poser tel quel (zip non extrait)
 * @throws {Error} si la surcharge du jeu n'est pas un chemin relatif sûr (jamais en dehors de bios/)
 */
export function resolveBios(system, game) {
  const declared = (system.bios ?? []);
  const toBios = (entry, file, required) => ({ file, required, keepZipped: entry?.keepZipped === true });
  if (game.bios != null) {
    if (!isRelativePath(game.bios)) throw new Error(`BIOS du jeu invalide : ${game.bios}`);
    return toBios(declared.find((b) => b.file === game.bios), game.bios, true);
  }
  const fallback = declared.find((b) => b.role === 'default');
  return fallback ? toBios(fallback, fallback.file, fallback.required === true) : null;
}

/** Nom de fichier sans dossier ni URL (le BIOS est posé à la racine du système de fichiers du cœur). */
const baseName = (path) => path.split('/').pop();

/**
 * Plan de lancement (fonction pure) : variables globales d'EmulatorJS, URL du loader, fichiers à contrôler.
 * BIOS "keepZipped" (Neo Geo) : EmulatorJS stable extrait toujours le zip passé à EJS_biosUrl, alors que fbneo veut `neogeo.zip`
 * entier à la racine (constaté en T0 : "ROM sp-s3.sp1 is missing"). Le plan le met donc dans `rawFiles` : loadEmulator le télécharge
 * et le pose tel quel via EJS_externalFiles (seule voie qui écrit sans extraire).
 * @param {{system: object, game: object, cdnUrl?: string}} input `cdnUrl` : surcharge pour les tests (défaut config.js)
 * @returns {{globals: Object<string, any>, loaderUrl: string, files: {kind: 'game'|'bios', path: string, url: string, required: boolean}[], rawFiles: {url: string, fsPath: string}[]}}
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
  const coreOptions = system.coreOptions ?? {};
  if (Object.keys(coreOptions).length) {
    // EmulatorJS stable n'applique EJS_defaultOptions qu'avec le stockage local coupé (sinon fichier d'options vide au 1er lancement).
    globals.EJS_defaultOptions = { ...coreOptions };
    globals.EJS_disableLocalStorage = true;
  }
  const biosUrl = bios && assetUrl(biosPath);
  const rawFiles = [];
  if (bios?.keepZipped) rawFiles.push({ url: biosUrl, fsPath: `/${baseName(bios.file)}` });
  else if (bios) globals.EJS_biosUrl = biosUrl;
  const files = [{ kind: 'game', path: game.file, url: globals.EJS_gameUrl, required: true }];
  if (bios) files.push({ kind: 'bios', path: biosPath, url: biosUrl, required: bios.required });
  return { globals, loaderUrl: `${dataUrl}loader.js`, files, rawFiles };
}

/**
 * Contrôle les fichiers du plan. Une erreur réseau compte comme introuvable (jamais de rejet).
 * Un BIOS optionnel absent est retiré du plan (EJS_biosUrl supprimé) : sinon EmulatorJS tenterait un téléchargement en 404
 * et pourrait échouer au démarrage (revue tech-lead T7).
 * @param {{globals: object, files: object[]}} plan
 * @param {(url: string) => Promise<boolean>} head vrai si le fichier répond (défaut du navigateur : headExists)
 * @returns {Promise<{missing: object[], plan: object}>} `missing` : fichiers requis introuvables ; `plan` : plan épuré
 */
export async function checkPlanFiles(plan, head) {
  const results = await Promise.all(plan.files.map(async (file) => ({ file, ok: await head(file.url).catch(() => false) })));
  const missing = results.filter((r) => !r.ok && r.file.required).map((r) => r.file);
  const absentOptional = results.filter((r) => !r.ok && !r.file.required).map((r) => r.file);
  const globals = { ...plan.globals };
  if (absentOptional.some((f) => f.kind === 'bios')) delete globals.EJS_biosUrl;
  const absentUrls = absentOptional.map((f) => f.url);
  const rawFiles = (plan.rawFiles ?? []).filter((r) => !absentUrls.includes(r.url));
  return { missing, plan: { ...plan, globals, rawFiles, files: plan.files.filter((f) => !absentOptional.includes(f)) } };
}

/** Fichiers requis introuvables (voir checkPlanFiles). */
export const findMissingFiles = async (plan, head) => (await checkPlanFiles(plan, head)).missing;

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

/** Télécharge un fichier en octets. EmulatorJS n'écrit un fichier brut que si ce sont des Uint8Array (un ArrayBuffer fait échouer l'écriture). */
export const fetchBytes = async (url) => {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

/**
 * Pose les variables EJS_* puis charge loader.js depuis le CDN.
 * @param {{globals: object, loaderUrl: string, rawFiles?: {url: string, fsPath: string}[]}} plan
 * @param {{win?: Window, doc?: Document, onStart?: () => void, getBytes?: (url: string) => Promise<Uint8Array>}} [env]
 *   injectable pour les tests ; onStart : le jeu a démarré
 * @returns {Promise<void>} résolu quand loader.js est chargé (EmulatorJS charge ensuite le cœur et le jeu tout seul)
 * @throws {Error} #game absent, BIOS illisible, ou CDN inaccessible
 */
export async function loadEmulator(plan, { win = globalThis.window, doc = globalThis.document, onStart = () => {}, getBytes = fetchBytes } = {}) {
  if (!doc.getElementById(GAME_ELEMENT_ID)) throw new Error(`Élément #${GAME_ELEMENT_ID} absent de la page`);
  const externalFiles = {};
  for (const { url, fsPath } of plan.rawFiles ?? []) {
    try { externalFiles[fsPath] = await getBytes(url); } catch (e) { throw new Error(`Fichier ${decodeURI(url)} illisible (${e.message}).`); }
  }
  return new Promise((resolve, reject) => {
    Object.assign(win, plan.globals);
    if (Object.keys(externalFiles).length) win.EJS_externalFiles = externalFiles;
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
