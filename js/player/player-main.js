// Point d'entrée de player.html (T7) : Jouer, lancement d'EmulatorJS, sortie confirmée, retour avec focus.
// Dépend de data, router, input/*, ui/dialog, ui/input-mode et de player/* (launcher, exit-guard, exit-hint, player-ui).
// Phases : boot -> ready (écran Jouer) -> playing -> dialog (confirmation, jeu en pause) ; error à tout moment avant le jeu.
// INVARIANT : pendant 'playing', la source d'actions est passive (isActive) : clavier et manette appartiennent au jeu.
// Seuls exit-guard (lecture seule) et le bouton Menu peuvent demander la sortie.
import { HOME_PAGE } from '../config.js';
import { loadData } from '../data.js';
import { parsePlayerParams, buildReturnUrl } from '../router.js';
import { createActionSource } from '../input/actions.js';
import { createFocusNavigator } from '../input/focus-nav.js';
import { createConfirmDialog } from '../ui/dialog.js';
import { setGamepadMode, watchPointer } from '../ui/input-mode.js';
import { createToast } from '../ui/toast.js';
import { clear } from '../ui/dom.js';
import { buildLaunchPlan, checkPlanFiles, headExists, describeMissing, loadEmulator, pauseEmulator, resumeEmulator, getDiskState, switchToDisk } from './launcher.js';
import { createExitGuard } from './exit-guard.js';
import { createDiskShortcut, diskToastText, DISK_ERROR_TEXT } from './disk-shortcut.js';
import { shouldShowExitHint, EXIT_HINT_MS } from './exit-hint.js';
import {
  renderPlayScreen, renderPlayerMessage, renderLoading, renderExitHint, createMenuButton, exitDialogOptions,
  describeLoadError, describeStartFailure, exitDecision, PLAY_NAV_ID, BACK_NAV_ID,
} from './player-ui.js';

const MENU_IDLE_MS = 3000;
const LOADING_MAX_MS = 30000;
const screen = document.getElementById('screen');
const gameElement = document.getElementById('game');
const chrome = document.getElementById('chrome');
const toast = createToast(document.getElementById('toast'));
const nav = createFocusNavigator({ getRoot: () => document.body });

let phase = 'boot';
let dialog = null;
let leaveUrl = HOME_PAGE;
let menu = null;
let currentGameTitle = '';
let diskCount = 1;
let pendingStartFailure = null; // échec du cœur arrivé pendant la boîte de confirmation (T14)
let exitHint = null;

/** Quitte la page (location.replace : le jeu n'a pas besoin d'être dans l'historique). Le déchargement coupe moteur et son. */
function leave(url) {
  window.removeEventListener('popstate', onPopState);
  try { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); } catch { /* meilleur effort */ }
  location.replace(url);
}
const goBack = () => leave(leaveUrl);

function showMessage({ title, details, actionLabel = 'Revenir à la liste' }) {
  phase = 'error';
  clear(screen);
  screen.append(renderPlayerMessage({ title, details, actionLabel, onAction: goBack }));
  nav.focusById(BACK_NAV_ID);
}

const showLoadError = (error, url) => {
  leaveUrl = url;
  const { title, detail } = describeLoadError(error);
  showMessage({ title, details: [detail], actionLabel: url === HOME_PAGE ? 'Revenir à l\'accueil' : 'Revenir à la liste' });
};

/** Demande de sortie (garde, bouton Menu, retour du navigateur). Pendant la confirmation, répéter la demande = Quitter. */
function requestExit() {
  const decision = exitDecision(phase);
  if (decision === 'leave') goBack();
  else if (decision === 'confirm') openExitDialog();
}

async function openExitDialog() {
  phase = 'dialog';
  pauseEmulator(window);
  dialog = createConfirmDialog(exitDialogOptions(currentGameTitle));
  dialog.open(document.body);
  const confirmed = await dialog.result;
  dialog = null;
  if (confirmed) { goBack(); return; }
  resumeEmulator(window);
  phase = 'playing';
  if (pendingStartFailure) showStartFailure(pendingStartFailure);
}

/**
 * Le cœur a refusé le jeu (T14) : RetroArch affiche son menu natif ; on le coupe et on montre notre erreur.
 * INVARIANT (T11/A2) : phase 'error', donc garde, popstate et bouton Menu restent armés et la sortie se fait en un appui.
 */
function showStartFailure(info) {
  if (phase === 'dialog') { pendingStartFailure = info; return; }
  if (phase !== 'playing') return;
  pendingStartFailure = null;
  pauseEmulator(window);
  exitHint?.remove();
  diskShortcut.stop();
  gameElement.hidden = true;
  document.body.classList.remove('is-playing');
  const { title, details } = describeStartFailure(info);
  console.error('Le cœur a refusé le jeu :', info);
  showMessage({ title, details });
}

function onPopState() {
  history.pushState({ clone90: 'exit-guard' }, ''); // remet la sentinelle : le retour système ne quitte jamais directement
  if (phase === 'dialog') dialog?.handleAction('back');
  else requestExit();
}

const guard = createExitGuard({
  onRequest: () => requestExit(),
  onProgress: (p) => menu?.setProgress(p),
  onEscapeTap: () => { if (phase === 'dialog') dialog?.handleAction('back'); },
});

/** Raccourci de disquette (T12) : seulement pendant le jeu (pas avec la boîte de confirmation ouverte), jeu à plusieurs disquettes seulement. */
const diskShortcut = createDiskShortcut({
  isEnabled: () => phase === 'playing',
  getDiskState: () => getDiskState(window),
  changeDisk: (index) => switchToDisk(window, index),
  onChanged: (index, count) => toast(diskToastText(index, count)),
  onError: (error) => { console.error('Changement de disquette impossible :', error); toast(DISK_ERROR_TEXT); },
});

function onAction(action, source) {
  setGamepadMode(source === 'gamepad');
  if (phase === 'dialog') {
    // Échap (clavier) est traité par le garde : tap = Continuer, maintenu 1 s = Quitter. Sinon Échap fermerait la boîte avant 1 s.
    // Manette : tant que Select ou Start est tenu, "valider" est ignoré, sinon répéter Select+Start (= Quitter) fermerait la boîte (Start = valider).
    const ignored = (action === 'back' && source === 'keyboard') || (action === 'confirm' && source === 'gamepad' && guard.isSelectOrStartHeld());
    if (!ignored) dialog?.handleAction(action);
  } else if (phase === 'ready' || phase === 'error') {
    if (action === 'back') goBack(); else nav.handleAction(action);
  }
}

const actions = createActionSource({
  isActive: () => phase !== 'playing',
  hasFocusedTarget: nav.hasFocus,
  onWake: () => {
    setGamepadMode(true);
    if (phase === 'playing') return; // pas de message par-dessus le jeu
    toast('Manette connectée');
    if (phase === 'ready') nav.focusById(PLAY_NAV_ID);
    else if (phase === 'error') nav.focusById(BACK_NAV_ID);
  },
});

/** Bouton Menu masqué après 3 s sans mouvement de souris (appareils à souris seulement, docs/ux.md 3.4). */
function watchMenuIdle() {
  if (!window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) return;
  let timer = null;
  const wake = () => {
    chrome.classList.remove('is-idle');
    clearTimeout(timer);
    if (phase === 'playing') timer = setTimeout(() => chrome.classList.add('is-idle'), MENU_IDLE_MS);
  };
  window.addEventListener('mousemove', wake, { passive: true });
}

/** @returns {HTMLElement|null} le rappel affiché (pour le retirer si le moteur échoue), ou null */
function showExitHint() {
  let storage = null;
  try { storage = window.localStorage; } catch { /* accès refusé */ }
  if (!shouldShowExitHint(storage)) return null;
  const noPointerHover = window.matchMedia?.('(hover: none)').matches === true;
  const hasGamepad = Array.from(navigator.getGamepads?.() ?? []).some(Boolean);
  const hint = renderExitHint(noPointerHover && !hasGamepad, diskCount > 1);
  chrome.append(hint);
  setTimeout(() => hint.remove(), EXIT_HINT_MS);
  return hint;
}

async function play(plan) {
  if (phase !== 'ready') return;
  phase = 'playing';
  // Geste utilisateur : plein écran tout de suite (meilleur effort, refusé = on joue en fenêtre).
  try { document.documentElement.requestFullscreen?.().catch(() => {}); } catch { /* non supporté */ }
  clear(screen);
  const loading = renderLoading(currentGameTitle);
  screen.append(loading);
  gameElement.hidden = false;
  document.body.classList.add('is-playing');
  const hideLoading = () => loading.remove();
  setTimeout(hideLoading, LOADING_MAX_MS); // si EJS_onGameStart n'arrive jamais, l'interface d'EmulatorJS reste utilisable
  guard.start();
  if (diskCount > 1) diskShortcut.start();
  history.pushState({ clone90: 'exit-guard' }, '');
  window.addEventListener('popstate', onPopState);
  exitHint = showExitHint();
  try {
    await loadEmulator(plan, { onStart: hideLoading, onFailure: showStartFailure });
  } catch (e) {
    // INVARIANT (T11/A2) : on reste armé (garde, popstate, bouton Menu) : phase 'error' quitte en un seul appui.
    exitHint?.remove();
    diskShortcut.stop();
    gameElement.hidden = true;
    document.body.classList.remove('is-playing');
    showMessage({ title: 'Impossible de lancer ce jeu.', details: [e.message] });
  }
}

async function main() {
  watchPointer();
  actions.start(onAction);
  watchMenuIdle();
  const { system: systemId, game: gameId } = parsePlayerParams(location.search);
  if (!systemId || !gameId) { showLoadError({ reason: 'no-params' }, HOME_PAGE); return; }
  let data;
  try {
    data = await loadData();
  } catch (e) {
    console.error('Chargement de systems.json impossible :', e.cause ?? e);
    showLoadError({ reason: 'data', message: e.message }, HOME_PAGE);
    return;
  }
  const system = data.systems.find((s) => s.id === systemId);
  const game = data.games.find((g) => g.id === gameId && g.system === systemId);
  if (!system) { showLoadError({ reason: 'unknown-game' }, HOME_PAGE); return; }
  if (!game) {
    showLoadError({ reason: data.gamesStatus === 'ok' ? 'unknown-game' : 'no-games', gamesStatus: data.gamesStatus }, buildReturnUrl(systemId, null));
    return;
  }
  leaveUrl = buildReturnUrl(systemId, game.id);
  currentGameTitle = game.title;
  diskCount = game.disks?.length ?? 1;
  let plan;
  try {
    plan = buildLaunchPlan({ system, game });
  } catch (e) {
    showMessage({ title: 'Impossible de lancer ce jeu.', details: [e.message] });
    return;
  }
  const checked = await checkPlanFiles(plan, headExists);
  plan = checked.plan;
  const { missing } = checked;
  if (missing.length) {
    showMessage({ title: describeMissing(missing)[0].title, details: describeMissing(missing).map((m) => m.detail) });
    return;
  }
  phase = 'ready';
  menu = createMenuButton({ onClick: () => requestExit() });
  chrome.append(menu.element);
  screen.append(renderPlayScreen({ machine: system, game, onPlay: () => play(plan) }));
  nav.focusById(PLAY_NAV_ID);
}

main();
