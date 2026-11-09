// Tests de la grille de jeux et de la boîte de confirmation (T6) : logique pure et rendu avec document factice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gameInitials, buildGameTiles, initialFocusId, describeEmptyState, renderGameGrid } from '../js/ui/game-grid.js';
import { nextButtonIndex, resolveDialogAction, createConfirmDialog } from '../js/ui/dialog.js';

const machine = { id: 'neogeo', name: 'Neo Geo', extensions: ['zip'], accent: '--m-neogeo', logo: 'assets/logos/neogeo.svg' };
const game = (n, extra = {}) => ({ id: `neogeo/g${n}`, system: 'neogeo', title: `Jeu ${n}`, file: `roms/neogeo/g${n}.zip`, cover: null, ...extra });

test('gameInitials : 2 lettres max, articles de tête ignorés, majuscules', () => {
  assert.equal(gameInitials('Metal Slug'), 'MS');
  assert.equal(gameInitials('The Secret of Monkey Island'), 'SO');
  assert.equal(gameInitials('Le Roi Lion'), 'RL');
  assert.equal(gameInitials("L'Aventure"), 'AV');
  assert.equal(gameInitials('lemmings'), 'LE');
  assert.equal(gameInitials('X'), 'X');
});

test('gameInitials : cas limites (vide, symboles seuls, accents, article seul)', () => {
  assert.equal(gameInitials(''), '?');
  assert.equal(gameInitials('!!!'), '?');
  assert.equal(gameInitials('Éclair Noir'), 'ÉN');
  assert.equal(gameInitials('The'), 'TH');
  assert.equal(gameInitials('1942 Joint Strike'), '1J');
});

test('buildGameTiles : lien player.html encodé (section 6.2), jaquette encodée, titre complet', () => {
  const g = game(1, { id: "neogeo/le_roi_d'or", title: 'Le Roi d\'Or', cover: 'roms/neogeo/le roi.png' });
  const [t] = buildGameTiles([g], machine);
  assert.equal(t.href, "player.html?system=neogeo&game=neogeo%2Fle_roi_d'or");
  assert.equal(t.cover, 'roms/neogeo/le%20roi.png');
  assert.equal(t.title, "Le Roi d'Or");
  assert.equal(t.initials, 'RD');
  assert.equal(t.id, "neogeo/le_roi_d'or");
});

test('buildGameTiles : sans jaquette cover = null, l\'ordre reçu est conservé (tri fait par data.js)', () => {
  const tiles = buildGameTiles([game(2), game(1)], machine);
  assert.deepEqual(tiles.map((t) => t.id), ['neogeo/g2', 'neogeo/g1']);
  assert.equal(tiles[0].cover, null);
});

test('initialFocusId CA-J4 : focus de retour sur le jeu quitté s\'il existe, sinon 1er jeu, sinon null', () => {
  const games = [game(1), game(2), game(3)];
  assert.equal(initialFocusId(games, 'neogeo/g3'), 'neogeo/g3');
  assert.equal(initialFocusId(games, 'neogeo/inconnu'), 'neogeo/g1');
  assert.equal(initialFocusId(games, null), 'neogeo/g1');
  assert.equal(initialFocusId([], 'neogeo/g3'), null);
});

test('describeEmptyState CA-C1 : chemin exact roms/<machine>/ et formats acceptés avec point', () => {
  const s = describeEmptyState({ id: 'nes', name: 'NES', extensions: ['nes', 'zip'] });
  assert.equal(s.path, 'roms/nes/');
  assert.equal(s.formats, '.nes .zip');
  assert.equal(s.title, 'Aucun jeu pour cette machine.');
  assert.equal(describeEmptyState({ id: 'x', name: 'X', extensions: [] }).formats, null);
});

// --- Rendu avec document factice ---
class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; this.classes = new Set(); }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  addEventListener(t, f) { this.listeners[t] = f; }
  walk(fn) { fn(this); this.children.forEach((c) => c.walk?.(fn)); }
}
const doc = { createElement: (t) => new FakeNode(t), createTextNode: (s) => ({ text: s }) };
const find = (root, pred) => { const out = []; root.walk((n) => pred(n) && out.push(n)); return out; };

test('renderGameGrid : en-tête avec retour navigable, une tuile navigable par jeu avec nom accessible (CA-C3)', () => {
  const root = renderGameGrid({ machine, games: [game(1), game(2, { title: 'Un titre très long '.repeat(6) })] }, doc);
  const back = find(root, (n) => n.dataset.navId === 'back');
  assert.equal(back.length, 1);
  assert.equal(back[0].attrs.href, '#/');
  const tiles = find(root, (n) => n.tag === 'a' && /game-tile/.test(n.attrs.class ?? ''));
  assert.equal(tiles.length, 2);
  assert.equal(tiles[0].dataset.nav, '');
  assert.equal(tiles[0].dataset.navId, 'neogeo/g1');
  assert.equal(tiles[1].attrs['aria-label'], 'Un titre très long '.repeat(6));
  assert.equal(tiles[1].attrs.title, tiles[1].attrs['aria-label']);
  assert.ok(find(root, (n) => n.textContent === '2 jeux').length >= 1);
});

test('renderGameGrid CA-C2 : jaquette qui échoue = repli (initiales), jamais d\'image cassée', () => {
  const root = renderGameGrid({ machine, games: [game(1, { cover: 'roms/neogeo/g1.png' })] }, doc);
  const [img] = find(root, (n) => n.tag === 'img' && n.attrs.src === 'roms/neogeo/g1.png');
  assert.equal(img.attrs.alt, '');
  const [cover] = find(root, (n) => /game-cover/.test(n.attrs.class ?? ''));
  img.listeners.error();
  assert.equal(find(cover, (n) => n.attrs.src === 'roms/neogeo/g1.png').length, 0);
  assert.equal(find(cover, (n) => n.textContent === 'J1').length, 1);
});

test('renderGameGrid : sans jaquette, le repli est affiché d\'emblée avec la couleur de la machine', () => {
  const root = renderGameGrid({ machine, games: [game(1)] }, doc);
  const [cover] = find(root, (n) => /game-cover/.test(n.attrs.class ?? ''));
  assert.match(cover.attrs.style, /var\(--m-neogeo\)/);
  assert.equal(find(cover, (n) => /cover-initials/.test(n.attrs.class ?? '')).length, 1);
});

test('renderGameGrid CA-C1 : état vide = chemin exact, retour navigable, pas de tuile de jeu', () => {
  const root = renderGameGrid({ machine: { ...machine, id: 'nes', name: 'NES', extensions: ['nes', 'zip'] }, games: [] }, doc);
  assert.equal(find(root, (n) => /game-tile/.test(n.attrs.class ?? '')).length, 0);
  assert.equal(find(root, (n) => n.tag === 'code' && n.textContent === 'roms/nes/').length, 1);
  assert.ok(find(root, (n) => n.textContent === 'Revenir aux machines' && n.dataset.nav === '' && n.dataset.navId === 'back-empty').length === 1);
  assert.ok(find(root, (n) => n.textContent === '0 jeu').length >= 1);
});

// --- Boîte de confirmation ---
test('nextButtonIndex : gauche/droite changent de bouton sans boucler, haut/bas ne bougent pas', () => {
  assert.equal(nextButtonIndex(0, 'right', 2), 1);
  assert.equal(nextButtonIndex(1, 'right', 2), 1);
  assert.equal(nextButtonIndex(1, 'left', 2), 0);
  assert.equal(nextButtonIndex(0, 'left', 2), 0);
  assert.equal(nextButtonIndex(0, 'down', 2), 0);
});

test('resolveDialogAction CA-J3 : confirm valide le bouton focusé, back = annuler (Continuer), directions = déplacer', () => {
  assert.deepEqual(resolveDialogAction('confirm', 1, 2), { type: 'choose', index: 1 });
  assert.deepEqual(resolveDialogAction('back', 1, 2), { type: 'cancel' });
  assert.deepEqual(resolveDialogAction('right', 0, 2), { type: 'focus', index: 1 });
  assert.equal(resolveDialogAction('inconnue', 0, 2), null);
});

/** Document factice minimal pour la boîte de dialogue (focus suivi à la main). */
function dialogDoc() {
  const d = { ...doc, activeElement: null, listeners: {}, body: new FakeNode('body') };
  d.addEventListener = (t, f) => { d.listeners[t] = f; };
  d.removeEventListener = (t) => { delete d.listeners[t]; };
  d.createElement = (t) => { const n = new FakeNode(t); n.focus = () => { d.activeElement = n; }; n.remove = () => { n.removed = true; }; return n; };
  return d;
}

test('createConfirmDialog CA-J3 : role dialog modal, focus par défaut sur Continuer, résolution false sur retour', async () => {
  const d = dialogDoc();
  const dlg = createConfirmDialog({ title: 'Quitter Metal Slug ?', message: 'La partie en cours sera perdue.', cancelLabel: 'Continuer', confirmLabel: 'Quitter' }, d);
  assert.equal(dlg.element.attrs.role, 'dialog');
  assert.equal(dlg.element.attrs['aria-modal'], 'true');
  dlg.open(d.body);
  assert.equal(d.activeElement.textContent, 'Continuer');
  dlg.handleAction('back');
  assert.equal(await dlg.result, false);
  assert.equal(dlg.element.removed, true);
});

test('createConfirmDialog : droite puis confirm = Quitter (true) ; le focus revient au déclencheur si Continuer', async () => {
  const d = dialogDoc();
  const opener = d.createElement('button'); opener.focus();
  const a = createConfirmDialog({ title: 't', message: 'm', cancelLabel: 'Continuer', confirmLabel: 'Quitter' }, d);
  a.open(d.body);
  a.handleAction('right');
  assert.equal(d.activeElement.textContent, 'Quitter');
  a.handleAction('confirm');
  assert.equal(await a.result, true);

  const b = createConfirmDialog({ title: 't', message: 'm', cancelLabel: 'Continuer', confirmLabel: 'Quitter' }, d);
  opener.focus();
  b.open(d.body);
  b.handleAction('back');
  await b.result;
  assert.equal(d.activeElement, opener);
});

test('createConfirmDialog : handleAction renvoie true tant que la boîte est ouverte (elle capte tout), false après fermeture', () => {
  const d = dialogDoc();
  const dlg = createConfirmDialog({ title: 't', message: 'm', cancelLabel: 'A', confirmLabel: 'B' }, d);
  assert.equal(dlg.handleAction('left'), false, 'fermée : non gérée');
  dlg.open(d.body);
  assert.equal(dlg.handleAction('up'), true);
  dlg.handleAction('back');
  assert.equal(dlg.handleAction('up'), false);
});
