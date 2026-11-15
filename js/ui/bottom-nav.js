// Barre de navigation du bas (T41, style Y2K) : « Machines », « Mes fichiers », « Page web », « Dossiers ». Dépend de router.js et ui/dom.js.
// Logique pure (dockTabs, activeTabFor) séparée du rendu (renderBottomNav, markActiveTab), testable sans navigateur.
// INVARIANT : mêmes conditions et mêmes data-nav-id que les anciens boutons de l'accueil (T25, T27, T34) : les recettes et le retour
// du focus après le panneau des dossiers (app.js) s'en servent. Absente de player.html : pas de barre pendant le jeu.
import { buildHash } from '../router.js';
import { el } from './dom.js';

/** data-nav-id de l'onglet « Machines » (jamais un id de machine : ceux-ci viennent de systems.json). */
export const HOME_TAB_NAV_ID = 'dock-home';
/** data-nav-id de l'onglet « Mes fichiers » (T27). */
export const LIBRARY_NAV_ID = 'library';
/** data-nav-id de l'onglet « Page web » (écran « Depuis une page web », T34). */
export const LINKS_NAV_ID = 'links';
/** data-nav-id de l'onglet « Dossiers » (panneau « Dossiers des jeux », T25). */
export const FOLDERS_NAV_ID = 'folders';

/**
 * Onglets à afficher, dans l'ordre de la barre.
 * @param {{localSupported?: boolean, linksAvailable?: boolean, foldersAvailable?: boolean}} options
 *   localSupported : « Mes fichiers » possible dans ce navigateur ; linksAvailable : API du Mac ou « Mes fichiers » ;
 *   foldersAvailable : API du Mac (jamais sur GitHub Pages ni en réseau local)
 * @returns {{id: string, label: string, tone: string, href?: string, extraClass: string}[]} pas de `href` : bouton
 */
export function dockTabs({ localSupported = false, linksAvailable = false, foldersAvailable = false } = {}) {
  return [
    { id: HOME_TAB_NAV_ID, label: 'Machines', tone: 'pink', href: buildHash({ name: 'home' }), extraClass: 'home-tab' },
    localSupported && { id: LIBRARY_NAV_ID, label: 'Mes fichiers', tone: 'blue', href: buildHash({ name: 'library' }), extraClass: 'library-link' },
    linksAvailable && { id: LINKS_NAV_ID, label: 'Page web', tone: 'lime', href: buildHash({ name: 'links' }), extraClass: 'links-button' },
    foldersAvailable && { id: FOLDERS_NAV_ID, label: 'Dossiers', tone: 'violet', extraClass: 'folders-button' },
  ].filter(Boolean);
}

/**
 * Onglet de la page affichée.
 * @param {string|undefined} routeName nom de route résolu (resolveRoute) : 'home', 'system', 'library', 'links'
 * @returns {string|null} data-nav-id de l'onglet, null si aucun
 */
export function activeTabFor(routeName) {
  switch (routeName) {
    case 'home':
    case 'system': return HOME_TAB_NAV_ID; // la grille d'une machine est une étape de « Machines »
    case 'library': return LIBRARY_NAV_ID;
    case 'links': return LINKS_NAV_ID;
    default: return null;
  }
}

/**
 * Marque l'onglet actif (aria-current="page", lu par les lecteurs d'écran et par le CSS) et retire la marque des autres.
 * @param {HTMLElement} nav élément rendu par renderBottomNav
 * @param {string|null} activeId data-nav-id de l'onglet actif ; inconnu ou null : aucun
 */
export function markActiveTab(nav, activeId) {
  for (const tab of Array.from(nav.children)) {
    if (tab.dataset.navId === activeId) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

/**
 * Barre du bas. Liens pour les pages (clic, toucher, middle-click natifs), bouton pour « Dossiers » qui ouvre un panneau.
 * @param {{localSupported?: boolean, linksAvailable?: boolean, onOpenFolders?: () => void, active?: string|null}} model
 *   `onOpenFolders` : fourni seulement si l'API du Mac répond ; sans lui, pas d'onglet « Dossiers »
 * @param {Document} [doc]
 * @returns {HTMLElement} <nav class="dock">
 */
export function renderBottomNav({ localSupported = false, linksAvailable = false, onOpenFolders, active = null }, doc = globalThis.document) {
  const tabs = dockTabs({ localSupported, linksAvailable, foldersAvailable: Boolean(onOpenFolders) }).map((t) => {
    const props = { class: `dock-tab is-${t.tone} ${t.extraClass}`, dataset: { nav: '', navId: t.id } };
    const current = t.id === active ? { 'aria-current': 'page' } : {};
    const content = [
      el('span', { class: `dock-icon icon-${t.tone}`, attrs: { 'aria-hidden': 'true' } }, [], doc),
      el('span', { class: 'dock-label', text: t.label }, [], doc),
    ];
    return t.href
      ? el('a', { ...props, attrs: { href: t.href, ...current } }, content, doc)
      : el('button', { ...props, attrs: { type: 'button', ...current }, on: { click: onOpenFolders } }, content, doc);
  });
  // data-nav-pinned : barre fixe, toujours la dernière rangée de la navigation au clavier et à la manette (input/focus-nav.js).
  return el('nav', { class: 'dock', attrs: { 'aria-label': 'Navigation principale' }, dataset: { navPinned: '' } }, tabs, doc);
}
