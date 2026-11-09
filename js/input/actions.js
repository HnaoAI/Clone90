// Couche d'entrée unique (T4) : clavier + manette (Gamepad API) vers 6 actions abstraites. Aucune dépendance.
// INVARIANT : c'est le SEUL endroit qui lit clavier et manette (CLAUDE.md règle 3). Les écrans réagissent aux actions.
// Souris et tactile ne passent pas ici : ils gardent les `click` natifs (architecture 8.2).
// Tout (fenêtre, manettes, horloge, frames) est injectable pour tester sans navigateur.

/** Les 6 actions abstraites. */
export const ACTIONS = Object.freeze({
  UP: 'up', DOWN: 'down', LEFT: 'left', RIGHT: 'right', CONFIRM: 'confirm', BACK: 'back',
});
const { UP, DOWN, LEFT, RIGHT, CONFIRM, BACK } = ACTIONS;
const DIRECTIONS = [UP, DOWN, LEFT, RIGHT];

const KEY_ACTIONS = {
  ArrowUp: UP, ArrowDown: DOWN, ArrowLeft: LEFT, ArrowRight: RIGHT,
  Enter: CONFIRM, ' ': CONFIRM, Escape: BACK, Backspace: BACK,
};

/** Boutons du mapping standard : croix 12 à 15, A (0) et Start (9) valident, B (1) = retour (docs/ux.md 4.2). */
const PAD_BUTTONS = { 12: UP, 13: DOWN, 14: LEFT, 15: RIGHT, 0: CONFIRM, 9: CONFIRM, 1: BACK };
const STICK_THRESHOLD = 0.5;

/** Délais de répétition (docs/ux.md 4.2) : 400 ms avant la 1re répétition, puis toutes les 120 ms. */
export const DEFAULT_REPEAT = Object.freeze({ delay: 400, interval: 120 });

/** @param {string} key valeur de KeyboardEvent.key @returns {string|null} action ou null si touche non gérée */
export const keyToAction = (key) => KEY_ACTIONS[key] ?? null;

/**
 * Vrai si la cible d'un événement clavier est un champ de saisie (input, textarea, select, contenteditable) :
 * la frappe lui appartient, la couche d'entrée ne doit ni la consommer ni la traduire en action.
 * @param {{tagName?: string, isContentEditable?: boolean}|null|undefined} target
 */
export function isEditable(target) {
  if (!target) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(String(target.tagName).toUpperCase()) || target.isContentEditable === true;
}

/**
 * Actions tenues par une manette à cet instant (croix, stick gauche au-delà du seuil, boutons).
 * Stick en diagonale : seul l'axe dominant compte.
 * @param {Gamepad|null|undefined} pad
 * @returns {Set<string>}
 */
export function readGamepad(pad) {
  const held = new Set();
  if (!pad || pad.connected === false) return held;
  (pad.buttons ?? []).forEach((b, i) => { if (b?.pressed && PAD_BUTTONS[i]) held.add(PAD_BUTTONS[i]); });
  const x = Number.isFinite(pad.axes?.[0]) ? pad.axes[0] : 0;
  const y = Number.isFinite(pad.axes?.[1]) ? pad.axes[1] : 0;
  if (Math.max(Math.abs(x), Math.abs(y)) > STICK_THRESHOLD) {
    if (Math.abs(y) > Math.abs(x)) held.add(y < 0 ? UP : DOWN);
    else held.add(x < 0 ? LEFT : RIGHT);
  }
  return held;
}

/**
 * Lecteur de manettes avec "réveil" (docs/ux.md 4.2) : le premier appui d'une manette fraîchement vue
 * n'émet aucune action (il signale seulement `woke`) et reste ignoré jusqu'à ce que tout soit relâché.
 * Une manette qui disparaît de la liste redevient "fraîche".
 */
export function createGamepadReader() {
  const states = new Map(); // index -> 'asleep' | 'suppressed' | 'awake'
  return {
    /** @param {ArrayLike<Gamepad|null>} pads résultat de navigator.getGamepads() @returns {{held: Set<string>, woke: boolean}} */
    read(pads) {
      const held = new Set();
      let woke = false;
      const seen = new Set();
      Array.from(pads ?? []).forEach((pad, position) => {
        if (!pad || pad.connected === false) return;
        const key = pad.index ?? position;
        seen.add(key);
        const actions = readGamepad(pad);
        const state = states.get(key) ?? 'asleep';
        if (state === 'asleep') {
          if (actions.size) { woke = true; states.set(key, 'suppressed'); } else states.set(key, 'asleep');
        } else if (state === 'suppressed') {
          if (!actions.size) states.set(key, 'awake');
        } else {
          actions.forEach((a) => held.add(a));
        }
      });
      for (const key of [...states.keys()]) if (!seen.has(key)) states.delete(key);
      return { held, woke };
    },
  };
}

/**
 * Transforme des actions "tenues" en actions "à déclencher" : front montant immédiat, puis répétition
 * (directions seulement) après `delay` puis toutes les `interval`. confirm et back ne se répètent jamais.
 * Après une longue pause (onglet figé), un seul déclenchement : pas de rafale. Directions opposées simultanées : annulées.
 * @param {{delay?: number, interval?: number}} [options] en millisecondes
 */
export function createRepeater({ delay, interval } = {}) {
  const d = delay ?? DEFAULT_REPEAT.delay;
  const i = interval ?? DEFAULT_REPEAT.interval;
  const nextAt = new Map(); // action -> instant de la prochaine répétition
  return {
    /** @param {Set<string>} held @param {number} now ms @returns {string[]} actions à déclencher maintenant */
    update(held, now) {
      const active = new Set(held);
      if (active.has(LEFT) && active.has(RIGHT)) { active.delete(LEFT); active.delete(RIGHT); }
      if (active.has(UP) && active.has(DOWN)) { active.delete(UP); active.delete(DOWN); }
      for (const a of [...nextAt.keys()]) if (!active.has(a)) nextAt.delete(a);
      const fired = [];
      for (const a of active) {
        const repeats = DIRECTIONS.includes(a);
        if (!nextAt.has(a)) { fired.push(a); nextAt.set(a, repeats ? now + d : Infinity); }
        else if (now >= nextAt.get(a)) { fired.push(a); nextAt.set(a, now + i); }
      }
      return fired;
    },
  };
}

/**
 * Source d'actions : écoute le clavier, lit les manettes à chaque frame, applique une seule répétition.
 * Les touches gérées sont consommées, sauf dans un champ de saisie (isEditable), (preventDefault) pour éviter le défilement et le double clic natif
 * sur Entrée/Espace ; les combinaisons avec Ctrl, Alt ou Méta restent au navigateur.
 * @param {object} [options] tout est injectable pour les tests
 * @param {EventTarget} [options.target] défaut : window
 * @param {() => ArrayLike<Gamepad|null>} [options.getGamepads]
 * @param {() => number} [options.now] défaut : performance.now
 * @param {(f: Function) => any} [options.requestFrame] défaut : requestAnimationFrame
 * @param {(id: any) => void} [options.cancelFrame]
 * @param {() => void} [options.onWake] appelé au 1er appui d'une manette fraîche (toast "Manette connectée")
 * @param {() => boolean} [options.isActive] faux = source passive (T7, pendant une partie) : aucune touche consommée ni traduite,
 *   aucune action émise ; les manettes restent lues pour que leurs appuis déjà vus ne se déclenchent pas à la réactivation
 * @param {{delay?: number, interval?: number}} [options.repeat]
 */
export function createActionSource(options = {}) {
  const {
    target = globalThis.window,
    getGamepads = () => globalThis.navigator?.getGamepads?.() ?? [],
    now = () => globalThis.performance.now(),
    requestFrame = (f) => globalThis.requestAnimationFrame(f),
    cancelFrame = (id) => globalThis.cancelAnimationFrame(id),
    onWake = () => {},
    isActive = () => true,
    repeat,
  } = options;

  let stopCurrent = () => {};

  const stop = () => { stopCurrent(); stopCurrent = () => {}; };

  /** @param {(action: string, source: 'keyboard'|'gamepad') => void} handler */
  function start(handler) {
    stop();
    const keyboardHeld = new Set();
    const pressedSinceFrame = new Set(); // appuis plus courts qu'une frame : sinon keyup les efface avant la lecture
    const reader = createGamepadReader();
    const repeater = createRepeater(repeat);
    let frameId = null;

    const consumable = (e) => isActive() && !isEditable(e.target) && !e.ctrlKey && !e.altKey && !e.metaKey && keyToAction(e.key);
    const onKeyDown = (e) => {
      const action = consumable(e);
      if (!action) return;
      e.preventDefault();
      if (e.repeat && !keyboardHeld.has(action)) return; // touche déjà tenue avant la réactivation : pas un nouvel appui
      keyboardHeld.add(action);
      pressedSinceFrame.add(action);
    };
    const onKeyUp = (e) => {
      const action = keyToAction(e.key);
      if (!action) return;
      keyboardHeld.delete(action);
      if (!isActive() || isEditable(e.target)) return;
      if (!e.ctrlKey && !e.altKey && !e.metaKey) e.preventDefault();
    };
    const onBlur = () => { keyboardHeld.clear(); pressedSinceFrame.clear(); };

    const readPads = () => {
      try { return reader.read(getGamepads()); } catch { return { held: new Set(), woke: false }; }
    };
    const loop = () => {
      const { held: padHeld, woke } = readPads();
      if (woke) onWake();
      const keyboardNow = new Set([...keyboardHeld, ...pressedSinceFrame]);
      pressedSinceFrame.clear();
      const fired = repeater.update(new Set([...keyboardNow, ...padHeld]), now());
      for (const action of isActive() ? fired : []) {
        handler(action, padHeld.has(action) ? 'gamepad' : 'keyboard');
      }
      frameId = requestFrame(loop);
    };

    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('blur', onBlur);
    frameId = requestFrame(loop);
    stopCurrent = () => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('blur', onBlur);
      cancelFrame(frameId);
    };
  }

  return { start, stop };
}
