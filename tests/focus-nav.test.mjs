// Tests de js/input/focus-nav.js (T4) : navigation spatiale du focus dans une grille (positions simulées).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupRows, pickNext, createFocusNavigator } from '../js/input/focus-nav.js';

/** Rectangle left/top/width/height -> {left, top, right, bottom}. */
const rect = (left, top, w = 100, h = 100) => ({ left, top, right: left + w, bottom: top + h });
/** Grille cols x rows de tuiles 100x100 espacées de 20, origine (0, y0). */
const grid = (cols, rows, y0 = 0) => {
  const out = [];
  for (let r = 0; r < rows; r += 1) for (let c = 0; c < cols; c += 1) out.push(rect(c * 120, y0 + r * 120));
  return out;
};

test('groupRows : regroupe par rangée visuelle, triées de haut en bas puis de gauche à droite', () => {
  const rows = groupRows(grid(3, 2));
  assert.deepEqual(rows, [[0, 1, 2], [3, 4, 5]]);
});

test('groupRows : indépendant de l\'ordre du DOM', () => {
  const rects = [rect(120, 0), rect(0, 120), rect(0, 0), rect(120, 120)];
  assert.deepEqual(groupRows(rects), [[2, 0], [1, 3]]);
});

test('groupRows : tolère de petits décalages verticaux dans une rangée', () => {
  const rects = [rect(0, 0), rect(120, 6), rect(240, -4)];
  assert.deepEqual(groupRows(rects), [[0, 1, 2]]);
});

test('pickNext CA-N5 : droite et gauche vont au voisin de la rangée, sans bouclage', () => {
  const g = grid(3, 2);
  assert.equal(pickNext(g, 0, 'right'), 1);
  assert.equal(pickNext(g, 1, 'left'), 0);
  assert.equal(pickNext(g, 2, 'right'), null);
  assert.equal(pickNext(g, 0, 'left'), null);
  assert.equal(pickNext(g, 3, 'left'), null);
});

test('pickNext CA-N5 : haut et bas gardent la colonne, bords = on reste', () => {
  const g = grid(3, 3);
  assert.equal(pickNext(g, 1, 'down'), 4);
  assert.equal(pickNext(g, 4, 'down'), 7);
  assert.equal(pickNext(g, 7, 'up'), 4);
  assert.equal(pickNext(g, 7, 'down'), null);
  assert.equal(pickNext(g, 1, 'up'), null);
});

test('pickNext : si la rangée voisine est plus courte, va au dernier élément', () => {
  const g = [...grid(3, 1), rect(0, 120), rect(120, 120)]; // 3 puis 2
  assert.equal(pickNext(g, 2, 'down'), 4);
  assert.equal(pickNext(g, 4, 'up'), 1);
});

test('pickNext : colonne la plus proche si les rangées ne sont pas alignées', () => {
  const g = [rect(0, 0), rect(120, 0), rect(60, 120)];
  assert.equal(pickNext(g, 2, 'up'), 0);
  assert.equal(pickNext(g, 1, 'down'), 2);
});

test('pickNext CA-N5 : haut depuis la 1re rangée atteint le bouton d\'en-tête au-dessus', () => {
  const header = rect(0, -80, 160, 60);
  const g = [header, ...grid(3, 2)];
  assert.equal(pickNext(g, 3, 'up'), 0);
  assert.equal(pickNext(g, 0, 'down'), 1);
});

test('pickNext : élément seul, liste vide ou index invalide donnent null', () => {
  assert.equal(pickNext([rect(0, 0)], 0, 'down'), null);
  assert.equal(pickNext([], 0, 'up'), null);
  assert.equal(pickNext(grid(2, 1), 5, 'right'), null);
  assert.equal(pickNext(grid(2, 1), 0, 'confirm'), null);
});

test('pickNext : une seule colonne (liste verticale, boîte de dialogue)', () => {
  const col = [rect(0, 0), rect(0, 120), rect(0, 240)];
  assert.equal(pickNext(col, 0, 'down'), 1);
  assert.equal(pickNext(col, 2, 'up'), 1);
  assert.equal(pickNext(col, 1, 'right'), null);
});

test('pickNext : une seule rangée (boutons côte à côte)', () => {
  const row = grid(3, 1);
  assert.equal(pickNext(row, 1, 'right'), 2);
  assert.equal(pickNext(row, 1, 'down'), null);
});

/** Élément DOM factice. */
function fakeEl(id, r, opts = {}) {
  const log = [];
  return {
    id, log, disabled: !!opts.disabled, hidden: !!opts.hidden,
    getBoundingClientRect: () => ({ ...r, width: opts.zero ? 0 : r.right - r.left, height: opts.zero ? 0 : r.bottom - r.top }),
    focus(o) { log.push(['focus', o]); doc.activeElement = this; },
    scrollIntoView(o) { log.push(['scroll', o]); },
    click() { log.push(['click']); },
    hasAttribute(n) { return n === 'disabled' && this.disabled; },
  };
}
let doc;
const setup = (els, extra = {}) => {
  doc = { activeElement: null };
  const root = { querySelectorAll: (sel) => (sel === '[data-nav]' ? els : []) };
  return createFocusNavigator({ getRoot: () => root, doc, reducedMotion: () => false, ...extra });
};
const gridEls = (cols, rows) => grid(cols, rows).map((r, i) => fakeEl(`e${i}`, r));

test('createFocusNavigator : une direction déplace le vrai focus DOM et fait défiler en "nearest"', () => {
  const els = gridEls(3, 2);
  const nav = setup(els);
  doc.activeElement = els[0];
  assert.equal(nav.handleAction('right'), true);
  assert.equal(doc.activeElement, els[1]);
  assert.deepEqual(els[1].log.at(-1), ['scroll', { block: 'nearest', behavior: 'smooth' }]);
});

test('createFocusNavigator : reduced-motion supprime l\'animation de défilement', () => {
  const els = gridEls(2, 1);
  const nav = setup(els, { reducedMotion: () => true });
  doc.activeElement = els[0];
  nav.handleAction('right');
  assert.equal(els[1].log.at(-1)[1].behavior, 'auto');
});

test('createFocusNavigator CA-N1 : rien de focusé, la 1re direction focalise le 1er élément sans bouger plus', () => {
  const els = gridEls(3, 2);
  const nav = setup(els);
  assert.equal(nav.handleAction('down'), true);
  assert.equal(doc.activeElement, els[0]);
});

test('createFocusNavigator : bord de grille = le focus reste, action tout de même consommée', () => {
  const els = gridEls(2, 1);
  const nav = setup(els);
  doc.activeElement = els[1];
  assert.equal(nav.handleAction('right'), true);
  assert.equal(doc.activeElement, els[1]);
});

test('createFocusNavigator : confirm active (click) l\'élément focusé ; sans focus dans le root, ne fait rien', () => {
  const els = gridEls(2, 1);
  const nav = setup(els);
  doc.activeElement = els[1];
  assert.equal(nav.handleAction('confirm'), true);
  assert.deepEqual(els[1].log.at(-1), ['click']);
  doc.activeElement = { id: 'ailleurs' };
  assert.equal(nav.handleAction('confirm'), false);
});

test('createFocusNavigator : back n\'est pas géré (l\'écran décide)', () => {
  const nav = setup(gridEls(2, 1));
  assert.equal(nav.handleAction('back'), false);
});

test('createFocusNavigator : ignore les éléments désactivés, cachés ou de taille nulle', () => {
  const r = grid(4, 1);
  const els = [fakeEl('a', r[0]), fakeEl('b', r[1], { disabled: true }), fakeEl('c', r[2], { zero: true }), fakeEl('d', r[3])];
  const nav = setup(els);
  doc.activeElement = els[0];
  nav.handleAction('right');
  assert.equal(doc.activeElement, els[3]);
});

test('createFocusNavigator : piège de focus, seul le root courant (dialogue) est parcouru', () => {
  const page = gridEls(2, 1);
  const dialog = [fakeEl('oui', rect(0, 0)), fakeEl('non', rect(120, 0))];
  let current = page;
  doc = { activeElement: dialog[0] };
  const nav = createFocusNavigator({ getRoot: () => ({ querySelectorAll: () => current }), doc, reducedMotion: () => false });
  current = dialog;
  nav.handleAction('right');
  assert.equal(doc.activeElement, dialog[1]);
  nav.handleAction('right');
  assert.equal(doc.activeElement, dialog[1]);
});

test('createFocusNavigator : focusFirst et focusById (focus de retour)', () => {
  const els = gridEls(3, 1);
  els.forEach((e, i) => { e.dataset = { navId: `jeu${i}` }; });
  const nav = setup(els);
  assert.equal(nav.focusFirst(), true);
  assert.equal(doc.activeElement, els[0]);
  assert.equal(nav.focusById('jeu2'), true);
  assert.equal(doc.activeElement, els[2]);
  assert.equal(nav.focusById('inconnu'), false);
  assert.equal(doc.activeElement, els[2]);
});

test('createFocusNavigator : focusFirst sur une page vide renvoie false', () => {
  assert.equal(setup([]).focusFirst(), false);
  assert.equal(setup([]).handleAction('down'), true);
});
