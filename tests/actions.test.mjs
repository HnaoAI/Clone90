// Tests de js/input/actions.js (T4) : clavier + manette vers 6 actions abstraites, répétition, front montant, réveil.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTIONS, keyToAction, isEditable, readGamepad, createGamepadReader, createRepeater, createActionSource,
} from '../js/input/actions.js';

/** Manette factice au mapping standard : buttons = indices pressés, axes = [x, y]. */
const pad = ({ pressed = [], axes = [0, 0], index = 0, connected = true } = {}) => ({
  index, connected, axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i), value: pressed.includes(i) ? 1 : 0 })),
});

test('ACTIONS : exactement les 6 actions abstraites', () => {
  assert.deepEqual(Object.values(ACTIONS).sort(), ['back', 'confirm', 'down', 'left', 'right', 'up']);
});

test('keyToAction : flèches, Entrée/Espace = confirm, Échap/Retour arrière = back', () => {
  assert.equal(keyToAction('ArrowUp'), 'up');
  assert.equal(keyToAction('ArrowDown'), 'down');
  assert.equal(keyToAction('ArrowLeft'), 'left');
  assert.equal(keyToAction('ArrowRight'), 'right');
  assert.equal(keyToAction('Enter'), 'confirm');
  assert.equal(keyToAction(' '), 'confirm');
  assert.equal(keyToAction('Escape'), 'back');
  assert.equal(keyToAction('Backspace'), 'back');
});

test('keyToAction : touches inconnues (Tab, lettres, F10) donnent null', () => {
  for (const k of ['Tab', 'a', 'F10', '', undefined]) assert.equal(keyToAction(k), null);
});

test('readGamepad : croix directionnelle (boutons 12 à 15)', () => {
  assert.deepEqual([...readGamepad(pad({ pressed: [12] }))], ['up']);
  assert.deepEqual([...readGamepad(pad({ pressed: [13] }))], ['down']);
  assert.deepEqual([...readGamepad(pad({ pressed: [14] }))], ['left']);
  assert.deepEqual([...readGamepad(pad({ pressed: [15] }))], ['right']);
});

test('readGamepad : A (0) et Start (9) = confirm, B (1) = back', () => {
  assert.deepEqual([...readGamepad(pad({ pressed: [0] }))], ['confirm']);
  assert.deepEqual([...readGamepad(pad({ pressed: [9] }))], ['confirm']);
  assert.deepEqual([...readGamepad(pad({ pressed: [1] }))], ['back']);
});

test('readGamepad : stick gauche avec seuil 0.5 (strictement au-dessus)', () => {
  assert.deepEqual([...readGamepad(pad({ axes: [0.9, 0] }))], ['right']);
  assert.deepEqual([...readGamepad(pad({ axes: [-0.9, 0] }))], ['left']);
  assert.deepEqual([...readGamepad(pad({ axes: [0, -0.9] }))], ['up']);
  assert.deepEqual([...readGamepad(pad({ axes: [0, 0.9] }))], ['down']);
  assert.equal(readGamepad(pad({ axes: [0.5, 0.5] })).size, 0);
  assert.equal(readGamepad(pad({ axes: [0.3, -0.49] })).size, 0);
});

test('readGamepad : stick en diagonale ne garde que l\'axe dominant', () => {
  assert.deepEqual([...readGamepad(pad({ axes: [0.7, 0.9] }))], ['down']);
});

test('readGamepad : manette sans axes ni boutons, absente ou déconnectée donne un ensemble vide', () => {
  assert.equal(readGamepad(null).size, 0);
  assert.equal(readGamepad(pad({ connected: false, pressed: [0] })).size, 0);
  assert.equal(readGamepad({ connected: true, axes: [], buttons: [] }).size, 0);
});

test('readGamepad : valeurs NaN ou axes manquants ne plantent pas', () => {
  assert.equal(readGamepad({ connected: true, axes: [NaN], buttons: [] }).size, 0);
});

test('createGamepadReader : le premier appui d\'une manette fraîche réveille sans déclencher d\'action', () => {
  const r = createGamepadReader();
  const first = r.read([pad({ pressed: [0] })]);
  assert.equal(first.woke, true);
  assert.equal(first.held.size, 0);
  // Toujours enfoncé : encore supprimé, pas de nouveau réveil.
  const still = r.read([pad({ pressed: [0] })]);
  assert.equal(still.woke, false);
  assert.equal(still.held.size, 0);
  // Relâché puis appuyé : actif.
  r.read([pad()]);
  const real = r.read([pad({ pressed: [0] })]);
  assert.deepEqual([...real.held], ['confirm']);
});

test('createGamepadReader : sans activité, rien ne se passe ; manettes null ignorées', () => {
  const r = createGamepadReader();
  const res = r.read([null, pad(), undefined]);
  assert.equal(res.woke, false);
  assert.equal(res.held.size, 0);
});

test('createGamepadReader : une manette débranchée puis rebranchée est de nouveau "fraîche"', () => {
  const r = createGamepadReader();
  r.read([pad({ pressed: [0] })]);
  r.read([pad()]);
  r.read([null]);
  const back = r.read([pad({ pressed: [0] })]);
  assert.equal(back.woke, true);
  assert.equal(back.held.size, 0);
});

test('createGamepadReader : réunit les actions de plusieurs manettes éveillées', () => {
  const r = createGamepadReader();
  r.read([pad({ pressed: [0] }), pad({ index: 1, pressed: [0] })]);
  r.read([pad(), pad({ index: 1 })]);
  const res = r.read([pad({ pressed: [12] }), pad({ index: 1, pressed: [1] })]);
  assert.deepEqual([...res.held].sort(), ['back', 'up']);
});

test('createRepeater : front montant, délai 400 ms, puis toutes les 120 ms', () => {
  const rep = createRepeater({ delay: 400, interval: 120 });
  assert.deepEqual(rep.update(new Set(['right']), 0), ['right']);
  assert.deepEqual(rep.update(new Set(['right']), 399), []);
  assert.deepEqual(rep.update(new Set(['right']), 400), ['right']);
  assert.deepEqual(rep.update(new Set(['right']), 519), []);
  assert.deepEqual(rep.update(new Set(['right']), 520), ['right']);
});

test('createRepeater : relâcher puis réappuyer redéclenche tout de suite', () => {
  const rep = createRepeater();
  rep.update(new Set(['down']), 0);
  rep.update(new Set(), 50);
  assert.deepEqual(rep.update(new Set(['down']), 60), ['down']);
});

test('createRepeater : confirm et back ne se répètent jamais (front montant seulement)', () => {
  const rep = createRepeater();
  assert.deepEqual(rep.update(new Set(['confirm', 'back']), 0).sort(), ['back', 'confirm']);
  assert.deepEqual(rep.update(new Set(['confirm', 'back']), 5000), []);
});

test('createRepeater : après une longue pause (onglet figé) un seul tir, pas de rafale', () => {
  const rep = createRepeater({ delay: 400, interval: 120 });
  rep.update(new Set(['up']), 0);
  assert.deepEqual(rep.update(new Set(['up']), 10000), ['up']);
  assert.deepEqual(rep.update(new Set(['up']), 10050), []);
});

test('createRepeater : directions opposées simultanées s\'annulent', () => {
  const rep = createRepeater();
  assert.deepEqual(rep.update(new Set(['left', 'right']), 0), []);
  assert.deepEqual(rep.update(new Set(['left', 'right', 'up']), 10), ['up']);
});

test('createRepeater : durées réglables', () => {
  const rep = createRepeater({ delay: 100, interval: 10 });
  rep.update(new Set(['left']), 0);
  assert.deepEqual(rep.update(new Set(['left']), 100), ['left']);
  assert.deepEqual(rep.update(new Set(['left']), 110), ['left']);
});

/** Environnement factice : cible d'événements clavier + manettes pilotées + horloge + boucle de frames manuelle. */
function fakeEnv() {
  const listeners = {};
  let frame = null;
  const env = {
    pads: [],
    time: 0,
    target: {
      addEventListener: (t, f) => { (listeners[t] ??= new Set()).add(f); },
      removeEventListener: (t, f) => listeners[t]?.delete(f),
    },
    fire(type, ev = {}) {
      const e = { defaultPrevented: false, preventDefault() { this.defaultPrevented = true; }, ...ev };
      for (const f of [...(listeners[type] ?? [])]) f(e);
      return e;
    },
    listenerCount: () => Object.values(listeners).reduce((n, s) => n + s.size, 0),
    options: null,
    tick(dt = 16) { env.time += dt; const f = frame; frame = null; f?.(env.time); },
  };
  env.options = {
    target: env.target,
    getGamepads: () => env.pads,
    now: () => env.time,
    requestFrame: (f) => { frame = f; return 1; },
    cancelFrame: () => { frame = null; },
  };
  return env;
}

test('createActionSource : une touche flèche émet l\'action, avec la source keyboard, et bloque le défilement', () => {
  const env = fakeEnv(); const got = [];
  createActionSource(env.options).start((a, src) => got.push([a, src]));
  const e = env.fire('keydown', { key: 'ArrowRight' });
  env.tick();
  assert.deepEqual(got, [['right', 'keyboard']]);
  assert.equal(e.defaultPrevented, true);
});

test('createActionSource : Entrée et Espace sont consommés (pas de clic natif en double)', () => {
  const env = fakeEnv();
  createActionSource(env.options).start(() => {});
  assert.equal(env.fire('keydown', { key: 'Enter' }).defaultPrevented, true);
  assert.equal(env.fire('keyup', { key: 'Enter' }).defaultPrevented, true);
  assert.equal(env.fire('keydown', { key: ' ' }).defaultPrevented, true);
  assert.equal(env.fire('keyup', { key: ' ' }).defaultPrevented, true);
});

test('createActionSource : touches non gérées et combinaisons Ctrl/Alt/Méta laissées au navigateur', () => {
  const env = fakeEnv(); const got = [];
  createActionSource(env.options).start((a) => got.push(a));
  assert.equal(env.fire('keydown', { key: 'Tab' }).defaultPrevented, false);
  assert.equal(env.fire('keydown', { key: 'ArrowLeft', altKey: true }).defaultPrevented, false);
  assert.equal(env.fire('keydown', { key: 'Backspace', ctrlKey: true }).defaultPrevented, false);
  env.tick();
  assert.deepEqual(got, []);
});

test('createActionSource : touche maintenue = répétition contrôlée (400 ms puis 120 ms), pas celle de l\'OS', () => {
  const env = fakeEnv(); const got = [];
  createActionSource(env.options).start((a) => got.push(a));
  env.fire('keydown', { key: 'ArrowDown' });
  env.tick(0);
  env.fire('keydown', { key: 'ArrowDown', repeat: true });
  env.tick(200);
  assert.equal(got.length, 1);
  env.tick(200);
  assert.equal(got.length, 2);
  env.tick(120);
  assert.equal(got.length, 3);
  env.fire('keyup', { key: 'ArrowDown' });
  env.tick(500);
  assert.equal(got.length, 3);
});

test('createActionSource : perte de focus de la fenêtre (blur) relâche les touches', () => {
  const env = fakeEnv(); const got = [];
  createActionSource(env.options).start((a) => got.push(a));
  env.fire('keydown', { key: 'ArrowDown' });
  env.tick(0);
  env.fire('blur');
  env.tick(1000);
  assert.equal(got.length, 1);
});

test('createActionSource : manette, front montant de A, source gamepad, réveil signalé', () => {
  const env = fakeEnv(); const got = []; const woke = [];
  createActionSource({ ...env.options, onWake: () => woke.push(1) }).start((a, s) => got.push([a, s]));
  env.pads = [pad({ pressed: [0] })];
  env.tick();
  assert.deepEqual(got, []);
  assert.equal(woke.length, 1);
  env.pads = [pad()];
  env.tick();
  env.pads = [pad({ pressed: [0] })];
  env.tick();
  env.tick();
  assert.deepEqual(got, [['confirm', 'gamepad']]);
});

test('createActionSource : getGamepads absent ou qui lève ne casse pas la boucle', () => {
  const env = fakeEnv(); const got = [];
  createActionSource({ ...env.options, getGamepads: () => { throw new Error('SecurityError'); } }).start((a) => got.push(a));
  env.fire('keydown', { key: 'ArrowUp' });
  env.tick();
  assert.deepEqual(got, ['up']);
  const env2 = fakeEnv();
  createActionSource({ ...env2.options, getGamepads: undefined }).start(() => {});
  env2.tick();
});

test('createActionSource : stop retire tous les écouteurs et arrête la boucle', () => {
  const env = fakeEnv(); const got = [];
  const src = createActionSource(env.options);
  src.start((a) => got.push(a));
  assert.ok(env.listenerCount() > 0);
  src.stop();
  assert.equal(env.listenerCount(), 0);
  env.fire('keydown', { key: 'ArrowUp' });
  env.tick();
  assert.deepEqual(got, []);
});

test('createActionSource : un second start remplace le premier (pas d\'actions en double)', () => {
  const env = fakeEnv(); const got = [];
  const src = createActionSource(env.options);
  src.start((a) => got.push(['A', a]));
  src.start((a) => got.push(['B', a]));
  env.fire('keydown', { key: 'Enter' });
  env.tick();
  assert.deepEqual(got, [['B', 'confirm']]);
});

test('isEditable : input, textarea, select et contenteditable', () => {
  assert.equal(isEditable({ tagName: 'INPUT' }), true);
  assert.equal(isEditable({ tagName: 'textarea' }), true);
  assert.equal(isEditable({ tagName: 'SELECT' }), true);
  assert.equal(isEditable({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditable({ tagName: 'BUTTON' }), false);
  assert.equal(isEditable(null), false);
  assert.equal(isEditable(undefined), false);
});

test('createActionSource : la frappe dans un champ de saisie n\'est ni consommée ni traduite en action', () => {
  const env = fakeEnv(); const got = [];
  createActionSource(env.options).start((a) => got.push(a));
  const input = { tagName: 'INPUT' };
  for (const key of ['Backspace', ' ', 'Enter', 'ArrowLeft']) {
    assert.equal(env.fire('keydown', { key, target: input }).defaultPrevented, false);
    assert.equal(env.fire('keyup', { key, target: input }).defaultPrevented, false);
  }
  env.tick();
  assert.deepEqual(got, []);
});

test('createActionSource : une touche enfoncée hors champ puis relâchée dans un champ est bien relâchée', () => {
  const env = fakeEnv(); const got = [];
  createActionSource(env.options).start((a) => got.push(a));
  env.fire('keydown', { key: 'ArrowDown' });
  env.tick(0);
  env.fire('keyup', { key: 'ArrowDown', target: { tagName: 'INPUT' } });
  env.tick(1000);
  assert.equal(got.length, 1);
});
