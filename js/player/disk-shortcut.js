// Raccourci "disquette suivante" pendant le jeu (T12) : Select maintenu + RB (manette), F9 (clavier). Dépend de exit-guard.js (numéros de boutons).
// INVARIANT : comme exit-guard.js, ce module est en LECTURE SEULE sur le jeu : il écoute en capture, ne fait jamais stopPropagation et
// ne fait preventDefault que sur F9. Aucune autre touche ni aucun autre bouton ne lui appartient (docs/ux.md 4.4).
// INVARIANT : jamais Start seul ni Select+Start (réservés à la sortie) ; ne touche ni F10 ni Échap.
// Il ne connaît pas EmulatorJS : l'état du disque (getDiskState) et le changement (changeDisk) sont injectés par player-main.js depuis launcher.js.
import { PAD_SELECT, PAD_START } from './exit-guard.js';

export const DISK_KEY = 'F9';
/** RB dans le mapping standard. */
export const PAD_NEXT_DISK = 5;

/** Disquette suivante, en cycle (la dernière revient à la première). @param {number} index courant (0 à count-1) @param {number} count */
export const nextDiskIndex = (index, count) => (Number.isInteger(index) && index >= 0 && index + 1 < count ? index + 1 : 0);

/** Texte du toast (docs/ux.md 4.4). @param {number} index 0-based @param {number} count */
export const diskToastText = (index, count) => `Disquette ${index + 1} / ${count}`;

/** Message si le changement échoue (deux échecs de suite). */
export const DISK_ERROR_TEXT = 'Changement de disquette impossible';

const usablePads = (pads) => Array.from(pads ?? []).filter((pad) => pad && pad.connected !== false);
const isDown = (pad, button) => pad.buttons?.[button]?.pressed === true;

/** Vrai si RB est tenu sur une manette. @param {ArrayLike<Gamepad|null>|null} pads */
export const isPadRbHeld = (pads) => usablePads(pads).some((pad) => isDown(pad, PAD_NEXT_DISK));

/** Vrai si une même manette tient Select + RB sans Start (avec Start, c'est la sortie). @param {ArrayLike<Gamepad|null>|null} pads */
export const isNextDiskPadHeld = (pads) => usablePads(pads).some((pad) => isDown(pad, PAD_SELECT) && isDown(pad, PAD_NEXT_DISK) && !isDown(pad, PAD_START));

const hasModifier = (e) => e.ctrlKey || e.altKey || e.metaKey;

/**
 * Raccourci de changement de disquette. Tout est injectable pour les tests.
 * @param {object} options
 * @param {() => ({index: number, count: number}|null)} options.getDiskState état lu dans le cœur à chaque appui (jamais copié) ; null = indisponible
 * @param {(index: number) => (void|Promise<void>)} options.changeDisk même fonction que le menu d'EmulatorJS ; peut lever ou rejeter
 * @param {(index: number, count: number) => void} options.onChanged changement réussi (toast)
 * @param {(error: Error) => void} [options.onError] changement échoué
 * @param {() => boolean} [options.isEnabled] faux hors phase de jeu (boîte de confirmation ouverte)
 * @param {EventTarget} [options.target] défaut : window
 * @param {() => ArrayLike<Gamepad|null>} [options.getGamepads]
 * @param {(f: Function) => any} [options.requestFrame]
 * @param {(id: any) => void} [options.cancelFrame]
 * @returns {{start: () => void, stop: () => void}}
 */
export function createDiskShortcut(options) {
  const {
    getDiskState, changeDisk, onChanged, onError = () => {}, isEnabled = () => true,
    target = globalThis.window,
    getGamepads = () => globalThis.navigator?.getGamepads?.() ?? [],
    requestFrame = (f) => globalThis.requestAnimationFrame(f),
    cancelFrame = (id) => globalThis.cancelAnimationFrame(id),
  } = options;
  let busy = false;
  let stopCurrent = null;

  const finish = (error, index, count) => {
    busy = false;
    if (error) onError(error instanceof Error ? error : new Error(String(error)));
    else onChanged(index, count);
  };

  /** Passe à la disquette suivante si le jeu en a plusieurs. Ignoré pendant un changement en cours. */
  function trigger() {
    if (busy || !isEnabled()) return;
    const state = getDiskState();
    if (!state || !(state.count > 1)) return;
    const index = nextDiskIndex(state.index, state.count);
    busy = true;
    let result;
    try { result = changeDisk(index); } catch (error) { finish(error); return; }
    if (typeof result?.then === 'function') result.then(() => finish(null, index, state.count), (error) => finish(error));
    else finish(null, index, state.count);
  }

  function start() {
    stop();
    let frameId = null;
    let rbWasHeld = false;
    const onKeyDown = (e) => {
      if (e.key !== DISK_KEY || hasModifier(e)) return;
      e.preventDefault();
      if (!e.repeat) trigger();
    };
    // Front montant de RB avec Select déjà tenu : un appui maintenu ne change qu'une fois, et RB pressé avant Select (bouton de jeu) ne compte pas.
    const loop = () => {
      const pads = getGamepads() ?? [];
      const rbHeld = isPadRbHeld(pads);
      if (!rbWasHeld && isNextDiskPadHeld(pads)) trigger();
      rbWasHeld = rbHeld;
      frameId = requestFrame(loop);
    };
    target.addEventListener('keydown', onKeyDown, true);
    frameId = requestFrame(loop);
    stopCurrent = () => { target.removeEventListener('keydown', onKeyDown, true); cancelFrame(frameId); };
  }

  function stop() { stopCurrent?.(); stopCurrent = null; }

  return { start, stop };
}
