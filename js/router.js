// Routes hash `#/`, `#/<machine>?focus=<idJeu>` (T3) et `#/fichiers?machine=<id>` (écran « Mes fichiers », T27). Aucune logique d'écran, aucune liste de machines :
// savoir si la machine existe est l'affaire de l'appelant (app.js). Le jeu est une page (player.html), pas une route.
import { PLAYER_PAGE, HOME_PAGE } from './config.js';
import { encodeGameId } from './data.js';

const SYSTEM_SEGMENT = /^[a-z0-9]+$/;

/** Segment de l'écran « Mes fichiers » (T27). INVARIANT : aucune machine de systems.json ne porte cet id (tests/router.test.mjs). */
export const LIBRARY_SEGMENT = 'fichiers';

/**
 * Lit un hash. Formes : '', '#', '#/' (accueil) ; '#/fichiers[?machine=<id>]' (T27) ; '#/<machine>[?focus=<id>]' ; sinon notfound.
 * @param {string} [hash] valeur de location.hash
 * @returns {{name: 'home'} | {name: 'library', machine: string|null} | {name: 'system', system: string, focus: string|null} | {name: 'notfound'}}
 */
export function parseHash(hash = '') {
  const [path, query = ''] = hash.replace(/^#/, '').split('?', 2);
  const segments = path.split('/').filter(Boolean);
  if (segments.length === 0 && (path === '' || path === '/')) return { name: 'home' };
  if (segments.length !== 1 || !path.startsWith('/') || !SYSTEM_SEGMENT.test(segments[0])) return { name: 'notfound' };
  if (segments[0] === LIBRARY_SEGMENT) {
    const machine = readParam(query, 'machine');
    return { name: 'library', machine: machine && SYSTEM_SEGMENT.test(machine) ? machine : null };
  }
  return { name: 'system', system: segments[0], focus: readParam(query, 'focus') };
}

/** Lit un paramètre à la main : URLSearchParams décoderait déjà une fois (et lirait + comme espace), d'où un double décodage. */
function readParam(query, name) {
  const pair = query.split('&').find((p) => p.startsWith(`${name}=`));
  if (!pair) return null;
  try { return decodeURIComponent(pair.slice(name.length + 1)) || null; } catch { return null; }
}

/**
 * Construit le hash d'une route (inverse de parseHash).
 * @param {{name: string, system?: string, focus?: string|null}} route
 */
export function buildHash(route) {
  if (route.name === 'library') return `#/${LIBRARY_SEGMENT}${route.machine ? `?machine=${route.machine}` : ''}`;
  if (route.name !== 'system') return '#/';
  const focus = route.focus ? `?focus=${encodeGameId(route.focus)}` : '';
  return `#/${route.system}${focus}`;
}

/** URL de la page de jeu : player.html?system=<machine>&game=<id encodé>. */
export const buildPlayerUrl = (system, gameId) => `${PLAYER_PAGE}?system=${system}&game=${encodeGameId(gameId)}`;

/** URL de retour après un jeu (architecture 8.3, encodage 6.2) : index.html#/<machine>?focus=<id>. */
export const buildReturnUrl = (system, gameId) => `${HOME_PAGE}${buildHash({ name: 'system', system, focus: gameId })}`;

/**
 * Lit les paramètres de player.html (inverse de buildPlayerUrl).
 * @param {string} [search] valeur de location.search
 * @returns {{system: string|null, game: string|null}} null si absent ou vide
 */
export function parsePlayerParams(search = '') {
  const params = new URLSearchParams(search);
  return { system: params.get('system') || null, game: params.get('game') || null };
}

/**
 * Routeur lié à une fenêtre (injectable : un faux objet suffit pour les tests).
 * @param {{location: {hash: string}, addEventListener: Function, removeEventListener: Function}} [win]
 */
export function createRouter(win = globalThis.window) {
  let listener = null;
  const stop = () => { if (listener) win.removeEventListener('hashchange', listener); listener = null; };
  return {
    /** Appelle onRoute tout de suite avec la route courante, puis à chaque changement de hash. */
    start(onRoute) {
      stop();
      listener = () => onRoute(parseHash(win.location.hash));
      win.addEventListener('hashchange', listener);
      listener();
    },
    stop,
    /** Change de route en écrivant le hash (déclenche hashchange). */
    navigate(route) { win.location.hash = buildHash(route); },
  };
}
