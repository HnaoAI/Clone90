// Lancement d'EmulatorJS (T7) : transforme (machine de systems.json, jeu de games.json) en variables EJS_* et charge loader.js.
// Dépend de config.js, data.js (assetUrl, isRelativePath).
// INVARIANT : c'est le SEUL module qui connaît EmulatorJS (CLAUDE.md règle 4). Les autres ne voient que pauseEmulator/resumeEmulator.
// INVARIANT : les variables EJS_* sont posées AVANT l'injection de loader.js (le loader les lit une seule fois à son chargement).
//
// Validé en T0 avec de vrais fichiers sur le CDN (stable, 4.2.3 aujourd'hui) (Neo Geo, romset viewpoin) : EJS_onGameStart, EJS_emulator.pause()/play(),
// chemin de jeu encodé, et BIOS Neo Geo gardé zippé (voir "keepZipped" ci-dessous). Reste ouvert (pas de Kickstart ni de jeu Amiga
// réels) : 'bios/kick40068.A1200' retrouvé par puae, IPF, multi-disques.
// Jeu à .cue (Mega-CD, T15) : `extraFiles` du jeu posés à côté du .cue ; BIOS `preload` posés en plus (voir buildLaunchPlan).
// Multi-disquettes (T10) : voir diskSetFiles ci-dessous (m3u virtuel + disquettes posées par EJS_externalFiles).
import { EJS_CDN_URL, BIOS_DIR } from '../config.js';
import { buildRetroArchCfgExtra, appendRetroArchCfg } from './retroarch-cfg.js';
import { createStartFailureWatch, hookCoreOutput } from './ejs-start-watch.js';
import { assetUrl, assetPathFromUrl, isRelativePath } from '../data.js';

/** Délai (ms) après EJS_onGameStart pendant lequel le menu des disques peut encore "sélectionner" le disque courant tout seul (voir guardDiskMenuStartup). */
export const STARTUP_GRACE_MS = 2000;

/** Délais (ms) auxquels l'état du cœur est relu après un changement, pour le journal de diagnostic (T16). */
export const DISK_STATE_CHECK_MS = [500, 2000, 5000];

/** Source notée dans le journal quand le changement ne vient pas de nos raccourcis : le menu « Disks » d'EmulatorJS. */
export const DEFAULT_DISK_SOURCE = 'menu EmulatorJS';

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

/** Extension (minuscule, sans point) d'un chemin, '' si aucune. */
const extensionOf = (path) => (baseName(path).includes('.') ? baseName(path).split('.').pop().toLowerCase() : '');

/** Nom ASCII sûr pour le système de fichiers du cœur (aucun caractère à encoder ni à échapper dans un m3u). */
const safeFileName = (text) => text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'game';

/**
 * Jeu à plusieurs disquettes (T10) : EmulatorJS ne charge qu'un fichier de jeu, mais puae sait lire un .m3u (liste de disquettes) et
 * EmulatorJS affiche alors son menu de changement de disque. On fabrique donc côté navigateur :
 *  - un .m3u virtuel (`virtualGame`, transformé en objet File par loadEmulator : EmulatorJS garde le nom du File) ;
 *  - les disquettes, posées à la racine du système de fichiers du cœur par EJS_externalFiles sous des noms ASCII sûrs
 *    (`disk1.adf`...) : le nom réel (espaces, parenthèses, crochets) n'a ainsi aucune importance, et EmulatorJS n'encode rien.
 * Pas de commentaire (#EXTM3U) dans le m3u : EmulatorJS lit ses lignes une à une pour nommer les disques du menu.
 * @param {{id: string, disks: string[]}} game
 * @returns {{virtualGame: {name: string, text: string}, rawFiles: {url: string, fsPath: string}[]}}
 */
export function diskSetFiles(game) {
  const names = game.disks.map((path, i) => `disk${i + 1}.${extensionOf(path) || 'adf'}`);
  return {
    virtualGame: { name: `${safeFileName(game.id)}.m3u`, text: `${names.map((n, i) => `${n}|Disk ${i + 1}`).join('\n')}\n` },
    rawFiles: game.disks.map((path, i) => ({ url: assetUrl(path), fsPath: `/${names[i]}` })),
  };
}

/** Vrai si le jeu se lance avec plusieurs disquettes. */
/** T18 : seules les machines avec `diskSets: true` (Amiga) lancent un jeu en plusieurs disquettes ; ailleurs `disks` est ignoré. */
const hasDiskSet = (system, game) => system.diskSets === true && Array.isArray(game.disks) && game.disks.length > 1;

/**
 * Plan de lancement (fonction pure) : variables globales d'EmulatorJS, URL du loader, fichiers à contrôler.
 * BIOS "keepZipped" (Neo Geo) : EmulatorJS stable extrait toujours le zip passé à EJS_biosUrl, alors que fbneo veut `neogeo.zip`
 * entier à la racine (constaté en T0 : "ROM sp-s3.sp1 is missing"). Le plan le met donc dans `rawFiles` : loadEmulator le télécharge
 * et le pose tel quel via EJS_externalFiles (seule voie qui écrit sans extraire).
 * @param {{system: object, game: object, cdnUrl?: string, debug?: boolean}} input `cdnUrl` : surcharge pour les tests (défaut config.js) ; `debug` : mode diagnostic (T16), journal du cœur au niveau info
 * @returns {{globals: Object<string, any>, loaderUrl: string, files: {kind: 'game'|'bios', path: string, url: string, required: boolean}[], rawFiles: {url: string, fsPath: string}[], retroarchCfgExtra: string}}
 * @throws {Error} cœur absent, BIOS invalide
 */
export function buildLaunchPlan({ system, game, cdnUrl = EJS_CDN_URL, debug = false }) {
  if (!system.emulatorjsCore) throw new Error(`Aucun cœur EmulatorJS déclaré pour ${system.name ?? system.id}`);
  const dataUrl = withTrailingSlash(cdnUrl);
  const bios = resolveBios(system, game);
  const biosPath = bios && `${BIOS_DIR}/${bios.file}`;
  const globals = {
    EJS_player: `#${GAME_ELEMENT_ID}`,
    EJS_core: system.emulatorjsCore,
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
  const diskSet = hasDiskSet(system, game) ? diskSetFiles(game) : null;
  const rawFiles = diskSet ? [...diskSet.rawFiles] : [];
  if (!diskSet) globals.EJS_gameUrl = assetUrl(game.file);
  // T15 : fichiers cités par le .cue (Mega-CD), posés à la racine sous le nom écrit dans le .cue (le cœur les cherche à côté du .cue).
  const extraFiles = game.extraFiles ?? [];
  for (const { file, as } of extraFiles) rawFiles.push({ url: assetUrl(file), fsPath: `/${as}` });
  if (bios?.keepZipped) rawFiles.push({ url: biosUrl, fsPath: `/${baseName(bios.file)}` });
  else if (bios) globals.EJS_biosUrl = biosUrl;
  const gamePaths = [...(diskSet ? game.disks : [game.file]), ...extraFiles.map((e) => e.file)];
  const files = gamePaths.map((path) => ({ kind: 'game', path, url: assetUrl(path), required: true }));
  if (bios) files.push({ kind: 'bios', path: biosPath, url: biosUrl, required: bios.required });
  // T15 : BIOS `preload` (Mega-CD : les trois régions, le cœur prend celui de la région du disque ; Game Boy ; disksys.rom) : tous posés tels quels
  // à la racine sous leur nom exact, ceux qui existent seulement (checkPlanFiles retire les absents). EJS_biosUrl n'accepte qu'un fichier.
  for (const entry of (system.bios ?? []).filter((b) => b.preload === true && b.file !== bios?.file)) {
    const url = assetUrl(`${BIOS_DIR}/${entry.file}`);
    rawFiles.push({ url, fsPath: `/${baseName(entry.file)}` });
    files.push({ kind: 'bios', path: `${BIOS_DIR}/${entry.file}`, url, required: entry.required === true });
  }
  // T14 : lignes AJOUTÉES au retroarch.cfg d'EmulatorJS (journal d'erreurs pour détecter un échec ; raccourcis RetroArch à nul si la machine le demande).
  const retroarchCfgExtra = buildRetroArchCfgExtra({ disableHotkeys: system.disableRetroArchHotkeys !== false, debug }); // T15 : actif pour toute machine, `false` dans systems.json pour l'ôter
  // T15 : machine dont les BIOS `preload` sont facultatifs un par un mais dont il faut au moins un (Mega-CD : celui de la région du disque).
  const preloadFiles = files.filter((f) => f.kind === 'bios' && f !== files.find((x) => x.url === biosUrl));
  const atLeastOneBios = system.biosAtLeastOne === true && preloadFiles.length
    ? { urls: preloadFiles.map((f) => f.url), message: `Placez au moins un BIOS ${system.name ?? system.id} (${preloadFiles.map((f) => f.path.slice(BIOS_DIR.length + 1)).join(', ')}) dans le dossier ${BIOS_DIR}/ (nom exact, voir le README).` }
    : null;
  return { globals, loaderUrl: `${dataUrl}loader.js`, files, rawFiles, retroarchCfgExtra, atLeastOneBios, virtualGame: diskSet?.virtualGame ?? null };
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
  if (absentOptional.some((f) => f.kind === 'bios' && f.url === globals.EJS_biosUrl)) delete globals.EJS_biosUrl; // seulement le BIOS passé à EJS_biosUrl (T15 : un BIOS preload absent n'y touche pas)
  const absentUrls = absentOptional.map((f) => f.url);
  const rawFiles = (plan.rawFiles ?? []).filter((r) => !absentUrls.includes(r.url));
  if (plan.atLeastOneBios && results.filter((r) => plan.atLeastOneBios.urls.includes(r.file.url)).every((r) => !r.ok)) {
    missing.push({ kind: 'bios', path: plan.atLeastOneBios.urls[0], url: plan.atLeastOneBios.urls[0], required: true, message: plan.atLeastOneBios.message });
  }
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
export const describeMissing = (missing) => missing.map((f) => (f.message
  ? { title: 'BIOS manquant', detail: f.message }
  : f.kind === 'bios'
  ? { title: 'BIOS manquant', detail: `Placez ${f.path.slice(BIOS_DIR.length + 1)} dans le dossier ${BIOS_DIR}/ (nom exact, voir le README).` }
  : { title: 'Jeu introuvable', detail: `Le fichier ${f.path} n'existe plus. Relancez node scripts/generate-games.mjs puis rechargez la liste.` }));

/** Télécharge un fichier en octets. EmulatorJS n'écrit un fichier brut que si ce sont des Uint8Array (un ArrayBuffer fait échouer l'écriture). */
export const fetchBytes = async (url) => {
  const response = await fetch(url, { cache: 'no-cache' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

/**
 * Appelle chaque `hook(instance)` dès qu'EmulatorJS pose `window.EJS_emulator` (loader.js l.150 : `window.EJS_emulator = new EmulatorJS(...)`).
 * Un seul accesseur pour tous les contournements (deux defineProperty sur la même propriété s'écraseraient).
 * INVARIANT : à ce moment tous les scripts de loader.js sont chargés (dont GameManager.js, qui pose `window.EJS_GameManager`, l.464) et
 * le constructeur d'EmulatorJS ne démarre que des téléchargements asynchrones ; GameManager n'est créé qu'ensuite (emulator.js l.918,
 * `downloadFiles`). Les hooks sont donc posés AVANT le constructeur de GameManager.
 * @param {Window} win @param {Array<(emulator: object) => void>} hooks
 */
function onEmulatorCreated(win, hooks) {
  let instance = win.EJS_emulator;
  Object.defineProperty(win, 'EJS_emulator', {
    configurable: true,
    get: () => instance,
    set: (value) => {
      if (value && typeof value === 'object') hooks.forEach((hook) => hook(value));
      instance = value;
    },
  });
}

/**
 * Contournements de défauts d'EmulatorJS 4.2.3 (version épinglée dans config.js, à retester avant tout changement ; constatés en T10 avec puae et un jeu à plusieurs disques). startGame() construit le
 * menu des disques AVANT le menu des réglages, et ce menu "sélectionne" le disque courant au passage :
 *  1. menuOptionChanged écrit dans `allSettings`, que seul le menu des réglages crée : "Cannot set properties of undefined (setting 'disk')",
 *     puis "Failed to start game". On donne donc `allSettings = {}` à l'instance dès qu'EmulatorJS la crée (son constructeur ne démarre que
 *     des téléchargements, bien avant startGame) ; setupSettingsMenu remplace ensuite cet objet par le sien.
 *  2. Cette sélection appelle setCurrentDisk(disque déjà inséré) avant la première image : le cœur plante ("unreachable"). Pendant le
 *     démarrage seulement (jusqu'à STARTUP_GRACE_MS après EJS_onGameStart), choisir le disque déjà en place est un non-événement : on
 *     l'ignore. Ensuite on ne filtre plus (T14) : setCurrentDisk éjecte puis réinsère, donc re-choisir le disque courant sert à
 *     "réinsérer" ; le filtre laissait le lecteur vide après deux échecs de suite (index = disque 2 mais lecteur éjecté).
 *  3. Un vrai changement de disque (setCurrentDisk) lève "unreachable" au premier appel (le plateau du lecteur s'ouvre mais l'index ne
 *     change pas) et réussit au second : constaté sur 6 changements de suite, avec ou sans puae_floppy_multidrive. On rappelle donc une
 *     fois ; si le second appel échoue aussi, on tente de remettre le disque d'origine (try/catch), puis l'erreur remonte. Le jeu n'est pas fermé.
 * Journal de diagnostic (T16) : si `onTrace` est fourni, chaque changement émet des évènements {type: request|ignored|first-call|second-call|restore|state} (voir diagnostic-log.js),
 *  dont l'état du cœur 0,5 s, 2 s et 5 s après (DISK_STATE_CHECK_MS). Sans `onTrace`, aucun minuteur supplémentaire.
 * @param {{setTimer?: Function, onTrace?: Function|null, getState?: Function}} [env] minuterie, journal et lecture d'état injectables pour les tests
 * @returns {{patch: (emulator: object) => void, gameStarted: () => void}} patch : à appliquer à l'instance (onEmulatorCreated) ; gameStarted : à appeler à EJS_onGameStart (la protection de démarrage prend fin STARTUP_GRACE_MS après)
 */
function createDiskMenuGuard({ setTimer = setTimeout, onTrace = null, getState = () => null } = {}) {
  let startupOver = false;
  // Journal de diagnostic (T16) : alimenté ICI seulement, l'unique chemin de tout changement de disquette (menu, F9, Select+RB).
  const trace = (event) => { if (onTrace) { try { onTrace(event); } catch { /* le diagnostic ne casse jamais le jeu */ } } };
  const traceStateLater = () => {
    if (onTrace) for (const delayMs of DISK_STATE_CHECK_MS) setTimer(() => trace({ type: 'state', delayMs, state: getState() }), delayMs);
  };
  const patch = (emulator) => {
    emulator.allSettings ??= {};
    const handleSpecialOptions = emulator.handleSpecialOptions;
    emulator.handleSpecialOptions = function (option, value) {
      if (option !== 'disk') return handleSpecialOptions.call(this, option, value);
      const source = this.clone90DiskSource ?? DEFAULT_DISK_SOURCE;
      this.clone90DiskSource = undefined;
      const originalDisk = this.gameManager?.getCurrentDisk?.();
      trace({ type: 'request', source, value: String(value), current: originalDisk });
      if (!startupOver && Number(value) === originalDisk) { trace({ type: 'ignored', value: String(value) }); return undefined; }
      traceStateLater();
      try {
        const result = handleSpecialOptions.call(this, option, value);
        trace({ type: 'first-call', ok: true });
        return result;
      } catch (error) {
        trace({ type: 'first-call', ok: false, error });
        try {
          const result = handleSpecialOptions.call(this, option, value);
          trace({ type: 'second-call', ok: true });
          return result;
        } catch (secondError) {
          trace({ type: 'second-call', ok: false, error: secondError });
          if (Number.isInteger(originalDisk)) {
            let restored = false;
            try { handleSpecialOptions.call(this, option, String(originalDisk)); restored = true; } catch { /* rétablissement au mieux */ }
            trace({ type: 'restore', value: String(originalDisk), ok: restored });
          }
          throw secondError;
        }
      }
    };
  };
  return { patch, gameStarted: () => { setTimer(() => { startupOver = true; }, STARTUP_GRACE_MS); } };
}

/**
 * Pose les variables EJS_* puis charge loader.js depuis le CDN.
 * @param {{globals: object, loaderUrl: string, rawFiles?: {url: string, fsPath: string}[], virtualGame?: {name: string, text: string}|null}} plan
 * @param {{win?: Window, doc?: Document, onStart?: () => void, onFailure?: (info: {line: string, coreMessages: string[]}) => void, getBytes?: (url: string) => Promise<Uint8Array>, onDiskTrace?: Function, onCoreLine?: (line: string) => void}} [env]
 *   injectable pour les tests ; onStart : le jeu a démarré ; onFailure : le cœur a refusé le contenu (voir ejs-start-watch.js), au plus une fois
 * @returns {Promise<void>} résolu quand loader.js est chargé (EmulatorJS charge ensuite le cœur et le jeu tout seul)
 * @throws {Error} #game absent, BIOS illisible, ou CDN inaccessible
 */
export async function loadEmulator(plan, { win = globalThis.window, doc = globalThis.document, onStart = () => {}, onFailure = () => {}, getBytes = fetchBytes, setTimer = setTimeout, onDiskTrace = null, onCoreLine = null } = {}) {
  if (!doc.getElementById(GAME_ELEMENT_ID)) throw new Error(`Élément #${GAME_ELEMENT_ID} absent de la page`);
  const externalFiles = {};
  for (const { url, fsPath } of plan.rawFiles ?? []) {
    try { externalFiles[fsPath] = await getBytes(url); } catch (e) { throw new Error(`Fichier ${assetPathFromUrl(url)} illisible (${e.message}).`); }
  }
  return new Promise((resolve, reject) => {
    Object.assign(win, plan.globals);
    if (Object.keys(externalFiles).length) win.EJS_externalFiles = externalFiles;
    const diskGuard = plan.virtualGame ? createDiskMenuGuard({ setTimer, onTrace: onDiskTrace, getState: () => getDiskState(win) }) : null;
    onEmulatorCreated(win, [() => appendRetroArchCfg(win, plan.retroarchCfgExtra), ...(diskGuard ? [diskGuard.patch] : [])]);
    if (plan.virtualGame) win.EJS_gameUrl = new File([plan.virtualGame.text], plan.virtualGame.name, { type: 'audio/x-mpegurl' });
    const watch = createStartFailureWatch({ onFailure, setTimer });
    hookCoreOutput(win, (line) => { watch.feed(line); onCoreLine?.(line); });
    win.EJS_onGameStart = () => { diskGuard?.gameStarted(); watch.started(); onStart(); };
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

/**
 * État du lecteur de disquettes lu dans le cœur (T12) : jamais copié ailleurs, donc toujours juste même si le joueur change par le menu d'EmulatorJS.
 * @param {Window} [win]
 * @returns {{index: number, count: number}|null} null si EmulatorJS ou le cœur n'est pas prêt
 */
export function getDiskState(win = globalThis.window) {
  try {
    const manager = win.EJS_emulator?.gameManager;
    const index = manager?.getCurrentDisk?.();
    const count = manager?.getDiskCount?.();
    return Number.isInteger(index) && Number.isInteger(count) ? { index, count } : null;
  } catch { return null; }
}

/**
 * Insère la disquette `index` (0-based). INVARIANT (T12) : passe par handleSpecialOptions('disk', n), la même fonction que le menu
 * "Disks" d'EmulatorJS, donc par le contournement de guardDiskMenuStartup (rappel unique). Pas de second chemin.
 * Limite : le menu d'EmulatorJS garde sa propre sélection affichée et peut montrer l'ancien disque après un changement par raccourci.
 * @param {Window} win @param {number} index @param {string} [source] origine notée dans le journal de diagnostic ('F9', 'Select+RB'), lue puis effacée par le contournement
 * @throws {Error} EmulatorJS pas prêt, ou le changement échoue deux fois
 */
export function switchToDisk(win, index, source = DEFAULT_DISK_SOURCE) {
  const emulator = win.EJS_emulator;
  if (typeof emulator?.handleSpecialOptions !== 'function') throw new Error('EmulatorJS n\'est pas prêt');
  emulator.clone90DiskSource = source;
  emulator.handleSpecialOptions('disk', String(index));
}
