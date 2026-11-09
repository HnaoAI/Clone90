// Écran grille de jeux d'une machine (T6) : tuiles 3:4, jaquette ou repli, état vide (docs/ux.md 3.2 et 3.3).
// Dépend de data.js, router.js, ui/dom.js, ui/format.js, ui/logo.js.
// Logique pure (gameInitials, buildGameTiles, initialFocusId, describeEmptyState) séparée du rendu (renderGameGrid).
// INVARIANT : les tuiles sont des liens vers player.html (T7, hors périmètre ici) marqués `data-nav` ;
// les boutons retour ont `data-nav-id` "back" et "back-empty" (jamais un id de jeu : ceux-ci contiennent "/").
import { assetUrl } from '../data.js';
import { buildHash, buildPlayerUrl } from '../router.js';
import { ROMS_DIR } from '../config.js';
import { el } from './dom.js';
import { formatGameCount } from './format.js';
import { accentVar, createLogo } from './logo.js';

/** Identifiants data-nav-id du bouton retour de l'en-tête et du bouton de l'état vide (focus d'arrivée, CA-C1). */
export const BACK_NAV_ID = 'back';
export const EMPTY_NAV_ID = 'back-empty';

const LEADING_ARTICLES = new Set(['the', 'a', 'an', 'le', 'la', 'les', 'l', 'un', 'une']);

/**
 * Initiales d'un titre pour le visuel de repli : 2 lettres au plus, articles de tête ignorés ("The", "Le", "La"...),
 * en majuscules. Un seul mot : ses deux premières lettres. Rien d'exploitable : "?".
 * @param {string} title
 */
export function gameInitials(title) {
  let words = title.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length > 1 && LEADING_ARTICLES.has(words[0].toLowerCase())) words = words.slice(1);
  if (words.length === 0) return '?';
  const letters = words.length === 1 ? [...words[0]].slice(0, 2) : [words[0], words[1]].map((w) => [...w][0]);
  return letters.join('').toLocaleUpperCase('fr');
}

/**
 * Tuiles de la grille, dans l'ordre reçu (déjà trié par groupGamesBySystem).
 * @param {object[]} games jeux de la machine
 * @param {object} machine machine (systems.json)
 * @returns {{id: string, title: string, href: string, cover: string|null, initials: string, accent: string}[]}
 */
export function buildGameTiles(games, machine) {
  return games.map((g) => ({
    id: g.id, title: g.title, href: buildPlayerUrl(machine.id, g.id),
    cover: assetUrl(g.cover ?? null), initials: gameInitials(g.title), accent: accentVar(machine.accent),
  }));
}

/**
 * Élément qui reçoit le focus à l'arrivée sur la grille : le jeu quitté (`?focus=`) s'il existe, sinon le 1er jeu,
 * sinon null (état vide : le focus va au bouton de retour).
 * @param {object[]} games jeux de la machine
 * @param {string|null} focus id lu dans l'URL
 * @returns {string|null}
 */
export function initialFocusId(games, focus) {
  if (focus && games.some((g) => g.id === focus)) return focus;
  return games[0]?.id ?? null;
}

/**
 * Contenu de l'état vide (CA-C1) : chemin exact à copier et formats acceptés (null si la machine n'en déclare pas).
 * @param {{id: string, extensions?: string[]}} machine
 */
export function describeEmptyState(machine) {
  const extensions = machine.extensions ?? [];
  return {
    title: 'Aucun jeu pour cette machine.',
    path: `${ROMS_DIR}/${machine.id}/`,
    formats: extensions.length ? extensions.map((e) => `.${e}`).join(' ') : null,
  };
}

/** Repli de la jaquette : initiales sur la couleur machine, petit logo machine en bas (docs/ux.md 3.2). */
function coverFallback(tile, machine, doc) {
  return [
    el('span', { class: 'cover-initials', text: tile.initials, attrs: { 'aria-hidden': 'true' } }, [], doc),
    el('span', { class: 'cover-logo' }, [createLogo({ logo: assetUrl(machine.logo ?? null), name: machine.name, accent: tile.accent }, doc)], doc),
  ];
}

/** Zone jaquette 3:4 : image, remplacée par le repli si absente ou si elle ne charge pas (CA-C2). */
function createCover(tile, machine, doc) {
  const box = el('span', { class: 'game-cover', attrs: { style: `--tile-accent: ${tile.accent}`, 'aria-hidden': 'true' } }, [], doc);
  if (!tile.cover) { box.append(...coverFallback(tile, machine, doc)); return box; }
  const img = el('img', { attrs: { src: tile.cover, alt: '', loading: 'lazy', decoding: 'async' } }, [], doc);
  img.addEventListener('error', () => box.replaceChildren(...coverFallback(tile, machine, doc)));
  box.append(img);
  return box;
}

function renderHeader(machine, count, doc) {
  return el('header', { class: 'grid-header' }, [
    el('a', { class: 'back-button', attrs: { href: buildHash({ name: 'home' }), 'aria-label': 'Retour aux machines' }, dataset: { nav: '', navId: BACK_NAV_ID } }, [
      el('span', { text: '<', attrs: { 'aria-hidden': 'true' } }, [], doc),
      el('span', { class: 'back-label', text: 'Machines' }, [], doc),
    ], doc),
    el('h2', { class: 'grid-title' }, [machine.name], doc),
    el('span', { class: 'grid-count', text: formatGameCount(count) }, [], doc),
  ], doc);
}

function renderEmptyState(machine, doc) {
  const empty = describeEmptyState(machine);
  return el('section', { class: 'empty-state' }, [
    el('span', { class: 'empty-logo' }, [createLogo({ logo: assetUrl(machine.logo ?? null), name: machine.name, accent: 'var(--disabled)' }, doc)], doc),
    el('p', { class: 'empty-title', text: empty.title }, [], doc),
    el('p', {}, ['Déposez vos ROMs dans le dossier : ', el('code', { text: empty.path }, [], doc)], doc),
    el('p', {}, ['puis lancez ', el('code', { text: 'node scripts/generate-games.mjs' }, [], doc), ' et rechargez la page.'], doc),
    empty.formats && el('p', { class: 'muted' }, ['Formats acceptés : ', el('code', { text: empty.formats }, [], doc)], doc),
    el('a', { class: 'button', text: 'Revenir aux machines', attrs: { href: buildHash({ name: 'home' }) }, dataset: { nav: '', navId: EMPTY_NAV_ID } }, [], doc),
  ], doc);
}

/**
 * Écran grille d'une machine.
 * @param {{machine: object, games: object[]}} model jeux de CETTE machine, déjà triés
 * @param {Document} [doc]
 * @returns {HTMLElement}
 */
export function renderGameGrid({ machine, games }, doc = globalThis.document) {
  const tiles = buildGameTiles(games, machine);
  const body = tiles.length === 0
    ? renderEmptyState(machine, doc)
    : el('ul', { class: 'game-list' }, tiles.map((t) => el('li', { class: 'game-item' }, [
      el('a', {
        class: 'game-tile', attrs: { href: t.href, 'aria-label': t.title, title: t.title }, dataset: { nav: '', navId: t.id },
      }, [
        createCover(t, machine, doc),
        el('span', { class: 'game-title', text: t.title }, [], doc),
      ], doc),
    ], doc)), doc);
  return el('section', { class: 'game-screen' }, [renderHeader(machine, tiles.length, doc), body], doc);
}
