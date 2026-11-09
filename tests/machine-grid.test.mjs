// Tests de l'accueil (T5) : tuiles machines, états, messages, choix d'écran, rendu avec document factice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMachineTiles, describeGamesStatus, renderMachineGrid } from '../js/ui/machine-grid.js';
import { accentVar } from '../js/ui/logo.js';
import { formatGameCount } from '../js/ui/format.js';
import { visibleSystems, resolveRoute } from '../js/screens.js';
import { groupGamesBySystem } from '../js/data.js';

const sys = (id, order, extra = {}) => ({ id, name: id.toUpperCase(), order, extensions: ['zip'], accent: `--m-${id}`, logo: `assets/logos/${id}.svg`, wave: 1, ...extra });
const game = (system, n) => ({ id: `${system}/g${n}`, system, title: `G${n}`, file: `roms/${system}/g${n}.zip`, cover: null });
const tilesFor = (systems, games) => buildMachineTiles(systems, groupGamesBySystem(systems, games));

test('formatGameCount : 0 jeu, 1 jeu, 12 jeux (singulier jusqu\'à 1)', () => {
  assert.equal(formatGameCount(0), '0 jeu');
  assert.equal(formatGameCount(1), '1 jeu');
  assert.equal(formatGameCount(2), '2 jeux');
  assert.equal(formatGameCount(12), '12 jeux');
});

test('buildMachineTiles : une tuile par machine avec nom, nombre de jeux et lien vers la grille', () => {
  const tiles = tilesFor([sys('amiga', 10), sys('neogeo', 20)], [game('amiga', 1), game('amiga', 2), game('neogeo', 1)]);
  assert.deepEqual(tiles.map((t) => [t.id, t.name, t.count, t.countLabel, t.href]), [
    ['amiga', 'AMIGA', 2, '2 jeux', '#/amiga'],
    ['neogeo', 'NEOGEO', 1, '1 jeu', '#/neogeo'],
  ]);
});

test('buildMachineTiles : machines à 0 jeu marquées vides et placées en fin de liste, ordre conservé', () => {
  const systems = [sys('a', 1), sys('b', 2), sys('c', 3), sys('d', 4)];
  const tiles = tilesFor(systems, [game('b', 1), game('d', 1)]);
  assert.deepEqual(tiles.map((t) => t.id), ['b', 'd', 'a', 'c']);
  assert.deepEqual(tiles.map((t) => t.empty), [false, false, true, true]);
  assert.equal(tiles[2].countLabel, '0 jeu');
});

test('buildMachineTiles CA-C4 : 12 machines simulées, toutes présentes', () => {
  const systems = Array.from({ length: 12 }, (_, i) => sys(`m${i}`, i));
  assert.equal(tilesFor(systems, []).length, 12);
});

test('buildMachineTiles : tout vide (games.json absent) garde toutes les machines, dans l\'ordre', () => {
  const tiles = tilesFor([sys('y', 1), sys('x', 2)], []);
  assert.deepEqual(tiles.map((t) => t.id), ['y', 'x']);
  assert.ok(tiles.every((t) => t.empty));
});

test('buildMachineTiles : logo encodé, null si absent ; accent en variable CSS', () => {
  const [t] = tilesFor([sys('amiga', 1, { logo: 'assets/logos/a b.svg' })], []);
  assert.equal(t.logo, 'assets/logos/a%20b.svg');
  const [n] = tilesFor([sys('amiga', 1, { logo: undefined })], []);
  assert.equal(n.logo, null);
  assert.equal(t.accent, 'var(--m-amiga)');
});

test('accentVar : seule une variable --m-xxx est acceptée, sinon repli neutre (pas d\'injection CSS)', () => {
  assert.equal(accentVar('--m-neogeo'), 'var(--m-neogeo)');
  assert.equal(accentVar('red; background:url(x)'), 'var(--surface-2)');
  assert.equal(accentVar(undefined), 'var(--surface-2)');
});

test('describeGamesStatus : ok sans rien à dire, absent explique GitHub Pages et la solution locale', () => {
  assert.equal(describeGamesStatus('ok', 0), null);
  const absent = describeGamesStatus('absent', 0);
  assert.match(absent.text, /GitHub Pages|publi/i);
  assert.match(absent.text, /generate-games/);
  assert.match(absent.text, /serve/);
});

test('describeGamesStatus : empty cite roms/<machine>/, invalid cite generate-games, ok avec entrées ignorées avertit', () => {
  assert.match(describeGamesStatus('empty', 0).text, /roms\/<machine>\//);
  assert.match(describeGamesStatus('invalid', 0).text, /generate-games/);
  assert.match(describeGamesStatus('ok', 3).text, /3/);
  assert.equal(describeGamesStatus('inconnu', 0), null);
});

test('visibleSystems : wave livrée affichée (sans wave = affichée), wave non livrée masquée sauf si elle a des jeux', () => {
  const systems = [sys('a', 1), sys('b', 2, { wave: 2 }), sys('c', 3, { wave: undefined }), sys('d', 4, { wave: 2 })];
  assert.deepEqual(visibleSystems(systems, [], 1).map((s) => s.id), ['a', 'c']);
  assert.deepEqual(visibleSystems(systems, [game('d', 1)], 1).map((s) => s.id), ['a', 'c', 'd']);
  assert.equal(visibleSystems(systems, [], 2).length, 4);
});

test('resolveRoute : accueil, machine connue (avec focus), machine inconnue ou route inconnue = accueil', () => {
  const systems = [sys('amiga', 1)];
  assert.deepEqual(resolveRoute({ name: 'home' }, systems), { name: 'home' });
  assert.deepEqual(resolveRoute({ name: 'system', system: 'amiga', focus: 'amiga/x' }, systems), { name: 'system', system: 'amiga', focus: 'amiga/x', machine: systems[0] });
  assert.deepEqual(resolveRoute({ name: 'system', system: 'nes', focus: null }, systems), { name: 'home' });
  assert.deepEqual(resolveRoute({ name: 'notfound' }, systems), { name: 'home' });
});

// --- Rendu avec document factice ---
class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  addEventListener(t, f) { this.listeners[t] = f; }
  walk(fn) { fn(this); this.children.forEach((c) => c.walk?.(fn)); }
}
const doc = { createElement: (t) => new FakeNode(t), createTextNode: (s) => ({ text: s }) };
const find = (root, pred) => { const out = []; root.walk((n) => pred(n) && out.push(n)); return out; };

test('renderMachineGrid : une tuile navigable par machine, nom accessible, état vide marqué', () => {
  const tiles = tilesFor([sys('amiga', 1), sys('nes', 2)], [game('amiga', 1)]);
  const root = renderMachineGrid(tiles, doc);
  const links = find(root, (n) => n.tag === 'a');
  assert.equal(links.length, 2);
  assert.equal(links[0].attrs.href, '#/amiga');
  assert.equal(links[0].dataset.nav, '');
  assert.equal(links[0].dataset.navId, 'amiga');
  assert.match(links[1].attrs.class, /is-empty/);
  assert.doesNotMatch(links[0].attrs.class, /is-empty/);
  const texts = find(links[0], (n) => n.textContent).map((n) => n.textContent);
  assert.ok(texts.includes('AMIGA') && texts.includes('1 jeu'));
});

test('renderMachineGrid CA-C2 : logo qui ne charge pas = repli (nom sur la couleur machine), jamais d\'image cassée', () => {
  const [tile] = tilesFor([sys('amiga', 1)], []);
  const root = renderMachineGrid([tile], doc);
  const [img] = find(root, (n) => n.tag === 'img');
  assert.equal(img.attrs.alt, '');
  assert.equal(img.attrs.src, 'assets/logos/amiga.svg');
  const [logoBox] = find(root, (n) => /machine-logo/.test(n.attrs.class ?? ''));
  img.listeners.error();
  assert.equal(find(logoBox, (n) => n.tag === 'img').length, 0);
  assert.ok(find(logoBox, (n) => n.textContent === 'AMIGA').length === 1);
});

test('renderMachineGrid : sans logo déclaré, le repli est affiché d\'emblée', () => {
  const [tile] = tilesFor([sys('amiga', 1, { logo: undefined })], []);
  const root = renderMachineGrid([tile], doc);
  assert.equal(find(root, (n) => n.tag === 'img').length, 0);
  assert.ok(find(root, (n) => /logo-fallback/.test(n.attrs.class ?? '')).length === 1);
});

import { splitCode } from '../js/ui/format.js';
test('splitCode : isole chemins et commandes pour la police mono, le reste reste du texte', () => {
  const parts = splitCode('Déposez dans roms/<machine>/ puis node scripts/generate-games.mjs ok');
  assert.deepEqual(parts.filter((p) => p.code).map((p) => p.text), ['roms/<machine>/', 'node scripts/generate-games.mjs']);
  assert.equal(parts.map((p) => p.text).join(''), 'Déposez dans roms/<machine>/ puis node scripts/generate-games.mjs ok');
  assert.deepEqual(splitCode('rien'), [{ text: 'rien', code: false }]);
});
