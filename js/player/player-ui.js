// Éléments d'interface de player.html (T7) : écran Jouer, messages d'erreur, chargement, bouton Menu avec anneau, rappel de sortie.
// Dépend de ui/dom.js et ui/game-grid.js (jaquette). Aucune lecture clavier ou manette (CLAUDE.md règle 3) : les actions viennent de player-main.js.
// Maquettes : docs/ux.md 3.4.
import { el } from '../ui/dom.js';
import { createCover, buildGameTiles } from '../ui/game-grid.js';
import { exitHintText } from './exit-hint.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const MENU_NAV_ID = 'menu';
export const PLAY_NAV_ID = 'play';
export const BACK_NAV_ID = 'back';

/**
 * Que faire d'une demande de sortie (Menu, F10, Select+Start, retour du navigateur) selon la phase de player-main.js.
 * INVARIANT : 'error' quitte directement (T11/A2) ; le Menu et la sortie doivent marcher même si le moteur n'a pas chargé.
 * @param {string} phase 'boot' | 'ready' | 'playing' | 'dialog' | 'error'
 * @returns {'leave'|'confirm'|'none'} quitter tout de suite, ouvrir la confirmation, ou ignorer
 */
export const exitDecision = (phase) => (phase === 'playing' ? 'confirm' : ['dialog', 'ready', 'error'].includes(phase) ? 'leave' : 'none');

/** Options de la boîte de confirmation de sortie (docs/ux.md 3.4). @param {string} gameTitle */
export const exitDialogOptions = (gameTitle) => ({
  title: `Quitter ${gameTitle} ?`,
  message: 'La partie en cours sera perdue.',
  cancelLabel: 'Continuer',
  confirmLabel: 'Quitter',
});

/** Décalage du trait de l'anneau (pathLength=100) : 100 = vide, 0 = plein. @param {number} progress 0 à 1 */
export const ringDashOffset = (progress) => 100 - Math.round(Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0)) * 100);

/**
 * Message d'erreur avant le jeu (docs/ux.md 3.4 : raison connue en clair).
 * @param {{reason: 'no-params'|'unknown-game'|'no-games'|'data'|string, gamesStatus?: string, message?: string}} error
 * @returns {{title: string, detail: string}}
 */
export function describeLoadError({ reason, gamesStatus, message }) {
  if (reason === 'no-params') return { title: 'Aucun jeu choisi', detail: 'Choisissez un jeu dans la liste pour le lancer.' };
  if (reason === 'no-games' && gamesStatus === 'absent') {
    return { title: 'Aucun jeu trouvé', detail: 'La liste des jeux n\'existe pas : déposez vos ROMs dans roms/ puis lancez node scripts/generate-games.mjs.' };
  }
  if (reason === 'no-games' && gamesStatus === 'offline') {
    return { title: 'Hors ligne', detail: 'Impossible de joindre le serveur pour lire la liste des jeux : vous êtes hors ligne, ou le serveur local est arrêté.' };
  }
  if (reason === 'unknown-game' || reason === 'no-games') return { title: 'Jeu introuvable', detail: 'Ce jeu n\'est plus dans la liste. Relancez node scripts/generate-games.mjs si vous l\'avez déplacé.' };
  if (reason === 'data') return { title: 'Impossible de charger les données', detail: message ?? 'systems.json illisible.' };
  return { title: 'Impossible de lancer ce jeu.', detail: message ?? 'Erreur inconnue.' };
}

/**
 * Écran d'erreur quand le cœur a refusé le jeu (T14). La raison est devinée d'après les messages du cœur (ex. FBNeo "ROM ... is missing").
 * @param {{coreMessages?: string[]}} [info] messages d'erreur du cœur (ejs-start-watch.js)
 * @returns {{title: string, details: string[]}}
 */
export function describeStartFailure({ coreMessages = [] } = {}) {
  const missing = coreMessages.some((m) => /missing|not found|required|introuvable|manquant/i.test(m));
  const details = [missing
    ? "Un fichier du jeu ou du BIOS est manquant ou incorrect (mauvais nom ou mauvaise version)."
    : "Le moteur a refusé ce fichier : le jeu ou le BIOS est peut-être incorrect ou incompatible.",
  "Vérifiez les dossiers roms/ et bios/ (voir le README)."];
  if (coreMessages.length) details.push(`Détail technique : ${coreMessages.at(-1)}`);
  return { title: "Ce jeu n'a pas pu démarrer", details };
}

/** Textes de l'écran Jouer. @returns {{title: string, machineName: string, playLabel: string}} */
export const playScreenModel = (machine, game) => ({ title: game.title, machineName: machine.name, playLabel: 'Jouer' });

const navButton = (label, navId, onClick, doc, extraClass = '') => el('button', {
  class: `button ${extraClass}`.trim(), text: label, attrs: { type: 'button' }, dataset: { nav: '', navId }, on: { click: onClick },
}, [], doc);

/**
 * Écran Jouer (docs/ux.md 3.4) : jaquette, titre, machine, gros bouton Jouer. Le clic est le geste qui autorise plein écran et son.
 * @param {{machine: object, game: object, onPlay: () => void}} model
 */
export function renderPlayScreen({ machine, game, onPlay }, doc = globalThis.document) {
  const text = playScreenModel(machine, game);
  const tile = buildGameTiles([game], machine)[0];
  return el('section', { class: 'play-screen' }, [
    el('div', { class: 'play-cover' }, [createCover(tile, machine, doc)], doc),
    el('h1', { class: 'play-title', text: text.title }, [], doc),
    el('p', { class: 'muted', text: text.machineName }, [], doc),
    navButton(text.playLabel, PLAY_NAV_ID, onPlay, doc, 'play-button'),
  ], doc);
}

/**
 * Écran d'erreur ou de manque (jeu, BIOS, CDN) avec une action focusable.
 * @param {{title: string, details: string[], actionLabel: string, onAction: () => void}} model
 */
export function renderPlayerMessage({ title, details, actionLabel, onAction }, doc = globalThis.document) {
  return el('section', { class: 'play-screen play-message', attrs: { role: 'alert' } }, [
    el('h1', { class: 'play-title', text: title }, [], doc),
    ...details.map((d) => el('p', { text: d }, [], doc)),
    navButton(actionLabel, BACK_NAV_ID, onAction, doc),
  ], doc);
}

/** Écran sombre de chargement, bouton Menu déjà actif (il est hors de cet écran). */
export const renderLoading = (title, doc = globalThis.document) => el('div', { class: 'loading-screen', attrs: { role: 'status' } }, [
  el('p', { class: 'play-title', text: title }, [], doc),
  el('p', { class: 'muted', text: 'Chargement...' }, [], doc),
], doc);

/** Bandeau de rappel de la sortie. @param {boolean} touchOnly tactile sans manette : texte court @param {boolean} [multiDisk] ajoute la ligne du raccourci disquette */
export const renderExitHint = (touchOnly, multiDisk = false, doc = globalThis.document) => el('p', { class: 'exit-hint', text: exitHintText(touchOnly, multiDisk), attrs: { role: 'status' } }, [], doc);

/**
 * Bouton Menu (maison + texte) entouré d'un anneau de progression (maintien Select+Start ou Échap).
 * @param {{onClick: () => void}} model
 * @returns {{element: HTMLElement, button: HTMLElement, setProgress: (progress: number) => void}}
 */
export function createMenuButton({ onClick }, doc = globalThis.document) {
  const svg = doc.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'menu-ring');
  svg.setAttribute('aria-hidden', 'true');
  const rect = doc.createElementNS(SVG_NS, 'rect');
  for (const [k, v] of Object.entries({ x: 0, y: 0, width: '100%', height: '100%', rx: 10, pathLength: 100, 'stroke-dasharray': 100, 'stroke-dashoffset': 100 })) rect.setAttribute(k, String(v));
  svg.append(rect);
  const button = el('button', { class: 'menu-button', attrs: { type: 'button', 'aria-label': 'Menu' }, dataset: { nav: '', navId: MENU_NAV_ID }, on: { click: onClick } }, [
    el('span', { text: '⌂', attrs: { 'aria-hidden': 'true' } }, [], doc),
    el('span', { text: 'Menu' }, [], doc),
  ], doc);
  const element = el('div', { class: 'menu-wrap' }, [button, svg], doc);
  let lastOffset = null;
  return {
    element,
    button,
    setProgress(progress) {
      const offset = ringDashOffset(progress);
      if (offset === lastOffset) return; // appelé à chaque frame : pas de travail DOM inutile
      lastOffset = offset;
      rect.setAttribute('stroke-dashoffset', String(offset));
      element.classList.toggle('is-holding', offset < 100);
    },
  };
}
