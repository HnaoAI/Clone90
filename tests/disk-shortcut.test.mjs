// Tests de js/player/disk-shortcut.js et du changement de disque de launcher.js (T12), sans navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  nextDiskIndex, diskToastText, isNextDiskPadHeld, isPadRbHeld, createDiskShortcut, DISK_KEY, PAD_NEXT_DISK,
} from '../js/player/disk-shortcut.js';
import { getDiskState, switchToDisk } from '../js/player/launcher.js';

const pad = (pressed = []) => ({ connected: true, buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })) });

test('constantes : F9 et RB (bouton 5)', () => {
  assert.equal(DISK_KEY, 'F9');
  assert.equal(PAD_NEXT_DISK, 5);
});

test('nextDiskIndex : cycle 3 vers 1, jamais hors bornes', () => {
  assert.equal(nextDiskIndex(0, 3), 1);
  assert.equal(nextDiskIndex(1, 3), 2);
  assert.equal(nextDiskIndex(2, 3), 0);
  assert.equal(nextDiskIndex(7, 3), 0, 'index incohérent : repart de la première');
  assert.equal(nextDiskIndex(0, 1), 0);
});

test('diskToastText : « Disquette 2 / 3 » (numérotation à partir de 1)', () => {
  assert.equal(diskToastText(1, 3), 'Disquette 2 / 3');
  assert.equal(diskToastText(0, 3), 'Disquette 1 / 3');
});

test('isNextDiskPadHeld : Select + RB oui ; Select seul, RB seul, avec Start non', () => {
  assert.equal(isNextDiskPadHeld([pad([8, 5])]), true);
  assert.equal(isNextDiskPadHeld([pad([8])]), false);
  assert.equal(isNextDiskPadHeld([pad([5])]), false);
  assert.equal(isNextDiskPadHeld([pad([8, 9, 5])]), false, 'Select+Start est la sortie');
  assert.equal(isNextDiskPadHeld([pad([8]), pad([5])]), false, 'deux manettes différentes ne comptent pas');
  assert.equal(isNextDiskPadHeld([null, pad([8, 5])]), true);
  assert.equal(isNextDiskPadHeld(null), false);
  assert.equal(isPadRbHeld([pad([5])]), true);
});

/** Environnement factice : cible d'évènements, manettes pilotables, boucle d'images manuelle. */
function setup({ count = 3, start = 0, enabled = true, failChange = false } = {}) {
  const listeners = {};
  const target = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type) => { delete listeners[type]; },
  };
  const env = { pads: [], index: start, changes: [], toasts: [], errors: [], enabled, frame: null };
  const shortcut = createDiskShortcut({
    target,
    isEnabled: () => env.enabled,
    getDiskState: () => (count > 0 ? { index: env.index, count } : null),
    changeDisk: (i) => { env.changes.push(i); if (failChange) throw new Error('unreachable'); env.index = i; },
    onChanged: (i, c) => env.toasts.push(diskToastText(i, c)),
    onError: (e) => env.errors.push(e.message),
    getGamepads: () => env.pads,
    requestFrame: (f) => { env.frame = f; return 1; },
    cancelFrame: () => { env.frame = null; },
  });
  shortcut.start();
  const key = (props) => { let prevented = false; listeners.keydown({ key: 'F9', repeat: false, preventDefault: () => { prevented = true; }, ...props }); return prevented; };
  const tick = (pressed) => { env.pads = pressed ? [pad(pressed)] : []; env.frame(); };
  return { env, shortcut, key, tick, listeners };
}

test('manette : Select maintenu + front de RB = disquette suivante, en cycle', () => {
  const { env, tick } = setup({ count: 3, start: 1 });
  tick([8]);
  tick([8, 5]);
  assert.deepEqual(env.changes, [2]);
  tick([8]); tick([8, 5]);
  assert.deepEqual(env.changes, [2, 0], 'cycle 3 vers 1');
  assert.deepEqual(env.toasts, ['Disquette 3 / 3', 'Disquette 1 / 3']);
});

test('anti-rebond : un appui maintenu = un seul changement', () => {
  const { env, tick } = setup();
  tick([8]);
  for (let i = 0; i < 30; i++) tick([8, 5]);
  assert.equal(env.changes.length, 1);
});

test('RB pressé avant Select ne change rien (RB est un bouton de jeu)', () => {
  const { env, tick } = setup();
  tick([5]);
  tick([5, 8]);
  assert.equal(env.changes.length, 0);
});

test('Select seul, RB seul : rien', () => {
  const { env, tick } = setup();
  tick([8]); tick([8]); tick([]); tick([5]); tick([]);
  assert.equal(env.changes.length, 0);
});

test('Select+Start (sortie), avec ou sans RB : jamais de changement de disquette', () => {
  const { env, tick } = setup();
  tick([8, 9]); tick([8, 9, 5]); tick([8, 9]);
  assert.equal(env.changes.length, 0);
});

test('Start seul : rien', () => {
  const { env, tick } = setup();
  tick([9]); tick([9, 5]);
  assert.equal(env.changes.length, 0);
});

test('clavier : F9 change et fait preventDefault ; les autres touches ne sont pas touchées', () => {
  const { env, key } = setup({ count: 2 });
  assert.equal(key({}), true);
  assert.deepEqual(env.changes, [1]);
  for (const k of ['F10', 'Escape', 'd', 'D', 'F8', 'Enter']) assert.equal(key({ key: k }), false, `${k} intacte`);
  assert.equal(env.changes.length, 1);
});

test('clavier : F9 maintenu (répétition) ou avec Ctrl/Alt/Meta : rien', () => {
  const { env, key } = setup();
  key({ repeat: true }); key({ ctrlKey: true }); key({ altKey: true }); key({ metaKey: true });
  assert.equal(env.changes.length, 0);
});

test('jeu à une disquette (ou état indisponible) : rien, pas de toast', () => {
  for (const count of [1, 0]) {
    const { env, key, tick } = setup({ count });
    key({}); tick([8]); tick([8, 5]);
    assert.deepEqual(env.changes, []);
    assert.deepEqual(env.toasts, []);
  }
});

test('inactif (boîte de confirmation ouverte) : F9 et manette ignorés', () => {
  const { env, key, tick } = setup({ enabled: false });
  key({}); tick([8]); tick([8, 5]);
  assert.equal(env.changes.length, 0);
});

test('échec du changement : onError, pas de toast, le suivant reste possible', () => {
  const { env, key } = setup({ failChange: true });
  key({});
  assert.deepEqual(env.errors, ['unreachable']);
  assert.deepEqual(env.toasts, []);
  key({});
  assert.equal(env.changes.length, 2);
});

test('pas de second changement pendant qu\'un changement asynchrone est en cours', async () => {
  const listeners = {};
  let release; const calls = [];
  const shortcut = createDiskShortcut({
    target: { addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener() {} },
    getDiskState: () => ({ index: 0, count: 3 }),
    changeDisk: (i) => { calls.push(i); return new Promise((r) => { release = r; }); },
    onChanged() {}, requestFrame: () => 1, cancelFrame() {}, getGamepads: () => [],
  });
  shortcut.start();
  const press = () => listeners.keydown({ key: 'F9', repeat: false, preventDefault() {} });
  press(); press();
  assert.equal(calls.length, 1);
  release(); await new Promise((r) => setImmediate(r));
  press();
  assert.equal(calls.length, 2);
});

test('stop : retire les écouteurs et la boucle', () => {
  const { shortcut, listeners, env } = setup();
  shortcut.stop();
  assert.equal(listeners.keydown, undefined);
  assert.equal(env.frame, null);
});

// launcher.js : un seul chemin de changement, partagé avec le menu d'EmulatorJS.
test('getDiskState : lit l\'état du cœur, null si indisponible', () => {
  const win = { EJS_emulator: { gameManager: { getCurrentDisk: () => 1, getDiskCount: () => 3 } } };
  assert.deepEqual(getDiskState(win), { index: 1, count: 3 });
  assert.equal(getDiskState({}), null);
  assert.equal(getDiskState({ EJS_emulator: { gameManager: {} } }), null);
  assert.equal(getDiskState({ EJS_emulator: { gameManager: { getCurrentDisk: () => { throw new Error('x'); }, getDiskCount: () => 3 } } }), null);
});

test('switchToDisk : appelle une seule fois handleSpecialOptions(\'disk\', n), la fonction du menu', () => {
  const calls = [];
  const win = { EJS_emulator: { handleSpecialOptions: (...a) => calls.push(a) } };
  switchToDisk(win, 2);
  assert.deepEqual(calls, [['disk', '2']]);
  assert.throws(() => switchToDisk({}, 1), /EmulatorJS/);
});
