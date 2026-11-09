// Écran d'accueil (T5) : tuiles des machines (docs/ux.md 3.1). Dépend de data.js, router.js, ui/dom.js, ui/format.js.
// Logique pure (buildMachineTiles, describeGamesStatus) séparée du rendu (renderMachineGrid), testable sans navigateur.
// INVARIANT : aucune liste de machines ici, tout vient de systems.json. Les tuiles sont des liens `#/<machine>`
// (clic, tap, middle-click natifs) marqués `data-nav` : le clavier et la manette passent par js/input/.
import { assetUrl } from '../data.js';
import { buildHash } from '../router.js';
import { el } from './dom.js';
import { formatGameCount } from './format.js';

const NEUTRAL_ACCENT = 'var(--surface-2)';

/**
 * Couleur d'accent d'une machine sous forme de valeur CSS. Seule une variable `--m-xxx` est acceptée
 * (le champ vient d'un fichier JSON : pas de CSS arbitraire).
 * @param {string|undefined} accent ex. "--m-amiga"
 */
export const accentVar = (accent) => (/^--m-[a-z0-9]+$/.test(accent ?? '') ? `var(${accent})` : NEUTRAL_ACCENT);

/**
 * Tuiles de l'accueil : machines avec jeux d'abord, machines à 0 jeu ensuite (grisées), ordre de systems.json conservé
 * dans chaque groupe (docs/ux.md 3.1).
 * @param {object[]} systems machines à afficher, triées par `order`
 * @param {Map<string, object[]>} gamesBySystem résultat de groupGamesBySystem
 * @returns {{id: string, name: string, count: number, countLabel: string, empty: boolean, href: string,
 *            logo: string|null, accent: string}[]}
 */
export function buildMachineTiles(systems, gamesBySystem) {
  const tiles = systems.map((s) => {
    const count = gamesBySystem.get(s.id)?.length ?? 0;
    return {
      id: s.id, name: s.name, count, countLabel: formatGameCount(count), empty: count === 0,
      href: buildHash({ name: 'system', system: s.id }), logo: assetUrl(s.logo ?? null), accent: accentVar(s.accent),
    };
  });
  return [...tiles.filter((t) => !t.empty), ...tiles.filter((t) => t.empty)];
}

/**
 * Message à afficher selon l'état de games.json (architecture 8.1 : message dédié, jamais bloquant).
 * @param {string} status 'ok' | 'empty' | 'absent' | 'invalid' (voir loadData)
 * @param {number} skipped entrées de games.json écartées car invalides
 * @returns {{title: string, text: string}|null} null = rien à dire
 */
export function describeGamesStatus(status, skipped = 0) {
  const regenerate = 'node scripts/generate-games.mjs';
  switch (status) {
    case 'absent':
      return {
        title: 'Aucun jeu disponible ici',
        text: `Les jeux ne sont jamais publiés avec le site (droits d'auteur), donc rien à jouer sur GitHub Pages. `
          + `Pour jouer, lancez Clone90 chez vous : déposez vos ROMs dans roms/<machine>/, puis ${regenerate} et node scripts/serve.mjs.`,
      };
    case 'empty':
      return { title: 'Aucun jeu trouvé', text: `Déposez vos ROMs dans roms/<machine>/ puis lancez ${regenerate}, et rechargez la page.` };
    case 'invalid':
      return { title: 'Liste des jeux illisible', text: `games.json est illisible. Relancez ${regenerate}, puis rechargez la page.` };
    case 'ok':
      return skipped > 0
        ? { title: 'Certains jeux ont été ignorés', text: `${skipped} entrée(s) de games.json sont invalides. Relancez ${regenerate}.` }
        : null;
    default:
      return null;
  }
}

/** Repli du logo : le nom de la machine en police pixel sur sa couleur d'accent (décoratif, le nom réel est dans la tuile). */
const logoFallback = (name, doc) => el('span', { class: 'logo-fallback', text: name, attrs: { 'aria-hidden': 'true' } }, [], doc);

/** Zone du logo : image, remplacée par le repli si elle manque ou ne charge pas (jamais d'image cassée, CA-C2). */
function createLogo(tile, doc) {
  const box = el('span', { class: 'machine-logo', attrs: { style: `--tile-accent: ${tile.accent}`, 'aria-hidden': 'true' } }, [], doc);
  if (!tile.logo) { box.append(logoFallback(tile.name, doc)); return box; }
  const img = el('img', { attrs: { src: tile.logo, alt: '', loading: 'lazy', decoding: 'async' } }, [], doc);
  img.addEventListener('error', () => box.replaceChildren(logoFallback(tile.name, doc)));
  box.append(img);
  return box;
}

/**
 * Construit la liste des cartes machines.
 * @param {ReturnType<typeof buildMachineTiles>} tiles
 * @param {Document} [doc]
 * @returns {HTMLElement} <ul> de liens `data-nav` (data-nav-id = id de la machine)
 */
export function renderMachineGrid(tiles, doc = globalThis.document) {
  const items = tiles.map((t) => el('li', { class: 'machine-item' }, [
    el('a', {
      class: `machine-tile${t.empty ? ' is-empty' : ''}`,
      attrs: { href: t.href },
      dataset: { nav: '', navId: t.id },
    }, [
      createLogo(t, doc),
      el('span', { class: 'machine-name', text: t.name }, [], doc),
      el('span', { class: 'machine-count', text: t.countLabel }, [], doc),
    ], doc),
  ], doc));
  return el('ul', { class: 'machine-list' }, items, doc);
}

/**
 * Écran d'accueil complet : titre, message sur l'état de games.json (le cas échéant), cartes, rappel des touches.
 * @param {{tiles: ReturnType<typeof buildMachineTiles>, gamesStatus: string, skipped?: number}} model
 * @param {Document} [doc]
 */
export function renderHome({ tiles, gamesStatus, skipped = 0 }, doc = globalThis.document) {
  const status = describeGamesStatus(gamesStatus, skipped);
  return el('section', { class: 'home' }, [
    el('h2', { class: 'screen-title', text: 'Choisis une machine' }, [], doc),
    status && el('div', { class: 'banner', attrs: { role: 'status' } }, [
      el('strong', { text: status.title }, [], doc),
      el('p', { text: status.text }, [], doc),
    ], doc),
    renderMachineGrid(tiles, doc),
    el('p', { class: 'key-hint', text: 'Flèches : choisir  -  Entrée / A : ouvrir' }, [], doc),
  ], doc);
}
