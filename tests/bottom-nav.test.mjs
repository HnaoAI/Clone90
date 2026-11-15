// Tests de la barre de navigation du bas (T41, js/ui/bottom-nav.js) : onglets selon ce que l'appareil permet, onglet actif,
// accueil sans les anciens boutons, barre absente de la page de jeu.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/project-root.mjs';
import {
  dockTabs, activeTabFor, renderBottomNav, markActiveTab,
  HOME_TAB_NAV_ID, LIBRARY_NAV_ID, LINKS_NAV_ID, FOLDERS_NAV_ID,
} from '../js/ui/bottom-nav.js';
import { renderHome } from '../js/ui/machine-grid.js';

class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...items) { for (const i of items) this.children.push(i); }
  replaceChildren(...items) { this.children = [...items]; }
  addEventListener(t, f) { this.listeners[t] = f; }
}
const doc = { createElement: (t) => new FakeNode(t), createTextNode: (s) => ({ text: s }) };
const walk = (node, out = []) => { out.push(node); for (const c of node.children ?? []) walk(c, out); return out; };
const textOf = (node) => walk(node).map((n) => n.textContent || n.text || '').join(' ').replace(/\s+/g, ' ').trim();
const tabsOf = (nav) => nav.children;
const ids = (tabs) => tabs.map((t) => t.id ?? t.dataset.navId);
const read = (f) => readFileSync(join(PROJECT_ROOT, f), 'utf8');

test('CA6 onglets : « Machines » toujours, les autres seulement si l\'appareil le permet', () => {
  assert.deepEqual(ids(dockTabs({})), [HOME_TAB_NAV_ID]);
  assert.deepEqual(ids(dockTabs({ localSupported: true, linksAvailable: true })), [HOME_TAB_NAV_ID, LIBRARY_NAV_ID, LINKS_NAV_ID]);
  assert.deepEqual(ids(dockTabs({ linksAvailable: true, foldersAvailable: true })), [HOME_TAB_NAV_ID, LINKS_NAV_ID, FOLDERS_NAV_ID]);
  assert.deepEqual(ids(dockTabs({ localSupported: true, linksAvailable: true, foldersAvailable: true })),
    [HOME_TAB_NAV_ID, LIBRARY_NAV_ID, LINKS_NAV_ID, FOLDERS_NAV_ID]);
});

test('CA6 onglets : libellés, adresses et data-nav-id des anciens boutons de l\'accueil', () => {
  const tabs = dockTabs({ localSupported: true, linksAvailable: true, foldersAvailable: true });
  assert.deepEqual(tabs.map((t) => t.label), ['Machines', 'Mes fichiers', 'Page web', 'Dossiers']);
  assert.deepEqual(tabs.map((t) => t.href ?? null), ['#/', '#/fichiers', '#/telecharger', null]);
  assert.equal(LIBRARY_NAV_ID, 'library');
  assert.equal(LINKS_NAV_ID, 'links');
  assert.equal(FOLDERS_NAV_ID, 'folders');
  assert.equal(new Set(tabs.map((t) => t.tone)).size, 4, 'une couleur de gel par onglet');
});

test('CA6 barre : liens et bouton navigables (data-nav), nom accessible en texte, icône décorative', () => {
  const nav = renderBottomNav({ localSupported: true, linksAvailable: true, onOpenFolders: () => {} }, doc);
  assert.equal(nav.tag, 'nav');
  assert.equal(nav.attrs['aria-label'], 'Navigation principale');
  const tabs = tabsOf(nav);
  assert.deepEqual(tabs.map((t) => t.tag), ['a', 'a', 'a', 'button']);
  for (const t of tabs) {
    assert.equal(t.dataset.nav, '');
    assert.match(t.attrs.class, /\bdock-tab\b/);
    const icon = t.children.find((c) => /dock-icon/.test(c.attrs?.class ?? ''));
    assert.equal(icon.attrs['aria-hidden'], 'true');
  }
  assert.equal(tabs[3].attrs.type, 'button');
  assert.deepEqual(tabs.map((t) => textOf(t)), ['Machines', 'Mes fichiers', 'Page web', 'Dossiers']);
  assert.equal(tabs[1].attrs.href, '#/fichiers');
});

test('CA6 « Dossiers » n\'existe que si onOpenFolders est fourni (API du Mac), et le toucher l\'appelle', () => {
  assert.equal(tabsOf(renderBottomNav({ linksAvailable: true }, doc)).some((t) => t.dataset.navId === FOLDERS_NAV_ID), false);
  let opened = 0;
  const nav = renderBottomNav({ linksAvailable: true, onOpenFolders: () => { opened += 1; } }, doc);
  tabsOf(nav).find((t) => t.dataset.navId === FOLDERS_NAV_ID).listeners.click();
  assert.equal(opened, 1);
});

test('CA7 onglet actif : aria-current="page" sur un seul onglet, déplacé au changement de page', () => {
  const nav = renderBottomNav({ localSupported: true, linksAvailable: true, active: HOME_TAB_NAV_ID }, doc);
  const current = () => tabsOf(nav).filter((t) => t.attrs['aria-current'] === 'page').map((t) => t.dataset.navId);
  assert.deepEqual(current(), [HOME_TAB_NAV_ID]);
  markActiveTab(nav, LIBRARY_NAV_ID);
  assert.deepEqual(current(), [LIBRARY_NAV_ID]);
  markActiveTab(nav, null);
  assert.deepEqual(current(), []);
  markActiveTab(nav, 'inconnu');
  assert.deepEqual(current(), []);
});

test('CA7 onglet actif : accueil et grille d\'une machine = « Machines », « Mes fichiers », « Page web », sinon aucun', () => {
  assert.equal(activeTabFor('home'), HOME_TAB_NAV_ID);
  assert.equal(activeTabFor('system'), HOME_TAB_NAV_ID);
  assert.equal(activeTabFor('library'), LIBRARY_NAV_ID);
  assert.equal(activeTabFor('links'), LINKS_NAV_ID);
  assert.equal(activeTabFor('notfound'), null);
  assert.equal(activeTabFor(undefined), null);
});

test('CA8 accueil : plus de boutons « Mes fichiers », « Dossiers des jeux » ni « Depuis une page web »', () => {
  const tiles = [{ id: 'amiga', name: 'Amiga', count: 2, countLabel: '2 jeux', empty: false, href: '#/amiga', logo: null, fallbackLogo: null, downloaded: false, accent: 'var(--m-amiga)' }];
  const home = renderHome({ tiles, gamesStatus: 'ok', localSupported: true, linksAvailable: true, onOpenFolders: () => {} }, doc);
  const navIds = walk(home).filter((n) => n.dataset && 'nav' in n.dataset).map((n) => n.dataset.navId);
  assert.deepEqual(navIds, ['amiga']);
  assert.equal(walk(home).some((n) => n.tag === 'button'), false);
  for (const label of ['Mes fichiers', 'Dossiers des jeux', 'Depuis une page web']) {
    assert.equal(walk(home).some((n) => n.textContent === label), false, label);
  }
});

test('CA9 et CA10 pages : la barre a sa place dans index.html (racine de navigation), aucune dans player.html', () => {
  const index = read('index.html');
  assert.match(index, /<div id="app">[\s\S]*<main id="screen"[\s\S]*<div id="dock-slot"><\/div>[\s\S]*<\/div>/);
  assert.doesNotMatch(read('player.html'), /dock/);
  assert.match(read('js/app.js'), /getRoot: \(\) => appRoot/, 'la barre est dans la racine de la navigation au clavier et à la manette');
});

test('CA9 cibles et place : onglets d\'au moins 48 px, contenu jamais caché sous la barre', () => {
  const base = read('css/dock.css');
  assert.match(read('index.html'), /href="css\/dock\.css"/);
  assert.match(base, /\.dock-tab \{[^}]*min-height: 64px/);
  assert.match(base, /\.dock-tab \{[^}]*min-width: 48px/);
  assert.match(base, /\.dock \{[^}]*position: fixed/);
  assert.match(base, /\.has-dock \.screen \{[^}]*padding-bottom: calc\(var\(--dock-space\)/);
  assert.match(base, /\.has-dock \.toast \{[^}]*bottom: calc\(var\(--dock-space\)/, 'le message temporaire passe au-dessus de la barre');
});
