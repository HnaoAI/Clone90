// Tests de js/player/ejs-start-watch.js (T14, partie B) : détection d'un contenu refusé par le cœur, sans faux positif.
// Faux minuteurs et fausse fenêtre : aucun EmulatorJS ni navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isContentFailureLine, createStartFailureWatch, hookCoreOutput, START_WATCH_MS } from '../js/player/ejs-start-watch.js';

const CONTENT_FAILURE = '[ERROR] [Content]: Failed to load content';

/** Minuteur factice : timers.fire() déclenche les minuteries en attente. */
function fakeTimers() {
  const pending = new Map();
  let nextId = 1;
  return {
    setTimer: (fn, ms) => { pending.set(nextId, { fn, ms }); return nextId++; },
    clearTimer: (id) => pending.delete(id),
    pending,
    fire: () => { for (const [id, t] of [...pending]) { pending.delete(id); t.fn(); } },
  };
}
const newWatch = () => {
  const timers = fakeTimers();
  const failures = [];
  const watch = createStartFailureWatch({ onFailure: (info) => failures.push(info), setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  return { watch, timers, failures };
};

test('isContentFailureLine : reconnaît l\'erreur du chargeur de contenu de RetroArch', () => {
  assert.equal(isContentFailureLine(CONTENT_FAILURE), true);
  assert.equal(isContentFailureLine('[ERROR] [Content]: Failed to load content.'), true);
  assert.equal(isContentFailureLine('[ERROR] [Content]: Content requires a core with content support'), true);
});

test('isContentFailureLine : pas de faux positif sur les lignes normales ou les autres erreurs', () => {
  for (const line of [
    '', '   ', 'Built for EmulatorJS Version 4.0.13',
    '[INFO] [Content]: Loading content file: "/viewpoin.zip".', // [Content] mais pas une erreur
    '[ERROR] [Config]: Failed to open shader preset', // erreur sans rapport avec le contenu
    '[libretro ERROR] ROM sp-s3.sp1 is missing', // la cause, pas le déclencheur
    '[WARN] [Content]: something', 'Failed to load content', 'ERROR Content',
  ]) assert.equal(isContentFailureLine(line), false, line);
  assert.equal(isContentFailureLine(undefined), false);
  assert.equal(isContentFailureLine(null), false);
  assert.equal(isContentFailureLine(42), false);
});

test('watch : une erreur de contenu déclenche onFailure une seule fois, avec les messages du cœur qui précèdent', () => {
  const { watch, failures } = newWatch();
  watch.feed('[libretro ERROR] [FBNeo] ROM sp-s3.sp1 is missing');
  watch.feed('[libretro ERROR] [FBNeo] None of those archives was found in your paths');
  watch.feed(CONTENT_FAILURE);
  watch.feed(CONTENT_FAILURE);
  assert.equal(failures.length, 1);
  assert.deepEqual(failures[0].coreMessages, ['[FBNeo] ROM sp-s3.sp1 is missing', '[FBNeo] None of those archives was found in your paths']);
  assert.equal(failures[0].line, CONTENT_FAILURE);
});

test('watch : sans message du cœur, la liste est vide mais l\'échec est quand même signalé', () => {
  const { watch, failures } = newWatch();
  watch.feed(CONTENT_FAILURE);
  assert.deepEqual(failures.map((f) => f.coreMessages), [[]]);
});

test('watch : aucun faux positif pendant un chargement lent (rien ne se passe, ou seulement des lignes normales)', () => {
  const { watch, timers, failures } = newWatch();
  for (let i = 0; i < 50; i += 1) watch.feed(`[INFO] ligne ${i}`);
  watch.feed('[ERROR] [Config]: erreur sans rapport');
  watch.feed('[libretro ERROR] avertissement du cœur seul');
  watch.started();
  timers.fire(); // fin de la fenêtre d'écoute
  assert.equal(failures.length, 0);
});

test('watch : l\'échec peut arriver avant EJS_onGameStart (chargement synchrone) comme après', () => {
  const before = newWatch();
  before.watch.feed(CONTENT_FAILURE);
  before.watch.started();
  assert.equal(before.failures.length, 1);
  const after = newWatch();
  after.watch.started();
  after.watch.feed(CONTENT_FAILURE);
  assert.equal(after.failures.length, 1);
});

test('watch : START_WATCH_MS après le démarrage, l\'écoute s\'arrête (une erreur tardive est ignorée)', () => {
  const { watch, timers, failures } = newWatch();
  watch.started();
  assert.equal([...timers.pending.values()][0].ms, START_WATCH_MS);
  assert.equal(START_WATCH_MS, 15000);
  timers.fire();
  watch.feed(CONTENT_FAILURE);
  assert.equal(failures.length, 0);
});

test('watch : started() appelé deux fois ne pose qu\'un seul minuteur ; stop() annule tout', () => {
  const { watch, timers, failures } = newWatch();
  watch.started();
  watch.started();
  assert.equal(timers.pending.size, 1);
  watch.stop();
  assert.equal(timers.pending.size, 0);
  watch.feed(CONTENT_FAILURE);
  assert.equal(failures.length, 0);
});

test('watch : ne garde que les derniers messages du cœur (mémoire bornée) et tronque les lignes énormes', () => {
  const { watch, failures } = newWatch();
  for (let i = 0; i < 100; i += 1) watch.feed(`[libretro ERROR] erreur ${i}`);
  watch.feed(`[libretro ERROR] ${'x'.repeat(5000)}`);
  watch.feed(CONTENT_FAILURE);
  const { coreMessages } = failures[0];
  assert.ok(coreMessages.length <= 8);
  assert.ok(coreMessages.at(-1).length <= 300);
});

test('watch : un onFailure qui lève ne casse pas le flux de sortie du cœur', () => {
  const watch = createStartFailureWatch({ onFailure: () => { throw new Error('boum'); } });
  assert.doesNotThrow(() => watch.feed(CONTENT_FAILURE));
});

// --- hookCoreOutput : interception de print/printErr via EJS_Runtime ---
function fakeRuntime() {
  const calls = [];
  const runtime = function runtime(options) { calls.push(options); return Promise.resolve({ fake: 'module', options }); };
  return { runtime, calls };
}

test('hookCoreOutput : EJS_Runtime reste appelable, renvoie ce que renvoie le vrai, et reçoit les mêmes options', async () => {
  const win = {};
  const lines = [];
  hookCoreOutput(win, (l) => lines.push(l));
  const { runtime, calls } = fakeRuntime();
  win.EJS_Runtime = runtime; // ce que fait `var EJS_Runtime = ...` du cœur
  assert.equal(typeof win.EJS_Runtime, 'function');
  const options = { noInitialRun: true, canvas: 'c' };
  const result = await win.EJS_Runtime(options);
  assert.equal(calls[0], options, 'le même objet : emscripten l\'utilise comme Module');
  assert.equal(options.noInitialRun, true);
  assert.equal(result.fake, 'module');
});

test('hookCoreOutput : print et printErr alimentent le watch ET appellent les fonctions d\'origine d\'EmulatorJS', () => {
  const win = {};
  const lines = [];
  hookCoreOutput(win, (l) => lines.push(l));
  const original = [];
  const options = { print: (m) => original.push(`out:${m}`), printErr: (m) => original.push(`err:${m}`) };
  const { runtime } = fakeRuntime();
  win.EJS_Runtime = runtime;
  win.EJS_Runtime(options);
  options.print('a');
  options.printErr('b');
  assert.deepEqual(lines, ['a', 'b']);
  assert.deepEqual(original, ['out:a', 'err:b']);
});

test('hookCoreOutput : sans print/printErr d\'origine, ou si le watch lève, la sortie du cœur n\'est pas interrompue', () => {
  const win = {};
  hookCoreOutput(win, () => { throw new Error('boum'); });
  const { runtime } = fakeRuntime();
  win.EJS_Runtime = runtime;
  const options = {};
  win.EJS_Runtime(options);
  assert.doesNotThrow(() => { options.print('x'); options.printErr('y'); });
});

test('hookCoreOutput : une valeur qui n\'est pas une fonction est laissée telle quelle', () => {
  const win = {};
  hookCoreOutput(win, () => {});
  assert.equal(win.EJS_Runtime, undefined);
  win.EJS_Runtime = 'pas une fonction';
  assert.equal(win.EJS_Runtime, 'pas une fonction');
});

test('hookCoreOutput : un EJS_Runtime déjà posé avant le hook est aussi enveloppé', () => {
  const { runtime } = fakeRuntime();
  const win = { EJS_Runtime: runtime };
  const lines = [];
  hookCoreOutput(win, (l) => lines.push(l));
  const options = {};
  win.EJS_Runtime(options);
  options.printErr('z');
  assert.deepEqual(lines, ['z']);
});
