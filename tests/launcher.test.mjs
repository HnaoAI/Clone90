// Tests de js/player/launcher.js (T7) : construction de la config EmulatorJS (fonction pure), contrôle des fichiers, chargement.
// Aucun vrai EmulatorJS : fenêtre et document factices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBios, buildLaunchPlan, findMissingFiles, describeMissing, loadEmulator, pauseEmulator, resumeEmulator, GAME_ELEMENT_ID } from '../js/player/launcher.js';
import { EJS_CDN_URL } from '../js/config.js';

const neogeo = {
  id: 'neogeo', name: 'Neo Geo', emulatorjsCore: 'arcade',
  bios: [{ file: 'neogeo.zip', required: true, role: 'default' }],
};
const amiga = {
  id: 'amiga', name: 'Amiga', emulatorjsCore: 'amiga',
  bios: [{ file: 'kick40068.A1200', required: true, role: 'default' }],
};
const nes = { id: 'nes', name: 'NES', emulatorjsCore: 'nes', bios: [] };
const gb = { id: 'gameboy', name: 'Game Boy', emulatorjsCore: 'gb', bios: [{ file: 'gb_bios.bin', required: false, role: 'optional' }] };
const mslug = { id: 'neogeo/mslug', system: 'neogeo', title: 'Metal Slug', file: 'roms/neogeo/mslug.zip', cover: null };

test('resolveBios : BIOS par défaut de la machine (role default)', () => {
  assert.deepEqual(resolveBios(neogeo, mslug), { file: 'neogeo.zip', required: true });
});

test('resolveBios : la surcharge `bios` du jeu l\'emporte et est obligatoire', () => {
  const lemmings = { id: 'amiga/lemmings', system: 'amiga', title: 'Lemmings', file: 'roms/amiga/Lemmings.adf', bios: 'kick34005.A500' };
  assert.deepEqual(resolveBios(amiga, lemmings), { file: 'kick34005.A500', required: true });
});

test('resolveBios : aucune BIOS par défaut (machine sans BIOS ou BIOS seulement optionnels) donne null', () => {
  assert.equal(resolveBios(nes, mslug), null);
  assert.equal(resolveBios(gb, mslug), null);
  assert.equal(resolveBios({ id: 'x' }, mslug), null);
});

test('resolveBios : une surcharge qui sort de bios/ est refusée (chemin absolu, .., schéma)', () => {
  for (const bad of ['../secret', '/etc/passwd', 'http://x/y', 'a/../../b']) {
    assert.throws(() => resolveBios(neogeo, { ...mslug, bios: bad }), /BIOS/);
  }
});

test('buildLaunchPlan : variables EmulatorJS depuis systems.json et games.json (Neo Geo)', () => {
  const plan = buildLaunchPlan({ system: neogeo, game: mslug });
  assert.equal(plan.globals.EJS_player, `#${GAME_ELEMENT_ID}`);
  assert.equal(plan.globals.EJS_core, 'arcade');
  assert.equal(plan.globals.EJS_gameUrl, 'roms/neogeo/mslug.zip');
  assert.equal(plan.globals.EJS_biosUrl, 'bios/neogeo.zip');
  assert.equal(plan.globals.EJS_pathtodata, EJS_CDN_URL);
  assert.equal(plan.globals.EJS_gameName, 'Metal Slug');
  assert.equal(plan.globals.EJS_startOnLoaded, true);
  assert.equal(plan.globals.EJS_askBeforeExit, false);
  assert.equal('EJS_threads' in plan.globals, false);
  assert.equal(plan.loaderUrl, `${EJS_CDN_URL}loader.js`);
});

test('buildLaunchPlan : le CDN vient de config.js, surchargeable pour un test, et garde un / final', () => {
  const plan = buildLaunchPlan({ system: neogeo, game: mslug, cdnUrl: 'https://exemple.test/4.2.3/data' });
  assert.equal(plan.globals.EJS_pathtodata, 'https://exemple.test/4.2.3/data/');
  assert.equal(plan.loaderUrl, 'https://exemple.test/4.2.3/data/loader.js');
});

test('buildLaunchPlan : chemins encodés (espaces, accents) comme l\'impose l\'architecture 6.2', () => {
  const g = { ...mslug, file: 'roms/neogeo/Le Roi d\'Or é.zip' };
  assert.equal(buildLaunchPlan({ system: neogeo, game: g }).globals.EJS_gameUrl, "roms/neogeo/Le%20Roi%20d'Or%20%C3%A9.zip");
});

test('buildLaunchPlan : sans BIOS, EJS_biosUrl n\'est pas défini', () => {
  const plan = buildLaunchPlan({ system: nes, game: { ...mslug, system: 'nes', id: 'nes/a', file: 'roms/nes/a.nes' } });
  assert.equal('EJS_biosUrl' in plan.globals, false);
  assert.deepEqual(plan.files.map((f) => f.kind), ['game']);
});

test('buildLaunchPlan : fichiers à contrôler = jeu + BIOS, la BIOS non requise est marquée optionnelle', () => {
  const plan = buildLaunchPlan({ system: amiga, game: { id: 'amiga/a', system: 'amiga', title: 'A', file: 'roms/amiga/a.adf' } });
  assert.deepEqual(plan.files, [
    { kind: 'game', path: 'roms/amiga/a.adf', url: 'roms/amiga/a.adf', required: true },
    { kind: 'bios', path: 'bios/kick40068.A1200', url: 'bios/kick40068.A1200', required: true },
  ]);
});

test('buildLaunchPlan : une machine sans cœur déclaré lève une erreur claire', () => {
  assert.throws(() => buildLaunchPlan({ system: { id: 'x', name: 'X' }, game: mslug }), /cœur/);
});

test('findMissingFiles : jeu absent et BIOS absente sont signalés (HEAD 404), présents ignorés', async () => {
  const plan = buildLaunchPlan({ system: neogeo, game: mslug });
  const head = async (url) => url === 'roms/neogeo/mslug.zip';
  const missing = await findMissingFiles(plan, head);
  assert.deepEqual(missing.map((f) => f.kind), ['bios']);
  assert.deepEqual(await findMissingFiles(plan, async () => true), []);
  assert.equal((await findMissingFiles(plan, async () => false)).length, 2);
});

test('findMissingFiles : une erreur réseau compte comme fichier introuvable (pas de rejet)', async () => {
  const plan = buildLaunchPlan({ system: neogeo, game: mslug });
  const missing = await findMissingFiles(plan, async () => { throw new Error('réseau'); });
  assert.equal(missing.length, 2);
});

test('findMissingFiles : une BIOS non requise absente n\'est pas une erreur', async () => {
  const plan = buildLaunchPlan({ system: neogeo, game: mslug });
  plan.files.find((f) => f.kind === 'bios').required = false;
  assert.deepEqual(await findMissingFiles(plan, async (u) => !u.startsWith('bios/')), []);
});

test('describeMissing : message clair "BIOS manquant : nom dans bios/" et jeu introuvable', () => {
  const plan = buildLaunchPlan({ system: amiga, game: { id: 'amiga/a', system: 'amiga', title: 'A', file: 'roms/amiga/a.adf' } });
  const [msg] = describeMissing(plan.files.filter((f) => f.kind === 'bios'));
  assert.equal(msg.title, 'BIOS manquant');
  assert.match(msg.detail, /kick40068\.A1200/);
  assert.match(msg.detail, /bios\//);
  const [g] = describeMissing(plan.files.filter((f) => f.kind === 'game'));
  assert.equal(g.title, 'Jeu introuvable');
  assert.match(g.detail, /roms\/amiga\/a\.adf/);
  assert.deepEqual(describeMissing([]), []);
});

// --- loadEmulator avec fenêtre et document factices ---
function fakeEnv({ fail = false } = {}) {
  const scripts = [];
  const doc = {
    getElementById: (id) => (id === GAME_ELEMENT_ID ? {} : null),
    createElement: () => { const s = { attrs: {} }; scripts.push(s); return s; },
    head: { append: (s) => queueMicrotask(() => (fail ? s.onerror?.(new Event('error')) : s.onload?.())) },
  };
  return { win: {}, doc, scripts };
}

test('loadEmulator : pose les variables globales AVANT d\'injecter loader.js, puis résout au chargement', async () => {
  const { win, doc, scripts } = fakeEnv();
  const plan = buildLaunchPlan({ system: neogeo, game: mslug });
  const seen = [];
  const append = doc.head.append;
  doc.head.append = (s) => { seen.push({ ...win }); append(s); };
  await loadEmulator(plan, { win, doc });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].EJS_core, 'arcade', 'les globales sont posées avant le script');
  assert.equal(scripts[0].src, plan.loaderUrl);
});

test('loadEmulator : onStart est branché sur EJS_onGameStart', async () => {
  const { win, doc } = fakeEnv();
  let started = 0;
  await loadEmulator(buildLaunchPlan({ system: neogeo, game: mslug }), { win, doc, onStart: () => { started += 1; } });
  win.EJS_onGameStart();
  assert.equal(started, 1);
});

test('loadEmulator : CDN inaccessible donne une erreur claire', async () => {
  const { win, doc } = fakeEnv({ fail: true });
  await assert.rejects(loadEmulator(buildLaunchPlan({ system: neogeo, game: mslug }), { win, doc }), /EmulatorJS/);
});

test('loadEmulator : élément #game absent donne une erreur', async () => {
  const { win, doc } = fakeEnv();
  doc.getElementById = () => null;
  await assert.rejects(loadEmulator(buildLaunchPlan({ system: neogeo, game: mslug }), { win, doc }), /#game|game/);
});

test('pauseEmulator / resumeEmulator : appellent pause/play si présents, sinon ne font rien', () => {
  const calls = [];
  const win = { EJS_emulator: { pause: () => calls.push('pause'), play: () => calls.push('play') } };
  assert.equal(pauseEmulator(win), true);
  assert.equal(resumeEmulator(win), true);
  assert.deepEqual(calls, ['pause', 'play']);
  assert.equal(pauseEmulator({}), false);
  assert.equal(resumeEmulator({ EJS_emulator: {} }), false);
});

test('pauseEmulator / resumeEmulator : ne lèvent jamais, même si EmulatorJS n\'a pas fini de charger (constaté sur le CDN réel)', () => {
  const broken = { EJS_emulator: { pause: () => { throw new TypeError('toggleMainLoop'); }, play: () => { throw new TypeError('toggleMainLoop'); } } };
  assert.equal(pauseEmulator(broken), false);
  assert.equal(resumeEmulator(broken), false);
});
