// Tests du journal de diagnostic des changements de disquette (T16), alimenté par handleSpecialOptions patché dans launcher.js,
// du niveau de log du cœur selon debug, et de l'écoute des lignes du cœur. Faux EmulatorJS, aucun navigateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildLaunchPlan, loadEmulator, switchToDisk, DISK_STATE_CHECK_MS, STARTUP_GRACE_MS } from '../js/player/launcher.js';
import { buildRetroArchCfgExtra } from '../js/player/retroarch-cfg.js';
import { describeDiskTrace } from '../js/player/diagnostic-log.js';

const amiga = {
  id: 'amiga', name: 'Amiga', emulatorjsCore: 'amiga', disableRetroArchHotkeys: true,
  bios: [{ file: 'kick40068.A1200', required: true, role: 'default' }],
  coreOptions: { puae_model: 'A1200', puae_floppy_multidrive: 'disabled' },
};
const neogeo = { id: 'neogeo', name: 'Neo Geo', emulatorjsCore: 'arcade', bios: [] };
const leander = {
  id: 'amiga/leander_(1991)(psygnosis)', system: 'amiga', title: 'Leander', file: 'roms/amiga/Leander (1991)(Psygnosis)(Disk 1 of 3).adf', cover: null,
  disks: ['roms/amiga/Leander (1991)(Psygnosis)(Disk 1 of 3).adf', 'roms/amiga/Leander (1991)(Psygnosis)(Disk 2 of 3).adf', 'roms/amiga/Leander (1991)(Psygnosis)(Disk 3 of 3).adf'],
};
const getBytes = async () => new Uint8Array([1]);
const linesOf = (text) => text.split('\n').filter(Boolean);

function fakeEnv() {
  const doc = {
    getElementById: () => ({}),
    createElement: () => ({}),
    head: { append: (s) => queueMicrotask(() => s.onload?.()) },
  };
  return { win: {}, doc };
}

/** Charge le faux EmulatorJS avec journal. `behaviour(callIndex)` décide si l'appel n lève. */
async function traced({ current = 0, failingCalls = [], count = 3 } = {}) {
  const { win, doc } = fakeEnv();
  const events = [];
  const coreLines = [];
  const timers = [];
  await loadEmulator(buildLaunchPlan({ system: amiga, game: leander, debug: true }), {
    win, doc, getBytes, setTimer: (fn, ms) => timers.push({ fn, ms }),
    onDiskTrace: (e) => events.push(e), onCoreLine: (l) => coreLines.push(l),
  });
  const state = { calls: [], current, n: 0 };
  const emulator = {
    gameManager: { getCurrentDisk: () => state.current, getDiskCount: () => count },
    handleSpecialOptions(option, value) {
      state.calls.push([option, value]);
      if (option !== 'disk') return;
      const index = state.n++;
      if (failingCalls.includes(index)) throw new Error('unreachable');
      state.current = Number(value);
    },
  };
  win.EJS_emulator = emulator;
  const startedLater = () => { win.EJS_onGameStart(); timers.find((t) => t.ms === STARTUP_GRACE_MS).fn(); };
  return { win, emulator, state, events, coreLines, timers, startedLater };
}

test('T16 journal disquette : premier appel ok - demande (source, valeur, courant) puis 1er appel ok', async () => {
  const { win, emulator, events, startedLater } = await traced();
  startedLater();
  switchToDisk(win, 1, 'F9');
  assert.deepEqual(events.map((e) => e.type), ['request', 'first-call']);
  assert.deepEqual(events[0], { type: 'request', source: 'F9', value: '1', current: 0 });
  assert.equal(events[1].ok, true);
  assert.equal(emulator.clone90DiskSource, undefined, 'la source est effacée après usage');
});

test('T16 journal disquette : par le menu EmulatorJS (sans source), la source est « menu EmulatorJS »', async () => {
  const { emulator, events, startedLater } = await traced();
  startedLater();
  emulator.handleSpecialOptions('disk', '2');
  assert.equal(events[0].source, 'menu EmulatorJS');
  switchToDisk({ EJS_emulator: emulator }, 1, 'Select+RB');
  assert.equal(events.find((e, i) => i > 1 && e.type === 'request').source, 'Select+RB');
});

test('T16 journal disquette : unreachable puis ok - 1er appel en échec, 2e appel ok, pas de rétablissement', async () => {
  const { win, events, state, startedLater } = await traced({ failingCalls: [0] });
  startedLater();
  switchToDisk(win, 1, 'F9');
  assert.deepEqual(events.map((e) => e.type), ['request', 'first-call', 'second-call']);
  assert.equal(events[1].ok, false);
  assert.match(events[1].error.message, /unreachable/);
  assert.equal(events[2].ok, true);
  assert.equal(state.current, 1);
});

test('T16 journal disquette : double échec puis rétablissement du disque d\'origine, l\'erreur remonte toujours', async () => {
  const { win, events, state, startedLater } = await traced({ current: 0, failingCalls: [0, 1] });
  startedLater();
  assert.throws(() => switchToDisk(win, 2, 'Select+RB'), /unreachable/);
  assert.deepEqual(events.map((e) => e.type), ['request', 'first-call', 'second-call', 'restore']);
  assert.deepEqual(events[3], { type: 'restore', value: '0', ok: true });
  assert.deepEqual(state.calls.map((c) => c[1]), ['2', '2', '0']);
});

test('T16 journal disquette : rétablissement lui-même en échec = noté ok:false', async () => {
  const { win, events, startedLater } = await traced({ current: 1, failingCalls: [0, 1, 2] });
  startedLater();
  assert.throws(() => switchToDisk(win, 2), /unreachable/);
  assert.deepEqual(events.at(-1), { type: 'restore', value: '1', ok: false });
});

test('T16 journal disquette : l\'état du cœur est relu 0,5 s, 2 s et 5 s après', async () => {
  assert.deepEqual(DISK_STATE_CHECK_MS, [500, 2000, 5000]);
  const { win, events, state, timers, startedLater } = await traced();
  startedLater();
  const before = timers.length;
  switchToDisk(win, 1, 'F9');
  const checks = timers.slice(before);
  assert.deepEqual(checks.map((t) => t.ms), [500, 2000, 5000]);
  state.current = 1;
  checks.forEach((t) => t.fn());
  const states = events.filter((e) => e.type === 'state');
  assert.deepEqual(states.map((e) => e.delayMs), [500, 2000, 5000]);
  assert.deepEqual(states[0].state, { index: 1, count: 3 });
  assert.match(describeDiskTrace(states[0]), /disque 2 \/ 3/);
});

test('T16 journal disquette : au démarrage, re-choisir le disque déjà en place est noté « ignoré » et le vrai handler n\'est pas appelé', async () => {
  const { emulator, events, state } = await traced({ current: 0 });
  emulator.handleSpecialOptions('disk', '0');
  assert.deepEqual(events.map((e) => e.type), ['request', 'ignored']);
  assert.equal(state.calls.length, 0);
});

test('T16 journal disquette : une autre option que « disk » passe sans rien noter', async () => {
  const { emulator, events, state } = await traced();
  emulator.handleSpecialOptions('shader', 'x');
  assert.equal(events.length, 0);
  assert.deepEqual(state.calls, [['shader', 'x']]);
});

test('T16 journal disquette : un journal qui lève ne casse pas le changement de disquette', async () => {
  const { win, doc } = fakeEnv();
  const timers = [];
  await loadEmulator(buildLaunchPlan({ system: amiga, game: leander }), { win, doc, getBytes, setTimer: (fn, ms) => timers.push({ fn, ms }), onDiskTrace: () => { throw new Error('journal cassé'); } });
  const calls = [];
  win.EJS_emulator = { gameManager: { getCurrentDisk: () => 0 }, handleSpecialOptions: (...a) => calls.push(a) };
  win.EJS_onGameStart(); timers.find((t) => t.ms === STARTUP_GRACE_MS).fn();
  switchToDisk(win, 1, 'F9');
  assert.deepEqual(calls, [['disk', '1']]);
});

test('T16 sans journal : aucun minuteur supplémentaire ni propriété laissée (comportement d\'avant)', async () => {
  const { win, doc } = fakeEnv();
  const timers = [];
  await loadEmulator(buildLaunchPlan({ system: amiga, game: leander }), { win, doc, getBytes, setTimer: (fn, ms) => timers.push({ fn, ms }) });
  win.EJS_emulator = { gameManager: { getCurrentDisk: () => 0 }, handleSpecialOptions() {} };
  win.EJS_onGameStart(); timers.find((t) => t.ms === STARTUP_GRACE_MS).fn();
  const before = timers.length;
  switchToDisk(win, 1);
  assert.equal(timers.length, before);
});

test('T16 lignes du cœur : print/printErr arrivent à onCoreLine (et seulement quand le diagnostic le demande)', async () => {
  const { win, doc } = fakeEnv();
  const lines = [];
  await loadEmulator(buildLaunchPlan({ system: amiga, game: leander, debug: true }), { win, doc, getBytes, onCoreLine: (l) => lines.push(l) });
  const printed = [];
  win.EJS_Runtime = (options) => { options.print('[INFO] Disk (2) inserted in drive DF0'); options.printErr('[WARN] x'); return 'rt'; };
  assert.equal(win.EJS_Runtime({ print: (m) => printed.push(m), printErr: () => {} }), 'rt');
  assert.deepEqual(lines, ['[INFO] Disk (2) inserted in drive DF0', '[WARN] x']);
  assert.deepEqual(printed, ['[INFO] Disk (2) inserted in drive DF0']);
  const plain = fakeEnv();
  await loadEmulator(buildLaunchPlan({ system: amiga, game: leander }), { win: plain.win, doc: plain.doc, getBytes });
  plain.win.EJS_Runtime = (options) => { options.print('x'); return 1; };
  assert.equal(plain.win.EJS_Runtime({ print: () => {}, printErr: () => {} }), 1);
});

test('T16 niveau de log du cœur : erreurs (3) par défaut, info (1) avec debug, sans doublon de clé ni changement des raccourcis', () => {
  assert.deepEqual(linesOf(buildRetroArchCfgExtra({})), ['log_verbosity = true', 'frontend_log_level = 3', 'libretro_log_level = 3']);
  assert.deepEqual(linesOf(buildRetroArchCfgExtra({ debug: false })), linesOf(buildRetroArchCfgExtra()));
  const debugLines = linesOf(buildRetroArchCfgExtra({ debug: true }));
  assert.deepEqual(debugLines, ['log_verbosity = true', 'frontend_log_level = 1', 'libretro_log_level = 1']);
  const both = linesOf(buildRetroArchCfgExtra({ debug: true, disableHotkeys: true }));
  assert.equal(new Set(both.map((l) => l.split(' = ')[0])).size, both.length);
  assert.deepEqual(both.filter((l) => l.startsWith('input_')), linesOf(buildRetroArchCfgExtra({ disableHotkeys: true })).filter((l) => l.startsWith('input_')));
});

test('T16 plan de lancement : debug=true relève le niveau de log du cœur, sinon erreurs seulement ; le reste du plan est identique', () => {
  const normal = buildLaunchPlan({ system: amiga, game: leander });
  const debug = buildLaunchPlan({ system: amiga, game: leander, debug: true });
  assert.match(normal.retroarchCfgExtra, /libretro_log_level = 3/);
  assert.match(debug.retroarchCfgExtra, /libretro_log_level = 1/);
  assert.match(debug.retroarchCfgExtra, /frontend_log_level = 1/);
  assert.deepEqual({ ...debug, retroarchCfgExtra: '' }, { ...normal, retroarchCfgExtra: '' });
  assert.match(buildLaunchPlan({ system: neogeo, game: { id: 'neogeo/x', system: 'neogeo', title: 'X', file: 'roms/neogeo/x.zip' } }).retroarchCfgExtra, /log_level = 3/);
});
