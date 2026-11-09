// Tests de js/player/launcher.js (T7) : construction de la config EmulatorJS (fonction pure), contrôle des fichiers, chargement.
// Aucun vrai EmulatorJS : fenêtre et document factices.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBios, buildLaunchPlan, findMissingFiles, checkPlanFiles, describeMissing, loadEmulator, pauseEmulator, resumeEmulator, GAME_ELEMENT_ID } from '../js/player/launcher.js';
import { EJS_CDN_URL } from '../js/config.js';

const neogeo = {
  id: 'neogeo', name: 'Neo Geo', emulatorjsCore: 'arcade',
  bios: [{ file: 'neogeo.zip', required: true, role: 'default', keepZipped: true }],
};
const amiga = {
  id: 'amiga', name: 'Amiga', emulatorjsCore: 'amiga',
  bios: [{ file: 'kick40068.A1200', required: true, role: 'default' }],
  coreOptions: { puae_model: 'A1200' },
};
const nes = { id: 'nes', name: 'NES', emulatorjsCore: 'nes', bios: [] };
const gb = { id: 'gameboy', name: 'Game Boy', emulatorjsCore: 'gb', bios: [{ file: 'gb_bios.bin', required: false, role: 'optional' }] };
const mslug = { id: 'neogeo/mslug', system: 'neogeo', title: 'Metal Slug', file: 'roms/neogeo/mslug.zip', cover: null };

test('resolveBios : BIOS par défaut de la machine (role default)', () => {
  assert.deepEqual(resolveBios(neogeo, mslug), { file: 'neogeo.zip', required: true, keepZipped: true });
});

test('resolveBios : la surcharge `bios` du jeu l\'emporte et est obligatoire', () => {
  const lemmings = { id: 'amiga/lemmings', system: 'amiga', title: 'Lemmings', file: 'roms/amiga/Lemmings.adf', bios: 'kick34005.A500' };
  assert.deepEqual(resolveBios(amiga, lemmings), { file: 'kick34005.A500', required: true, keepZipped: false });
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
  assert.equal('EJS_biosUrl' in plan.globals, false, 'neogeo.zip est gardé zippé : jamais passé à EJS_biosUrl (EmulatorJS l\'extrairait)');
  assert.deepEqual(plan.rawFiles, [{ url: 'bios/neogeo.zip', fsPath: '/neogeo.zip' }]);
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
  assert.match(msg.detail, /^Placez kick40068\.A1200 dans le dossier bios\//);
  assert.match(msg.detail, /bios\//);
  const [g] = describeMissing(plan.files.filter((f) => f.kind === 'game'));
  assert.equal(g.title, 'Jeu introuvable');
  assert.match(g.detail, /roms\/amiga\/a\.adf/);
  assert.deepEqual(describeMissing([]), []);
});

// --- loadEmulator avec fenêtre et document factices ---
const getBytes = async () => new Uint8Array([1]); // jamais de vrai réseau
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
  await loadEmulator(plan, { win, doc, getBytes });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].EJS_core, 'arcade', 'les globales sont posées avant le script');
  assert.equal(scripts[0].src, plan.loaderUrl);
});

test('loadEmulator : onStart est branché sur EJS_onGameStart', async () => {
  const { win, doc } = fakeEnv();
  let started = 0;
  await loadEmulator(buildLaunchPlan({ system: neogeo, game: mslug }), { win, doc, getBytes, onStart: () => { started += 1; } });
  win.EJS_onGameStart();
  assert.equal(started, 1);
});

test('loadEmulator : CDN inaccessible donne une erreur claire', async () => {
  const { win, doc } = fakeEnv({ fail: true });
  await assert.rejects(loadEmulator(buildLaunchPlan({ system: neogeo, game: mslug }), { win, doc, getBytes }), /EmulatorJS/);
});

test('loadEmulator : élément #game absent donne une erreur', async () => {
  const { win, doc } = fakeEnv();
  doc.getElementById = () => null;
  await assert.rejects(loadEmulator(buildLaunchPlan({ system: neogeo, game: mslug }), { win, doc, getBytes }), /#game|game/);
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

test('checkPlanFiles : un BIOS optionnel absent est retiré du plan (pas de EJS_biosUrl en 404), sans erreur', async () => {
  const optional = { ...neogeo, bios: [{ file: 'neogeo.zip', required: false, role: 'default' }] }; // sans keepZipped : voie EJS_biosUrl
  const plan = buildLaunchPlan({ system: optional, game: mslug });
  assert.equal(plan.globals.EJS_biosUrl, 'bios/neogeo.zip');
  const { missing, plan: cleaned } = await checkPlanFiles(plan, async (u) => !u.startsWith('bios/'));
  assert.deepEqual(missing, []);
  assert.equal('EJS_biosUrl' in cleaned.globals, false);
  assert.deepEqual(cleaned.files.map((f) => f.kind), ['game']);
  assert.equal(plan.globals.EJS_biosUrl, 'bios/neogeo.zip', 'le plan d\'origine n\'est pas modifié');
});

test('checkPlanFiles : un BIOS optionnel présent est conservé, un BIOS requis absent reste une erreur', async () => {
  const optional = { ...neogeo, bios: [{ file: 'neogeo.zip', required: false, role: 'default' }] }; // sans keepZipped : voie EJS_biosUrl
  const kept = await checkPlanFiles(buildLaunchPlan({ system: optional, game: mslug }), async () => true);
  assert.equal(kept.plan.globals.EJS_biosUrl, 'bios/neogeo.zip');
  const req = await checkPlanFiles(buildLaunchPlan({ system: neogeo, game: mslug }), async (u) => !u.startsWith('bios/'));
  assert.deepEqual(req.missing.map((f) => f.kind), ['bios']);
});

// --- BIOS gardé zippé (T0 : fbneo veut neogeo.zip entier, EmulatorJS stable extrait tout ce qui passe par EJS_biosUrl) ---
test('resolveBios : keepZipped vaut faux par défaut, et la surcharge du jeu garde le réglage de la machine', () => {
  assert.equal(resolveBios(amiga, { id: 'amiga/a', file: 'roms/amiga/a.adf' }).keepZipped, false);
  assert.equal(resolveBios(neogeo, { ...mslug, bios: 'neogeo.zip' }).keepZipped, true);
  assert.equal(resolveBios(neogeo, { ...mslug, bios: 'autre.zip' }).keepZipped, false);
});

test('buildLaunchPlan : un BIOS non zippé garde EJS_biosUrl et n\'a pas de rawFiles (Amiga)', () => {
  const plan = buildLaunchPlan({ system: amiga, game: { id: 'amiga/a', system: 'amiga', title: 'A', file: 'roms/amiga/a.adf' } });
  assert.equal(plan.globals.EJS_biosUrl, 'bios/kick40068.A1200');
  assert.deepEqual(plan.rawFiles, []);
});

test('buildLaunchPlan : le BIOS gardé zippé reste contrôlé (HEAD) comme BIOS requis', () => {
  const plan = buildLaunchPlan({ system: neogeo, game: mslug });
  assert.deepEqual(plan.files.map((f) => [f.kind, f.url, f.required]), [['game', 'roms/neogeo/mslug.zip', true], ['bios', 'bios/neogeo.zip', true]]);
});

test('checkPlanFiles : un BIOS gardé zippé optionnel et absent est retiré de rawFiles', async () => {
  const optional = { ...neogeo, bios: [{ file: 'neogeo.zip', required: false, role: 'default', keepZipped: true }] };
  const plan = buildLaunchPlan({ system: optional, game: mslug });
  const { plan: cleaned } = await checkPlanFiles(plan, async (u) => !u.startsWith('bios/'));
  assert.deepEqual(cleaned.rawFiles, []);
  assert.equal(plan.rawFiles.length, 1, 'le plan d\'origine n\'est pas modifié');
});

test('loadEmulator : le BIOS gardé zippé est lu en octets puis posé dans EJS_externalFiles AVANT loader.js', async () => {
  const { win, doc } = fakeEnv();
  const seen = [];
  const append = doc.head.append;
  doc.head.append = (s) => { seen.push({ ...win }); append(s); };
  const bytes = new Uint8Array([80, 75, 3, 4]);
  const asked = [];
  await loadEmulator(buildLaunchPlan({ system: neogeo, game: mslug }), { win, doc, getBytes: async (url) => { asked.push(url); return bytes; } });
  assert.deepEqual(asked, ['bios/neogeo.zip']);
  assert.equal(seen[0].EJS_externalFiles['/neogeo.zip'], bytes);
  assert.ok(seen[0].EJS_externalFiles['/neogeo.zip'] instanceof Uint8Array);
  assert.equal('EJS_biosUrl' in seen[0], false);
});

test('loadEmulator : sans rawFiles, EJS_externalFiles n\'est pas défini', async () => {
  const { win, doc } = fakeEnv();
  await loadEmulator(buildLaunchPlan({ system: amiga, game: { id: 'amiga/a', system: 'amiga', title: 'A', file: 'roms/amiga/a.adf' } }), { win, doc });
  assert.equal('EJS_externalFiles' in win, false);
});

test('loadEmulator : BIOS illisible donne une erreur claire et n\'injecte pas loader.js', async () => {
  const { win, doc, scripts } = fakeEnv();
  await assert.rejects(
    loadEmulator(buildLaunchPlan({ system: neogeo, game: mslug }), { win, doc, getBytes: async () => { throw new Error('HTTP 404'); } }),
    /bios\/neogeo\.zip.*illisible.*HTTP 404/);
  assert.equal(scripts.length, 0);
});

// --- T0 : options du cœur (puae choisit A500 et cherche kick34005.A500 si on ne lui impose pas le modèle) ---
test('buildLaunchPlan : coreOptions de la machine deviennent EJS_defaultOptions, et EmulatorJS ne les ignore pas (stockage local coupé)', () => {
  const plan = buildLaunchPlan({ system: amiga, game: { id: 'amiga/a', system: 'amiga', title: 'A', file: 'roms/amiga/a.adf' } });
  assert.deepEqual(plan.globals.EJS_defaultOptions, { puae_model: 'A1200' });
  assert.equal(plan.globals.EJS_disableLocalStorage, true, 'sinon EmulatorJS stable ignore EJS_defaultOptions au premier lancement');
});

test('buildLaunchPlan : sans coreOptions, ni EJS_defaultOptions ni EJS_disableLocalStorage (les réglages EmulatorJS restent mémorisés)', () => {
  const plan = buildLaunchPlan({ system: neogeo, game: mslug });
  assert.equal('EJS_defaultOptions' in plan.globals, false);
  assert.equal('EJS_disableLocalStorage' in plan.globals, false);
});
