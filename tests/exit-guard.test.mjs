// Tests de js/player/exit-guard.js (T7) : détection de sortie (CA-J1, CA-J2), sans navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHoldTracker, isPadComboHeld, isPadSelectOrStartHeld, createExitGuard, EXIT_HOLD_MS } from '../js/player/exit-guard.js';

const pad = (pressed = [], index = 0) => ({
  index, connected: true,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.includes(i) })),
});

test('EXIT_HOLD_MS vaut 1 seconde (docs/ux.md 4.4)', () => assert.equal(EXIT_HOLD_MS, 1000));

test('createHoldTracker : progression 0 à 1, complété une seule fois par maintien', () => {
  const t = createHoldTracker(1000);
  assert.deepEqual(t.update(false, 0), { progress: 0, completed: false });
  assert.deepEqual(t.update(true, 100), { progress: 0, completed: false });
  assert.equal(t.update(true, 600).progress, 0.5);
  assert.deepEqual(t.update(true, 1100), { progress: 1, completed: true });
  assert.deepEqual(t.update(true, 3000), { progress: 1, completed: false }, 'pas de re-déclenchement tant que tenu');
  assert.equal(t.update(false, 3100).progress, 0);
  t.update(true, 4000);
  assert.equal(t.update(true, 5000).completed, true, 'un nouveau maintien redéclenche');
});

test('createHoldTracker : relâcher avant la durée remet à zéro sans déclencher', () => {
  const t = createHoldTracker(1000);
  t.update(true, 0);
  t.update(true, 900);
  assert.deepEqual(t.update(false, 950), { progress: 0, completed: false });
  t.update(true, 1000);
  assert.equal(t.update(true, 1500).completed, false);
});

test('isPadComboHeld : Select (8) ET Start (9) sur la même manette, jamais l\'un sans l\'autre (CA-J1)', () => {
  assert.equal(isPadComboHeld([pad([8, 9])]), true);
  assert.equal(isPadComboHeld([pad([8])]), false);
  assert.equal(isPadComboHeld([pad([9])]), false);
  assert.equal(isPadComboHeld([pad([8]), pad([9], 1)]), false, 'deux manettes différentes ne comptent pas');
  assert.equal(isPadComboHeld([null, pad([8, 9], 1)]), true);
  assert.equal(isPadComboHeld([{ ...pad([8, 9]), connected: false }]), false);
  assert.equal(isPadComboHeld(null), false);
  assert.equal(isPadComboHeld([{ buttons: [] }]), false);
});

// --- Garde complète avec environnement factice ---
function setup(overrides = {}) {
  const listeners = [];
  const target = {
    addEventListener: (type, fn, opts) => listeners.push({ type, fn, opts }),
    removeEventListener: (type, fn) => { const i = listeners.findIndex((l) => l.type === type && l.fn === fn); if (i >= 0) listeners.splice(i, 1); },
  };
  const env = { time: 0, pads: [], frames: [], requests: [], progress: [], taps: 0 };
  const guard = createExitGuard({
    target,
    getGamepads: () => env.pads,
    now: () => env.time,
    requestFrame: (f) => { env.frames.push(f); return env.frames.length; },
    cancelFrame: () => { env.frames.length = 0; },
    onRequest: (kind) => env.requests.push(kind),
    onProgress: (p) => env.progress.push(p),
    onEscapeTap: () => { env.taps += 1; },
    ...overrides,
  });
  const fire = (type, init = {}) => {
    const e = { type, key: '', repeat: false, ctrlKey: false, altKey: false, metaKey: false, defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.stopped = true; }, stopImmediatePropagation() { this.stopped = true; }, ...init };
    listeners.filter((l) => l.type === type).forEach((l) => l.fn(e));
    return e;
  };
  const tick = (ms) => { env.time += ms; const f = env.frames.shift(); f?.(); };
  return { guard, env, fire, tick, listeners };
}

test('écoute en phase de capture sur la cible (le jeu ne peut pas nous masquer les touches)', () => {
  const { guard, listeners } = setup();
  guard.start();
  assert.ok(listeners.length >= 2);
  assert.ok(listeners.every((l) => l.opts === true || l.opts?.capture === true));
  guard.stop();
  assert.equal(listeners.length, 0);
});

test('CA-J2 clavier : F10 demande la sortie tout de suite, une seule fois malgré la répétition', () => {
  const { guard, env, fire } = setup();
  guard.start();
  const e = fire('keydown', { key: 'F10' });
  fire('keydown', { key: 'F10', repeat: true });
  assert.deepEqual(env.requests, ['f10']);
  assert.equal(e.defaultPrevented, true, 'F10 est à nous (menu du navigateur évité)');
});

test('CA-J2 clavier : Échap maintenu 1 s demande la sortie, avec progression', () => {
  const { guard, env, fire, tick } = setup();
  guard.start();
  tick(0);
  fire('keydown', { key: 'Escape' });
  tick(16);
  tick(500);
  assert.ok(env.progress.some((p) => p > 0.4 && p < 0.6));
  tick(600);
  assert.deepEqual(env.requests, ['escape']);
  fire('keydown', { key: 'Escape', repeat: true });
  tick(2000);
  assert.deepEqual(env.requests, ['escape'], 'une seule demande par maintien');
});

test('CA-J1 : Échap court ne demande rien (reste à EmulatorJS), signale un tap, sans preventDefault', () => {
  const { guard, env, fire, tick } = setup();
  guard.start();
  tick(0);
  const down = fire('keydown', { key: 'Escape' });
  tick(200);
  const up = fire('keyup', { key: 'Escape' });
  tick(2000);
  assert.deepEqual(env.requests, []);
  assert.equal(env.taps, 1);
  assert.equal(down.defaultPrevented || up.defaultPrevented, false);
  assert.equal(down.stopped || up.stopped, false);
});

test('Échap maintenu puis relâché après la sortie n\'est pas un tap', () => {
  const { guard, env, fire, tick } = setup();
  guard.start();
  tick(0);
  fire('keydown', { key: 'Escape' });
  tick(16);
  tick(1100);
  fire('keyup', { key: 'Escape' });
  assert.equal(env.taps, 0);
  assert.deepEqual(env.requests, ['escape']);
});

test('CA-J1 : aucune autre touche de jeu n\'est captée (pas de preventDefault, pas de stopPropagation, pas de demande)', () => {
  const { guard, env, fire, tick } = setup();
  guard.start();
  for (const key of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'x', 'z', 'a', 's', 'q', 'w', 'Enter', 'v', ' ', 'F9', 'F11', 'Backspace']) {
    const d = fire('keydown', { key });
    const u = fire('keyup', { key });
    assert.equal(d.defaultPrevented || u.defaultPrevented || d.stopped || u.stopped, false, key);
  }
  tick(3000);
  assert.deepEqual(env.requests, []);
});

test('F10 et Échap avec Ctrl, Alt ou Méta restent au navigateur', () => {
  const { guard, env, fire, tick } = setup();
  guard.start();
  tick(0);
  fire('keydown', { key: 'F10', ctrlKey: true });
  fire('keydown', { key: 'Escape', metaKey: true });
  tick(2000);
  assert.deepEqual(env.requests, []);
});

test('CA-J2 manette : Select + Start maintenus 1 s demandent la sortie, anneau de progression', () => {
  const { guard, env, tick } = setup();
  guard.start();
  env.pads = [pad([8, 9])];
  tick(0);
  tick(500);
  assert.ok(env.progress.some((p) => p > 0.4 && p < 0.6));
  tick(600);
  assert.deepEqual(env.requests, ['gamepad']);
  tick(3000);
  assert.deepEqual(env.requests, ['gamepad']);
});

test('CA-J1 manette : Start seul ou Select seul, même longtemps, ne demandent rien', () => {
  const { guard, env, tick } = setup();
  guard.start();
  env.pads = [pad([9])];
  for (let i = 0; i < 5; i += 1) tick(1000);
  env.pads = [pad([8])];
  for (let i = 0; i < 5; i += 1) tick(1000);
  assert.deepEqual(env.requests, []);
});

test('manette : relâcher avant 1 s annule, la progression revient à 0', () => {
  const { guard, env, tick } = setup();
  guard.start();
  env.pads = [pad([8, 9])];
  tick(0);
  tick(800);
  env.pads = [pad([])];
  tick(100);
  tick(2000);
  assert.deepEqual(env.requests, []);
  assert.equal(env.progress.at(-1), 0);
});

test('manette : getGamepads qui lève une erreur ne casse pas la boucle', () => {
  const { guard, env, tick } = setup({ getGamepads: () => { throw new Error('refusé'); } });
  guard.start();
  tick(0);
  tick(16);
  assert.deepEqual(env.requests, []);
  assert.ok(env.frames.length > 0, 'la boucle continue');
});

test('isPadSelectOrStartHeld : Select ou Start, seul ou ensemble ; A seul non', () => {
  assert.equal(isPadSelectOrStartHeld([pad([8])]), true);
  assert.equal(isPadSelectOrStartHeld([pad([9])]), true);
  assert.equal(isPadSelectOrStartHeld([pad([8, 9])]), true);
  assert.equal(isPadSelectOrStartHeld([pad([0])]), false);
  assert.equal(isPadSelectOrStartHeld(null), false);
});

test('la garde expose isSelectOrStartHeld, lu tout de suite (sans attendre la frame)', () => {
  const { guard, env } = setup();
  env.pads = [pad([9])];
  assert.equal(guard.isSelectOrStartHeld(), true);
  env.pads = [pad([0])];
  assert.equal(guard.isSelectOrStartHeld(), false);
});

test('perte de focus de la fenêtre (blur) : Échap tenu est oublié, pas de sortie fantôme', () => {
  const { guard, env, fire, tick } = setup();
  guard.start();
  tick(0);
  fire('keydown', { key: 'Escape' });
  tick(500);
  fire('blur');
  tick(2000);
  assert.deepEqual(env.requests, []);
});

test('stop() puis start() : pas de double écoute', () => {
  const { guard, listeners } = setup();
  guard.start();
  const n = listeners.length;
  guard.start();
  assert.equal(listeners.length, n);
});
