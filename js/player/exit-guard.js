// Détection de la sortie du jeu (T7) : Select+Start 1 s (manette), F10, Échap maintenu 1 s (clavier). Aucune dépendance.
// INVARIANT : pendant le jeu, ce module est en LECTURE SEULE. Il écoute en capture mais ne fait jamais stopPropagation
// et ne fait preventDefault que sur F10 : aucune autre touche ne lui appartient (docs/ux.md CA-J1, architecture 8.3).
// Raison d'être à part de input/actions.js : createActionSource consomme flèches, Entrée et Échap (preventDefault), ce
// qui casserait le jeu. Les menus (Jouer, confirmation) utilisent actions.js ; le jeu en cours utilise ce garde.
// Les numéros de boutons (8 Select, 9 Start) sont ceux du mapping standard, comme input/actions.js.
// Validé en T0 (Chromium, EmulatorJS stable) : F10 et Échap ne sont pas dans les touches par défaut d'EmulatorJS, F10 ouvre la
// confirmation, Échap maintenu 1 s ouvre la confirmation, Échap bref = Continuer. Reste TODO(T0) : un vrai Chrome en plein écran
// consomme peut-être le keydown Échap (non vérifiable par automatisation) ; à tester à la main, F10 et le bouton Menu restent.

/** Durée de maintien avant sortie (docs/ux.md 4.4). */
export const EXIT_HOLD_MS = 1000;
export const PAD_SELECT = 8;
export const PAD_START = 9;

/**
 * Suivi d'un maintien : progression de 0 à 1, `completed` vrai une seule fois par maintien (après relâchement, on peut recommencer).
 * @param {number} [durationMs]
 */
export function createHoldTracker(durationMs = EXIT_HOLD_MS) {
  let since = null;
  let done = false;
  return {
    /** @param {boolean} held @param {number} now ms @returns {{progress: number, completed: boolean}} */
    update(held, now) {
      if (!held) { since = null; done = false; return { progress: 0, completed: false }; }
      since ??= now;
      const progress = Math.min(1, (now - since) / durationMs);
      const completed = progress >= 1 && !done;
      if (completed) done = true;
      return { progress, completed };
    },
  };
}

/** Vrai si une même manette tient Select ET Start. @param {ArrayLike<Gamepad|null>|null} pads */
export function isPadComboHeld(pads) {
  return Array.from(pads ?? []).some((pad) => pad && pad.connected !== false
    && pad.buttons?.[PAD_SELECT]?.pressed === true && pad.buttons?.[PAD_START]?.pressed === true);
}

/**
 * Vrai si Select ou Start est tenu sur une manette. Sert à la confirmation de sortie : Start vaut "valider" dans les menus
 * (actions.js), mais pour répéter Select+Start (= Quitter) il ne doit pas fermer la boîte en tant que "Continuer".
 * @param {ArrayLike<Gamepad|null>|null} pads
 */
export function isPadSelectOrStartHeld(pads) {
  return Array.from(pads ?? []).some((pad) => pad && pad.connected !== false
    && (pad.buttons?.[PAD_SELECT]?.pressed === true || pad.buttons?.[PAD_START]?.pressed === true));
}

const hasModifier = (e) => e.ctrlKey || e.altKey || e.metaKey;

/**
 * Garde de sortie.
 * @param {object} options tout est injectable pour les tests
 * @param {(kind: 'gamepad'|'f10'|'escape') => void} options.onRequest sortie demandée (une fois par geste)
 * @param {(progress: number) => void} [options.onProgress] 0 à 1, pour l'anneau autour du bouton Menu (appelé à chaque frame)
 * @param {() => void} [options.onEscapeTap] Échap relâché avant 1 s (le jeu l'a reçu ; sert à "Continuer" dans la confirmation)
 * @param {EventTarget} [options.target] défaut : window
 * @param {() => ArrayLike<Gamepad|null>} [options.getGamepads]
 * @param {() => number} [options.now]
 * @param {(f: Function) => any} [options.requestFrame]
 * @param {(id: any) => void} [options.cancelFrame]
 */
export function createExitGuard(options) {
  const {
    onRequest,
    onProgress = () => {},
    onEscapeTap = () => {},
    target = globalThis.window,
    getGamepads = () => globalThis.navigator?.getGamepads?.() ?? [],
    now = () => globalThis.performance.now(),
    requestFrame = (f) => globalThis.requestAnimationFrame(f),
    cancelFrame = (id) => globalThis.cancelAnimationFrame(id),
  } = options;

  const readPads = () => { try { return getGamepads(); } catch { return []; } };
  let stopCurrent = null;

  function start() {
    stop();
    const padHold = createHoldTracker();
    const escapeHold = createHoldTracker();
    let escapeHeld = false;
    let escapeRequested = false;
    let frameId = null;

    const onKeyDown = (e) => {
      if (hasModifier(e)) return;
      if (e.key === 'F10') {
        e.preventDefault();
        if (!e.repeat) onRequest('f10');
      } else if (e.key === 'Escape' && !e.repeat) {
        escapeHeld = true;
        escapeRequested = false;
      }
    };
    const onKeyUp = (e) => {
      if (e.key !== 'Escape' || !escapeHeld) return;
      escapeHeld = false;
      if (!escapeRequested) onEscapeTap();
    };
    const onBlur = () => { escapeHeld = false; };

    const loop = () => {
      const pad = padHold.update(isPadComboHeld(readPads()), now());
      const esc = escapeHold.update(escapeHeld, now());
      if (pad.completed) onRequest('gamepad');
      if (esc.completed) { escapeRequested = true; onRequest('escape'); }
      onProgress(Math.max(pad.progress, esc.progress));
      frameId = requestFrame(loop);
    };

    target.addEventListener('keydown', onKeyDown, true);
    target.addEventListener('keyup', onKeyUp, true);
    target.addEventListener('blur', onBlur, true);
    frameId = requestFrame(loop);
    stopCurrent = () => {
      target.removeEventListener('keydown', onKeyDown, true);
      target.removeEventListener('keyup', onKeyUp, true);
      target.removeEventListener('blur', onBlur, true);
      cancelFrame(frameId);
    };
  }

  function stop() { stopCurrent?.(); stopCurrent = null; }

  return { start, stop, isSelectOrStartHeld: () => isPadSelectOrStartHeld(readPads()) };
}
