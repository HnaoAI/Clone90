// Réglette de taille de l'image du jeu (T37, demandée par Hicham le 2026-11-13 : « rétrécir l'image à ma convenance », plan validé).
// Logique pure (bornes, mémorisation par machine) et la réglette elle-même ; player-main.js l'affiche pendant le jeu et pose --game-scale
// sur <body>, css/player.css réduit et centre #game. Dépend de ui/dom.js. Ne connaît pas EmulatorJS (CLAUDE.md règle 4).
// Choix validés : 40 à 100 % par pas de 5, UNE TAILLE PAR MACHINE (carte du 2026-11-13), ordinateur à souris seulement (rien en tactile).
// INVARIANT : la réglette ne garde pas le focus après un réglage à la souris (sinon les flèches du jeu la feraient bouger).
import { el } from '../ui/dom.js';

export const SCALE_MIN = 40;
export const SCALE_MAX = 100;
export const SCALE_STEP = 5;
/** Clé localStorage : objet JSON { <id de machine>: pourcentage }. */
export const SCALE_STORAGE_KEY = 'clone90-game-scale';

/** Pourcentage ramené dans [40, 100] au pas de 5 ; invalide (vide, texte, infini) : 100. @param {unknown} value @returns {number} */
export function clampScale(value) {
  const n = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  if (value === '' || !Number.isFinite(n)) return SCALE_MAX;
  return Math.min(SCALE_MAX, Math.max(SCALE_MIN, Math.round(n / SCALE_STEP) * SCALE_STEP));
}

/** Tailles gardées (objet sans prototype), ou {} si rien, illisible ou refusé. */
function readAll(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(SCALE_STORAGE_KEY) ?? 'null');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? Object.assign(Object.create(null), parsed) : Object.create(null);
  } catch { return Object.create(null); }
}

/** Taille gardée pour une machine (100 par défaut). @param {Storage|null} storage @param {string} systemId */
export function readScale(storage, systemId) {
  const all = readAll(storage);
  return Object.hasOwn(all, systemId) && typeof all[systemId] === 'number' ? clampScale(all[systemId]) : SCALE_MAX;
}

/** Garde la taille d'une machine sans toucher aux autres. Stockage refusé ou plein : ignoré. @returns {number} la valeur bornée */
export function saveScale(storage, systemId, value) {
  const scale = clampScale(value);
  try {
    const all = readAll(storage);
    all[systemId] = scale;
    storage?.setItem(SCALE_STORAGE_KEY, JSON.stringify(all));
  } catch { /* navigation privée, quota : la taille vaut pour cette partie seulement */ }
  return scale;
}

/** Texte affiché : « 75 % » (espace insécable). */
export const scaleLabel = (value) => `${clampScale(value)} %`;

/** Réglette affichée seulement avec une souris (ordinateur) ; jamais sur écran tactile. @param {typeof window.matchMedia} [matchMedia] */
export const canShowScaleControl = (matchMedia) => matchMedia?.('(hover: hover) and (pointer: fine)')?.matches === true;

/**
 * Réglette verticale (input range) avec la taille affichée au-dessus. Double-clic : 100 %.
 * @param {{value: number, onChange: (value: number) => void}} options
 * @param {Document} [doc]
 * @returns {{element: HTMLElement, input: HTMLInputElement, label: HTMLElement, set: (value: number) => void}}
 */
export function createScaleControl({ value, onChange }, doc = globalThis.document) {
  const label = el('span', { class: 'scale-value', attrs: { 'aria-hidden': 'true' } }, [], doc);
  const input = el('input', {
    class: 'scale-input',
    attrs: { type: 'range', min: String(SCALE_MIN), max: String(SCALE_MAX), step: String(SCALE_STEP), 'aria-label': 'Taille de l\'image du jeu', 'aria-orientation': 'vertical' },
  }, [], doc);
  const set = (v) => {
    const scale = clampScale(v);
    input.value = String(scale);
    label.textContent = scaleLabel(scale);
    input.setAttribute('aria-valuetext', scaleLabel(scale));
    return scale;
  };
  input.addEventListener('input', () => onChange(set(input.value)));
  input.addEventListener('pointerup', () => input.blur());
  const element = el('div', { class: 'scale-wrap', attrs: { title: 'Taille de l\'image (double-clic : 100 %)' } }, [label, input], doc);
  element.addEventListener('dblclick', () => onChange(set(SCALE_MAX)));
  set(value);
  return { element, input, label, set };
}
