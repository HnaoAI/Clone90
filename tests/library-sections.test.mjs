// Tests T55 : rubriques de « Mes fichiers » qui s'ouvrent une par une (js/ui/library-sections.js, rendu de js/ui/library-screen.js).
// Faux DOM minimal ; la vérification dans un vrai navigateur (toucher, clavier, focus) est tests/recette/mes-fichiers-repliable.mjs.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  LIBRARY_SECTIONS, sectionForNavId, initialOpenSection, sectionToggleNavId, describeSyncSummary, describeBiosSummary, resetLibrarySections,
} from '../js/ui/library-sections.js';
import { renderLibrary, addGamesNavId, ADD_BIOS_NAV_ID, SCAN_FOLDER_NAV_ID, FIND_COVERS_NAV_ID, PREPARE_OFFLINE_NAV_ID, LIBRARY_BACK_NAV_ID } from '../js/ui/library-screen.js';
import { SYNC_NAV } from '../js/ui/sync-section.js';

class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...items) { this.children.push(...items); }
  addEventListener(t, f) { this.listeners[t] = f; }
  walk(fn) { fn(this); this.children.forEach((c) => c.walk?.(fn)); }
}
const doc = { createElement: (t) => new FakeNode(t), createTextNode: (s) => ({ text: s }) };
const find = (root, pred) => { const out = []; root.walk((n) => pred(n) && out.push(n)); return out; };
const neogeo = { id: 'neogeo', name: 'Neo Geo', extensions: ['zip'], bios: [{ file: 'neogeo.zip', required: true, role: 'default' }] };
const nes = { id: 'nes', name: 'NES', extensions: ['nes'] };
const noop = () => {};
const base = { systems: [neogeo, nes], entries: [], supported: true, folderPicking: true, offlineSupported: true, onAddGames: noop, onAddBios: noop, onRemove: noop };
const sync = { pairing: null, onPair: noop, onSyncNow: noop, onForget: noop };
const toggles = (root) => find(root, (n) => /\blibrary-toggle\b/.test(n.attrs.class ?? ''));
const toggle = (root, id) => toggles(root).find((n) => n.dataset.navId === sectionToggleNavId(id));
const panel = (root, id) => find(root, (n) => n.attrs.id === `library-panel-${id}`)[0];
const isOpen = (root, id) => toggle(root, id).attrs['aria-expanded'] === 'true' && panel(root, id).hidden === false;
const openIds = (root) => LIBRARY_SECTIONS.filter((id) => toggle(root, id) && isOpen(root, id));
const inPanel = (root, id, navId) => find(panel(root, id), (n) => n.dataset?.navId === navId).length === 1;

beforeEach(() => resetLibrarySections());

test('T55 CA1 rubriques : deux tuiles (Ajouter des jeux, Importer un dossier) puis Synchroniser, BIOS, Pochettes, Jouer sans réseau ; la liste des fichiers reste visible', () => {
  const root = renderLibrary({ ...base, sync, entries: [{ path: 'roms/nes/a.nes', size: 10 }] }, doc);
  assert.deepEqual(toggles(root).map((t) => t.dataset.navId), ['games', 'folder', 'sync', 'bios', 'covers', 'offline'].map(sectionToggleNavId));
  assert.deepEqual(toggles(root).slice(0, 2).map((t) => /\bis-tile\b/.test(t.attrs.class)), [true, true]);
  assert.match(toggle(root, 'games').attrs.class, /\bis-primary\b/, 'tuile verte');
  assert.ok(find(root, (n) => n.textContent === 'a.nes').length === 1);
  const files = find(root, (n) => /\blibrary-files-block\b/.test(n.attrs?.class ?? ''))[0];
  assert.ok(files && !files.hidden, 'liste des fichiers jamais repliée');
});

test('T55 CA1 sur le Mac (pas de rubrique de synchronisation) : pas de ligne « Synchroniser avec le Mac »', () => {
  const root = renderLibrary({ ...base }, doc);
  assert.equal(toggle(root, 'sync'), undefined);
});

test('T55 CA2 boutons accessibles : aria-expanded, aria-controls vers le panneau, data-nav ; contenu dans le panneau', () => {
  const root = renderLibrary({ ...base, sync }, doc);
  for (const t of toggles(root)) {
    assert.equal(t.tag, 'button');
    assert.equal(t.attrs.type, 'button');
    assert.equal(t.dataset.nav, '');
    assert.equal(t.attrs['aria-expanded'], 'false');
    assert.ok(find(root, (n) => n.attrs.id === t.attrs['aria-controls']).length === 1, t.attrs['aria-controls']);
  }
  assert.ok(inPanel(root, 'games', addGamesNavId('nes')));
  assert.ok(inPanel(root, 'games', 'links'), '« Depuis une page web » avec l\'ajout de jeux');
  assert.ok(inPanel(root, 'folder', SCAN_FOLDER_NAV_ID));
  assert.ok(inPanel(root, 'sync', SYNC_NAV.pair));
  assert.ok(inPanel(root, 'bios', ADD_BIOS_NAV_ID));
  assert.ok(inPanel(root, 'covers', FIND_COVERS_NAV_ID));
  assert.ok(inPanel(root, 'offline', PREPARE_OFFLINE_NAV_ID));
});

test('T55 CA2 une seule rubrique ouverte : ouvrir en ferme une autre, toucher la rubrique ouverte la referme', () => {
  const root = renderLibrary({ ...base, sync }, doc);
  assert.deepEqual(openIds(root), []);
  toggle(root, 'bios').listeners.click();
  assert.deepEqual(openIds(root), ['bios']);
  toggle(root, 'covers').listeners.click();
  assert.deepEqual(openIds(root), ['covers']);
  toggle(root, 'covers').listeners.click();
  assert.deepEqual(openIds(root), []);
});

test('T55 CA4 la dernière rubrique ouverte reste ouverte au rendu suivant (après une action), et la fermer est retenu aussi', () => {
  const first = renderLibrary({ ...base, sync }, doc);
  toggle(first, 'offline').listeners.click();
  assert.deepEqual(openIds(renderLibrary({ ...base, sync }, doc)), ['offline']);
  const again = renderLibrary({ ...base, sync }, doc);
  toggle(again, 'offline').listeners.click();
  assert.deepEqual(openIds(renderLibrary({ ...base, sync }, doc)), []);
});

test('T55 CA4 sectionForNavId : chaque bouton qui reprend le focus après une action appartient à sa rubrique', () => {
  assert.equal(sectionForNavId(addGamesNavId('nes')), 'games');
  assert.equal(sectionForNavId('links'), 'games');
  assert.equal(sectionForNavId(SCAN_FOLDER_NAV_ID), 'folder');
  for (const id of Object.values(SYNC_NAV)) assert.equal(sectionForNavId(id), 'sync', id);
  assert.equal(sectionForNavId(ADD_BIOS_NAV_ID), 'bios');
  assert.equal(sectionForNavId(FIND_COVERS_NAV_ID), 'covers');
  assert.equal(sectionForNavId(PREPARE_OFFLINE_NAV_ID), 'offline');
  assert.equal(sectionForNavId(sectionToggleNavId('bios')), 'bios');
  for (const other of [LIBRARY_BACK_NAV_ID, 'del-roms/nes/a.nes', null, undefined, '']) assert.equal(sectionForNavId(other), null, String(other));
});

test('T55 CA4 initialOpenSection : focus d\'abord, puis machine venue de sa grille vide, puis dernière ouverte, sinon rien', () => {
  assert.equal(initialOpenSection({}), null);
  assert.equal(initialOpenSection({ lastOpen: 'bios' }), 'bios');
  assert.equal(initialOpenSection({ machine: 'nes', lastOpen: 'bios' }), 'games');
  assert.equal(initialOpenSection({ focus: SYNC_NAV.now, machine: 'nes', lastOpen: 'bios' }), 'sync');
  assert.equal(initialOpenSection({ focus: LIBRARY_BACK_NAV_ID, lastOpen: 'covers' }), 'covers', 'focus hors rubrique : on garde la dernière');
  assert.equal(initialOpenSection({ lastOpen: 'inconnue' }), null);
});

test('T55 CA4 rendu : `focus` ouvre la rubrique de ce bouton ; arrivée depuis une grille vide ouvre « Ajouter des jeux »', () => {
  assert.deepEqual(openIds(renderLibrary({ ...base, sync, focus: FIND_COVERS_NAV_ID }, doc)), ['covers']);
  resetLibrarySections();
  assert.deepEqual(openIds(renderLibrary({ ...base, sync, machine: 'nes' }, doc)), ['games']);
});

test('T55 CA5 le message du dernier import ou des pochettes est en haut de l\'écran, hors des rubriques', () => {
  const root = renderLibrary({ ...base, sync, notice: '3 jeux ajoutés' }, doc);
  const notice = find(root, (n) => n.textContent === '3 jeux ajoutés')[0];
  assert.ok(notice);
  for (const id of ['games', 'folder', 'sync', 'bios', 'covers', 'offline']) assert.equal(find(panel(root, id), (n) => n === notice).length, 0, id);
  const flat = find(root, () => true);
  assert.ok(flat.indexOf(notice) < flat.indexOf(toggles(root)[0]), 'avant les rubriques');
});

test('T55 CA3 résumés : Mac associé ou non, BIOS présents sur le nombre déclaré', () => {
  assert.equal(describeSyncSummary(null), 'Pas encore associé');
  assert.equal(describeSyncSummary({ url: 'https://192.168.1.20:8443', token: null }), 'Mot de passe à saisir de nouveau');
  assert.equal(describeSyncSummary({ url: 'https://192.168.1.20:8443', name: 'mon-mac.local', token: 't' }), 'Associé à mon-mac');
  assert.equal(describeSyncSummary({ url: 'https://192.168.1.20:8443', token: 't' }), 'Associé à https://192.168.1.20:8443');
  assert.equal(describeBiosSummary([]), 'Aucun BIOS demandé');
  assert.equal(describeBiosSummary([{ present: true }, { present: false }]), '1 BIOS sur 2');
  assert.equal(describeBiosSummary([{ present: true }]), '1 BIOS sur 1');
  const root = renderLibrary({ ...base, sync, entries: [{ path: 'bios/neogeo.zip', size: 1 }] }, doc);
  assert.ok(find(toggle(root, 'bios'), (n) => n.textContent === '1 BIOS sur 1').length === 1);
  assert.ok(find(toggle(root, 'sync'), (n) => n.textContent === 'Pas encore associé').length === 1);
});

test('T55 rubrique de synchronisation : pas de second titre « Synchroniser avec le Mac » dans le panneau', () => {
  const root = renderLibrary({ ...base, sync }, doc);
  assert.equal(find(panel(root, 'sync'), (n) => n.textContent === 'Synchroniser avec le Mac').length, 0);
});

test('T55 CA7 style : tuile verte pleine, tuile à fine bordure, lignes sombres, flèche verte tournée vers le bas quand c\'est ouvert', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../css/library.css', import.meta.url), 'utf8');
  assert.match(css, /\.library-toggle\.is-primary \{[^}]*background: var\(--accent\)/);
  assert.match(css, /\.library-toggle\.is-tile \{[^}]*border: 1px solid var\(--edge\)/);
  assert.match(css, /\.library-toggle \{[^}]*background: var\(--panel-2\)/);
  assert.match(css, /\.library-toggle\[aria-expanded="true"\] \.library-toggle-arrow \{[^}]*transform: rotate\(90deg\)/);
  assert.match(css, /\.library-panel\[hidden\] \{[^}]*display: none/);
});
