// Écran d'accueil (T5) : tuiles des machines (docs/ux.md 3.1). Dépend de data.js, router.js, version.js, ui/dom.js, ui/format.js.
// Logique pure (buildMachineTiles, describeGamesStatus) séparée du rendu (renderMachineGrid), testable sans navigateur.
// INVARIANT : aucune liste de machines ici, tout vient de systems.json. Les tuiles sont des liens `#/<machine>`
// (clic, tap, middle-click natifs) marqués `data-nav` : le clavier et la manette passent par js/input/.
import { buildHash } from '../router.js';
import { el } from './dom.js';
import { accentVar, createLogo, machineLogoSources } from './logo.js';
import { formatGameCount, splitCode } from './format.js';
import { formatVersionLabel } from '../version.js';

/** data-nav-id du bouton « Mes fichiers » de l'accueil (T27). */
export const LIBRARY_NAV_ID = 'library';

/**
 * Tuiles de l'accueil : machines avec jeux d'abord, machines à 0 jeu ensuite (grisées), ordre de systems.json conservé
 * dans chaque groupe (docs/ux.md 3.1).
 * @param {object[]} systems machines à afficher, triées par `order`
 * @param {Map<string, object[]>} gamesBySystem résultat de groupGamesBySystem
 * @returns {{id: string, name: string, count: number, countLabel: string, empty: boolean, href: string,
 *            logo: string|null, fallbackLogo: string|null, downloaded: boolean, accent: string}[]} logos : voir machineLogoSources (T29)
 */
export function buildMachineTiles(systems, gamesBySystem) {
  const tiles = systems.map((s) => {
    const count = gamesBySystem.get(s.id)?.length ?? 0;
    return {
      id: s.id, name: s.name, count, countLabel: formatGameCount(count), empty: count === 0,
      href: buildHash({ name: 'system', system: s.id }), ...machineLogoSources(s), accent: accentVar(s.accent),
    };
  });
  return [...tiles.filter((t) => !t.empty), ...tiles.filter((t) => t.empty)];
}

/** `data-nav-id` du bouton « Dossiers des jeux » (jamais un id de machine : ceux-ci viennent de systems.json). */
export const FOLDERS_NAV_ID = 'folders';
/** data-nav-id du bouton « Depuis une page web » de l'accueil (T34). */
export const LINKS_NAV_ID = 'links';

/** Nombre de segments de la jauge d'une tuile. */
export const GAUGE_SEGMENTS = 6;

/**
 * Segments allumés de la jauge décorative d'une machine (T24) : un segment pour 2 jeux, de 0 à GAUGE_SEGMENTS.
 * @param {number} count nombre de jeux (valeur invalide ou négative : 0)
 * @returns {boolean[]} GAUGE_SEGMENTS booléens, du bas vers le haut
 */
export function gaugeSegments(count) {
  const lit = Number.isFinite(count) && count > 0 ? Math.min(GAUGE_SEGMENTS, Math.ceil(count / 2)) : 0;
  return Array.from({ length: GAUGE_SEGMENTS }, (_, i) => i < lit);
}

/** Jauge décorative (aria-hidden) : le texte « N jeux » reste l'information. */
const renderGauge = (count, doc) => el('span', { class: 'gauge', attrs: { 'aria-hidden': 'true' } },
  gaugeSegments(count).map((on) => el('i', { class: on ? 'is-on' : '' }, [], doc)), doc);

/**
 * Message à afficher selon l'état de games.json (architecture 8.1 : message dédié, jamais bloquant).
 * @param {string} status 'ok' | 'empty' | 'absent' | 'offline' | 'invalid' (voir loadData)
 * @param {number} skipped entrées de games.json écartées car invalides
 * @returns {{title: string, text: string}|null} null = rien à dire
 */
export function describeGamesStatus(status, skipped = 0) {
  const regenerate = 'node scripts/generate-games.mjs';
  switch (status) {
    case 'absent':
      return {
        title: 'Aucun jeu disponible ici',
        text: `Les jeux ne sont jamais publiés avec le site (droits d'auteur), donc rien à jouer sur GitHub Pages sans vos fichiers. `
          + `Sur ce téléphone : touchez « Mes fichiers » et ajoutez vos jeux, ils restent dans ce navigateur. `
          + `Sur le Mac : déposez vos ROMs dans roms/<machine>/, puis ${regenerate} et node scripts/serve.mjs.`,
      };
    case 'empty':
      return { title: 'Aucun jeu trouvé', text: `Déposez vos ROMs dans roms/<machine>/ puis lancez ${regenerate}, et rechargez la page.` };
    case 'offline':
      return { title: 'Liste des jeux inaccessible', text: 'Impossible de joindre le serveur : vous êtes hors ligne, ou le serveur local est arrêté. Reconnectez-vous (ou relancez node scripts/serve.mjs), puis rechargez la page.' };
    case 'invalid':
      return { title: 'Liste des jeux illisible', text: `games.json est présent mais abîmé ou d'une version inconnue. Relancez ${regenerate}, puis rechargez la page.` };
    case 'ok':
      return skipped > 0
        ? { title: 'Certains jeux ont été ignorés', text: `${skipped} entrée(s) de games.json sont invalides. Relancez ${regenerate}.` }
        : null;
    default:
      return null;
  }
}

const withGauge = (logo, count, doc) => { logo.append(renderGauge(count, doc)); return logo; };

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
      withGauge(createLogo(t, doc), t.count, doc),
      el('span', { class: 'machine-name', text: t.name }, [], doc),
      el('span', { class: 'machine-count', text: t.countLabel }, [], doc),
    ], doc),
  ], doc));
  return el('ul', { class: 'machine-list' }, items, doc);
}

/**
 * Écran d'accueil complet : titre, message sur l'état de games.json (le cas échéant), cartes, bouton des dossiers (T25), rappel des touches.
 * T27 : bouton « Mes fichiers » (jeux et BIOS gardés sur cet appareil), seulement si le navigateur le permet (`localSupported`).
 * T34 : bouton « Depuis une page web » si `linksAvailable` (API du Mac ou bibliothèque locale).
 * @param {{tiles: ReturnType<typeof buildMachineTiles>, gamesStatus: string, skipped?: number, localSupported?: boolean, onOpenFolders?: () => void,
 *   linksAvailable?: boolean}} model
 *   `onOpenFolders` : fourni seulement si l'API locale répond ; sans lui, aucun bouton (GitHub Pages, réseau local)
 * @param {Document} [doc]
 */
export function renderHome({ tiles, gamesStatus, skipped = 0, localSupported = false, onOpenFolders, linksAvailable = false }, doc = globalThis.document) {
  const status = describeGamesStatus(gamesStatus, skipped);
  return el('section', { class: 'home' }, [
    el('div', { class: 'home-title-row' }, [
      el('h2', { class: 'screen-title', text: 'Choisis une machine' }, [], doc),
      localSupported && el('a', { class: 'back-button library-link', text: 'Mes fichiers', attrs: { href: buildHash({ name: 'library' }) }, dataset: { nav: '', navId: LIBRARY_NAV_ID } }, [], doc),
    ], doc),
    status && el('div', { class: 'banner', attrs: { role: 'status' } }, [
      el('strong', { text: status.title }, [], doc),
      el('p', {}, splitCode(status.text).map((s) => (s.code ? el('code', { text: s.text }, [], doc) : s.text)), doc),
    ], doc),
    renderMachineGrid(tiles, doc),
    (onOpenFolders || linksAvailable) && el('div', { class: 'home-tools' }, [
      onOpenFolders && el('button', {
        class: 'button is-secondary folders-button', text: 'Dossiers des jeux', attrs: { type: 'button' },
        dataset: { nav: '', navId: FOLDERS_NAV_ID }, on: { click: onOpenFolders },
      }, [], doc),
      linksAvailable && el('a', {
        class: 'button is-secondary links-button', text: 'Depuis une page web', attrs: { href: buildHash({ name: 'links' }) },
        dataset: { nav: '', navId: LINKS_NAV_ID },
      }, [], doc),
    ], doc),
    el('p', { class: 'key-hint', text: 'Flèches : choisir  -  Entrée / A : ouvrir' }, [], doc),
    el('p', { class: 'app-version', text: formatVersionLabel() }, [], doc),
  ], doc);
}
