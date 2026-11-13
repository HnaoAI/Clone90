// Joystick tactile (T32) : directions (haut, bas, gauche, droite) d'après l'angle et la distance du doigt, comme les donne nipplejs.
// Fonction pure, sans EmulatorJS ; le branchement est dans launcher.js (patchVirtualStick).
// Remplace le calcul d'EmulatorJS 4.2.1 et 4.2.3, qui faisait parfois partir le jeu à gauche quand on allait à droite (Hicham, Android) :
//  - aucune zone morte : le doigt posé 1 px à gauche du centre donnait « gauche », puis « gauche + droite » en glissant à droite ;
//  - relâchements envoyés 30 ms en retard : une direction reprise dans ces 30 ms était relâchée alors que le doigt la tenait (ratés).
// INVARIANT : jamais deux directions opposées à la fois (demi-secteur maximal 75,5° < 90°).

/** Aucune direction appuyée. */
export const RELEASED = Object.freeze({ up: false, down: false, left: false, right: false });

/** Zone morte en px (nipplejs : rayon 50 px) : il faut dépasser `on` pour appuyer, redescendre sous `off` pour tout relâcher. */
export const DEAD_ZONE = Object.freeze({ on: 12, off: 8 });

/** Axe de chaque direction en degrés (nipplejs : 0° = droite, 90° = haut, sens anti-horaire). */
const AXES = { right: 0, up: 90, left: 180, down: 270 };
/** Demi-secteur d'une direction : 67,5° donne 4 directions et 4 diagonales de 45° chacune. */
const HALF = 67.5;
/** Hystérésis aux bords des secteurs quand le joystick est déjà tenu : une direction tenue s'élargit, une nouvelle se rétrécit. */
const MARGIN = 8;

/** Écart (0 à 180°) entre deux angles. */
const gap = (a, b) => { const d = Math.abs(((a - b) % 360 + 360) % 360); return d > 180 ? 360 - d : d; };

/**
 * @param {{angle: {degree: number}, distance: number}} data évènement « move » de nipplejs
 * @param {{up: boolean, down: boolean, left: boolean, right: boolean}} [prev] directions tenues jusqu'ici
 * @returns {{up: boolean, down: boolean, left: boolean, right: boolean}}
 */
export function stickDirections(data, prev = RELEASED) {
  const held = Object.values(prev).some(Boolean);
  const degree = data?.angle?.degree;
  const distance = data?.distance ?? 0;
  if (!Number.isFinite(degree) || distance < (held ? DEAD_ZONE.off : DEAD_ZONE.on)) return { ...RELEASED };
  const result = {};
  for (const [dir, axis] of Object.entries(AXES)) {
    const half = held ? HALF + (prev[dir] ? MARGIN : -MARGIN) : HALF;
    result[dir] = gap(degree, axis) < half;
  }
  return result;
}
