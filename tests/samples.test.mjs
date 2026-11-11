// Tests de T22 : samples fbneo (arcade et Neo Geo). Plan de lancement, systems.json, validation, liste blanche du serveur, service worker, générateur.
// Les chemins de référence : hôte `bios/samples/<romset>.zip`, cœur `/fbneo/samples/<romset>.zip` (docs/architecture.md, section 3.3).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildLaunchPlan, checkPlanFiles, loadEmulator } from '../js/player/launcher.js';
import { validateSystems } from '../js/data.js';
import { createStaticServer, PROJECT_ROOT } from '../scripts/serve.mjs';
import { generateGames } from '../scripts/generate-games.mjs';

const systemsJson = JSON.parse(readFileSync(join(PROJECT_ROOT, 'systems.json'), 'utf8'));
const byId = (id) => systemsJson.systems.find((s) => s.id === id);
const arcade = byId('arcade');
const neogeo = byId('neogeo');
const amiga = byId('amiga');
const zaxxon = { id: 'arcade/zaxxon', system: 'arcade', title: 'Zaxxon', file: 'roms/arcade/zaxxon.zip', cover: null };
const mslug = { id: 'neogeo/mslug', system: 'neogeo', title: 'Metal Slug', file: 'roms/neogeo/mslug.zip', cover: null };
const SAMPLES_URL = 'bios/samples/zaxxon.zip';
const SAMPLES_FS_PATH = '/fbneo/samples/zaxxon.zip';

test('T22 systems.json : arcade et Neo Geo déclarent leurs samples, aucune autre machine', () => {
  for (const s of [arcade, neogeo]) assert.deepEqual(s.samples, { dir: 'samples', fsDir: '/fbneo/samples' }, s.id);
  for (const s of systemsJson.systems.filter((x) => !['arcade', 'neogeo'].includes(x.id))) assert.equal('samples' in s, false, s.id);
});

test('T22 plan de lancement de Zaxxon avec samples : le pack est posé tel quel au chemin exact du cœur', () => {
  const plan = buildLaunchPlan({ system: arcade, game: zaxxon });
  assert.ok(plan.rawFiles.some((r) => r.url === SAMPLES_URL && r.fsPath === SAMPLES_FS_PATH), JSON.stringify(plan.rawFiles));
  assert.deepEqual(plan.rawFiles.find((r) => r.url === SAMPLES_URL), { url: SAMPLES_URL, fsPath: SAMPLES_FS_PATH });
  assert.deepEqual(plan.files.find((f) => f.kind === 'samples'), { kind: 'samples', path: SAMPLES_URL, url: SAMPLES_URL, required: false });
  assert.equal(plan.globals.EJS_gameUrl, 'roms/arcade/zaxxon.zip', 'le jeu ne change pas');
  assert.equal('EJS_biosUrl' in plan.globals, false, 'les samples ne passent jamais par EJS_biosUrl (EmulatorJS les extrairait)');
});

test('T22 plan sans samples (fichier absent) : plus rien dans rawFiles ni files, aucune erreur, le reste est inchangé', async () => {
  const plan = buildLaunchPlan({ system: arcade, game: zaxxon });
  const head = async (url) => url !== SAMPLES_URL; // tout répond sauf les samples
  const { missing, plan: checked } = await checkPlanFiles(plan, head);
  assert.deepEqual(missing, []);
  assert.equal(checked.rawFiles.some((r) => r.url === SAMPLES_URL), false);
  assert.equal(checked.files.some((f) => f.kind === 'samples'), false);
  assert.deepEqual(checked.rawFiles.map((r) => r.fsPath), ['/neogeo.zip'], 'le BIOS facultatif posé comme avant');
});

test('T22 samples présents : le contrôle les garde et ils restent facultatifs (jamais « manquant »)', async () => {
  const { missing, plan } = await checkPlanFiles(buildLaunchPlan({ system: arcade, game: zaxxon }), async () => true);
  assert.deepEqual(missing, []);
  assert.ok(plan.rawFiles.some((r) => r.fsPath === SAMPLES_FS_PATH));
});

test('T22 loadEmulator télécharge les samples en octets bruts et les passe à EJS_externalFiles au chemin exact', async () => {
  const bytes = new Uint8Array([80, 75, 3, 4]);
  const win = {};
  const doc = { getElementById: () => ({}), createElement: () => ({}), head: { append: (s) => s.onload() } };
  await loadEmulator(buildLaunchPlan({ system: arcade, game: zaxxon }), { win, doc, getBytes: async (url) => (url === SAMPLES_URL ? bytes : new Uint8Array([1])) });
  assert.equal(win.EJS_externalFiles[SAMPLES_FS_PATH], bytes);
});

test('T22 Neo Geo : même mécanisme avec le romset du jeu, neogeo.zip toujours posé comme avant', () => {
  const plan = buildLaunchPlan({ system: neogeo, game: mslug });
  assert.deepEqual(plan.rawFiles, [
    { url: 'bios/neogeo.zip', fsPath: '/neogeo.zip' },
    { url: 'bios/samples/mslug.zip', fsPath: '/fbneo/samples/mslug.zip' },
  ]);
});

test('T22 le nom du romset vient du fichier du jeu (le dossier est ignoré)', () => {
  const game = { ...zaxxon, file: 'roms/arcade/sous-dossier/zaxxonb.zip' };
  assert.ok(buildLaunchPlan({ system: arcade, game }).rawFiles.some((r) => r.fsPath === '/fbneo/samples/zaxxonb.zip'));
});

test('T22 nom de fichier inhabituel (espace, accent, apostrophe) : pas de samples, le jeu se lance quand même', () => {
  for (const name of ['Le Roi d\'Or é', 'a b', 'x%2Fy', '..']) {
    const plan = buildLaunchPlan({ system: arcade, game: { ...zaxxon, file: `roms/arcade/${name}.zip` } });
    assert.equal(plan.files.some((f) => f.kind === 'samples'), false, name);
    assert.equal(plan.rawFiles.some((r) => r.fsPath.startsWith('/fbneo')), false, name);
  }
});

test('T22 Amiga et machines sans champ samples : plan inchangé', () => {
  const lemmings = { id: 'amiga/lemmings', system: 'amiga', title: 'Lemmings', file: 'roms/amiga/lemmings.adf', cover: null };
  const plan = buildLaunchPlan({ system: amiga, game: lemmings });
  assert.equal(plan.files.some((f) => f.kind === 'samples'), false);
  assert.deepEqual(plan.rawFiles, []);
  const nes = { id: 'nes', name: 'NES', emulatorjsCore: 'nes', bios: [] };
  assert.deepEqual(buildLaunchPlan({ system: nes, game: { ...zaxxon, file: 'roms/nes/zaxxon.nes' } }).rawFiles, []);
});

test('T22 validateSystems : samples facultatif, dir relatif sûr, fsDir absolu sans « .. »', () => {
  const sys = (samples) => ({ id: 'arcade', name: 'Arcade', order: 1, extensions: ['zip'], ...(samples === undefined ? {} : { samples }) });
  assert.doesNotThrow(() => validateSystems({ version: 1, systems: [sys(undefined)] }));
  assert.doesNotThrow(() => validateSystems({ version: 1, systems: [sys({ dir: 'samples', fsDir: '/fbneo/samples' })] }));
  for (const bad of [null, 'samples', [], {}, { dir: 'samples' }, { fsDir: '/x' }, { dir: '', fsDir: '/x' }, { dir: '../x', fsDir: '/x' },
    { dir: '/etc', fsDir: '/x' }, { dir: 'http://x', fsDir: '/x' }, { dir: 'samples', fsDir: 'fbneo' }, { dir: 'samples', fsDir: '/a/../b' }, { dir: 'samples', fsDir: '/' }]) {
    assert.throws(() => validateSystems({ version: 1, systems: [sys(bad)] }), /arcade.*samples/, JSON.stringify(bad));
  }
});

// --- Règle 6 et liste blanche ---
const swSandbox = { URL, decodeURIComponent, self: { addEventListener: () => {} } };
vm.runInNewContext(readFileSync(join(PROJECT_ROOT, 'sw.js'), 'utf8'), swSandbox);

test('T22 service worker (règle 6) : bios/samples/ n\'est jamais géré ni mis en cache', () => {
  for (const scope of ['http://localhost:8080/', 'https://hnaoai.github.io/Clone90/']) {
    for (const p of ['bios/samples/zaxxon.zip', 'bios/samples/', 'bios/samples/Le%20Roi.zip']) {
      assert.equal(swSandbox.self.Clone90SW.shouldHandle('GET', `${scope}${p}`, scope), false, p);
    }
  }
});

test('T22 serveur local : bios/samples/ est servi (liste blanche), un lien sortant du dossier reste refusé', async () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'clone90-samples-'));
  const site = join(sandbox, 'site');
  mkdirSync(join(site, 'bios', 'samples'), { recursive: true });
  writeFileSync(join(site, 'bios', 'samples', 'zaxxon.zip'), 'PACK');
  const server = createStaticServer({ root: site });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const ok = await fetch(`${base}/bios/samples/zaxxon.zip`);
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), 'PACK');
    assert.equal((await fetch(`${base}/bios/samples/zaxxon.zip`, { method: 'HEAD' })).status, 200, 'contrôle HEAD du lanceur');
    assert.equal((await fetch(`${base}/bios/samples/absent.zip`, { method: 'HEAD' })).status, 404);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    rmSync(sandbox, { recursive: true, force: true });
  }
});

test('T22 générateur : bios/samples/*.zip n\'est jamais listé comme jeu', async () => {
  const root = mkdtempSync(join(tmpdir(), 'clone90-gen-'));
  try {
    mkdirSync(join(root, 'bios', 'samples'), { recursive: true });
    mkdirSync(join(root, 'roms', 'arcade'), { recursive: true });
    writeFileSync(join(root, 'systems.json'), JSON.stringify(systemsJson));
    writeFileSync(join(root, 'bios', 'samples', 'zaxxon.zip'), 'x');
    writeFileSync(join(root, 'roms', 'arcade', 'zaxxon.zip'), 'x');
    const { games } = await generateGames({ root, now: new Date('2026-11-11T00:00:00Z') });
    assert.deepEqual(games.map((g) => g.file), ['roms/arcade/zaxxon.zip']);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
