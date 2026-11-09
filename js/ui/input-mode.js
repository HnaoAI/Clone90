// Mode d'entrée visible (T5, extrait en T7) : partagé par index.html (app.js) et player.html (player-main.js). Aucune dépendance.

/** Mode manette : l'anneau de focus s'affiche même sans :focus-visible (docs/ux.md 4.3). La souris ou le tactile le coupent. */
export const setGamepadMode = (on, doc = globalThis.document) => doc.body.classList.toggle('input-gamepad', on);

/** Coupe le mode manette au premier geste souris ou tactile. */
export function watchPointer(win = globalThis.window) {
  win.addEventListener('pointerdown', () => setGamepadMode(false, win.document));
}
