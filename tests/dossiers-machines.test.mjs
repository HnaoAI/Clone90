// Tests T56 : en-tête sans logo, et dossiers roms/<machine> créés dès qu'une machine est ajoutée (systems.json surveillé,
// revérification avant chaque games.json et avant la liste de synchronisation du téléphone). Dépend de scripts/rom-folders.mjs,
// scripts/sync-server.mjs, scripts/sync-api.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rename, readdir, readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFolderKeeper, watchSystemsFile, withFolderCheck } from '../scripts/rom-folders.mjs';
import { createSyncHandler } from '../scripts/sync-server.mjs';
import { createSyncController } from '../scripts/sync-api.mjs';
import { createPairing } from '../scripts/sync-pairing.mjs';

const read = (f) => readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const TOKEN = 'a'.repeat(64); // forme d'un vrai jeton (64 hexadécimaux)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
/** Attend qu'une condition devienne vraie (au plus `ms`). */
async function until(check, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (await check()) return true; await wait(25); }
  return false;
}

// --- CA1 : en-tête ---
test('T56 CA1 en-tête : plus de logo à gauche du titre « Clone90 », sur téléphone et ordinateur ; titre et version gardés', () => {
  const header = /<header class="app-header">([\s\S]*?)<\/header>/.exec(read('index.html'))?.[1] ?? '';
  assert.doesNotMatch(header, /<svg|header-mark|<img/, 'aucune image dans l\'en-tête');
  assert.match(header, /<h1 class="site-title">Clone<span class="site-title-90">90<\/span><\/h1>/);
  assert.match(header, /class="site-version"/);
  assert.doesNotMatch(read('css/base.css'), /header-mark|mark-green|mark-white/, 'plus de style pour le logo retiré');
});

// --- CA2 : systems.json surveillé ---
test('T56 CA2 Mac : une machine ajoutée à systems.json pendant que Clone90 tourne a son dossier roms/<id> sans relance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clone90-t56w-'));
  const romsDir = join(root, 'roms');
  const file = join(root, 'systems.json');
  await writeFile(file, JSON.stringify({ systems: [{ id: 'nes' }] }));
  const keeper = createFolderKeeper({ getDirs: async () => ({ romsDir }), getSystems: async () => JSON.parse(await readFile(file, 'utf8')).systems, log: () => {}, warn: () => {} });
  await keeper.prepare();
  assert.deepEqual(await readdir(romsDir), ['nes']);
  const watcher = watchSystemsFile({ file, onChange: () => keeper.prepare(), delayMs: 50 });
  try {
    // Écriture comme git : fichier temporaire puis renommage.
    await writeFile(join(root, 'systems.json.tmp'), JSON.stringify({ systems: [{ id: 'nes' }, { id: 'dreamcast' }] }));
    await rename(join(root, 'systems.json.tmp'), file);
    assert.ok(await until(async () => (await readdir(romsDir)).includes('dreamcast')), 'roms/dreamcast créé sans relance');
    await writeFile(file, JSON.stringify({ systems: [{ id: 'nes' }, { id: 'dreamcast' }, { id: 'saturn' }] }));
    assert.ok(await until(async () => (await readdir(romsDir)).includes('saturn')), 'deuxième changement aussi suivi');
  } finally {
    watcher.close();
  }
});

test('T56 CA2 surveillance : plusieurs écritures rapprochées ne lancent qu\'une vérification ; autre fichier ignoré ; close arrête tout', async () => {
  let listener = null;
  let closed = false;
  const watchFn = (dir, fn) => { listener = fn; return { close: () => { closed = true; }, on: () => {} }; };
  let calls = 0;
  const watcher = watchSystemsFile({ file: '/projet/systems.json', onChange: () => { calls += 1; }, watchFn, delayMs: 30 });
  listener('change', 'systems.json');
  listener('rename', 'systems.json');
  listener('change', 'systems.json');
  listener('change', 'games.json');
  await wait(80);
  assert.equal(calls, 1);
  listener('change', 'index.html');
  await wait(60);
  assert.equal(calls, 1, 'un autre fichier du dossier ne déclenche rien');
  listener('change', 'systems.json');
  watcher.close();
  await wait(60);
  assert.equal(calls, 1, 'après close, plus rien');
  assert.ok(closed);
});

test('T56 CA2 surveillance impossible (watch lève) : avertissement, Clone90 continue', () => {
  const warnings = [];
  const watcher = watchSystemsFile({ file: '/nulle/part/systems.json', onChange: () => {}, watchFn: () => { throw new Error('ENOENT'); }, warn: (m) => warnings.push(m) });
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /systems\.json/);
  watcher.close();
});

// --- CA3 : avant chaque games.json ---
test('T56 CA3 Mac : les dossiers sont revérifiés juste avant chaque nouvelle liste des jeux (games.json)', async () => {
  const order = [];
  const regenerate = withFolderCheck(async () => { order.push('dossiers'); }, async () => { order.push('games.json'); return { exitCode: 0 }; });
  assert.deepEqual(await regenerate(), { exitCode: 0 });
  assert.deepEqual(order, ['dossiers', 'games.json']);
});

test('T56 CA3 une erreur des dossiers n\'empêche jamais la liste des jeux', async () => {
  const regenerate = withFolderCheck(async () => { throw new Error('disque plein'); }, async () => ({ exitCode: 0 }));
  assert.deepEqual(await regenerate(), { exitCode: 0 });
});

// --- CA4 : synchronisation du téléphone ---
/** Appelle le gestionnaire de synchro avec une fausse requête GET, renvoie {status, body}. */
function call(handler, path, headers = {}) {
  return new Promise((resolve) => {
    const req = { method: 'GET', url: path, headers, on: () => req };
    handler(req, { writeHead(st) { this.status = st; }, end(text) { resolve({ status: this.status, body: text ? JSON.parse(text) : null }); } });
  });
}

test('T56 CA4 téléphone : avant la liste des fichiers (synchronisation), le Mac revérifie les dossiers ; une erreur ne bloque pas la synchro', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clone90-t56s-'));
  const romsDir = join(root, 'roms');
  await mkdir(romsDir, { recursive: true });
  const pairing = { isValidToken: (t) => t === TOKEN, tryPassword: async () => ({}), acceptUploads: false };
  let checks = 0;
  const base = { pairing, getDirs: async () => ({ romsDir, biosDir: join(root, 'bios') }), getSystemIds: async () => ['nes'], getCa: () => '' };
  const handler = createSyncHandler({ ...base, beforeManifest: async () => { checks += 1; } });
  const ok = await call(handler, '/sync/manifest', { authorization: `Bearer ${TOKEN}` });
  assert.equal(ok.status, 200);
  assert.equal(checks, 1);
  assert.equal((await call(handler, '/sync/manifest')).status, 401);
  assert.equal(checks, 1, 'pas de vérification pour un téléphone non associé');
  await call(handler, '/sync/hello');
  assert.equal(checks, 1, 'pas de vérification pour /sync/hello');
  const failing = createSyncHandler({ ...base, beforeManifest: async () => { throw new Error('disque plein'); } });
  assert.equal((await call(failing, '/sync/manifest', { authorization: `Bearer ${TOKEN}` })).status, 200);
});

test('T56 CA4 le partage du Mac branche la vérification des dossiers avant la liste envoyée au téléphone', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clone90-t56c-'));
  await writeFile(join(root, 'systems.json'), JSON.stringify({ systems: [{ id: 'nes', extensions: ['nes'] }] }));
  const pairing = { enabled: true, acceptUploads: false, isValidToken: (t) => t === TOKEN, tryPassword: async () => ({}) };
  let checks = 0;
  let handler = null;
  const sync = await createSyncController({ root, enabled: true, getPort: () => 0, pairing,
    certificates: async () => ({ key: '', cert: '', ca: '' }),
    start: async ({ handler: h }) => { handler = h; return { close: (cb) => cb?.(), address: () => ({ port: 8443 }), on: () => {}, setSecureContext: () => {} }; },
    prepareFolders: async () => { checks += 1; } });
  await sync.startIfEnabled();
  assert.ok(handler, 'serveur de partage démarré');
  assert.equal((await call(handler, '/sync/manifest', { authorization: `Bearer ${TOKEN}` })).status, 200);
  assert.equal(checks, 1);
  await sync.stop();
});

// --- CA5 : garanties de T53 ---
test('T56 CA5 vérification : systems.json illisible (en cours d\'écriture) = avertissement, rien de créé, nouvel essai possible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clone90-t56e-'));
  const romsDir = join(root, 'roms');
  const warnings = [];
  let text = '{"systems": [{"id": "ne';
  const keeper = createFolderKeeper({ getDirs: async () => ({ romsDir }), getSystems: async () => JSON.parse(text).systems, log: () => {}, warn: (m) => warnings.push(m) });
  const first = await keeper.prepare();
  assert.deepEqual(first.created, []);
  assert.equal(warnings.length, 1);
  text = '{"systems": [{"id": "nes"}]}';
  assert.deepEqual((await keeper.prepare()).created, ['nes']);
});

test('T56 CA5 vérification : seulement des dossiers vides, dossier d\'une autre casse gardé, dossiers passés en paramètre prioritaires', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clone90-t56k-'));
  const romsDir = join(root, 'roms');
  const other = join(root, 'autre');
  await mkdir(join(romsDir, 'Amiga'), { recursive: true });
  await writeFile(join(romsDir, 'Amiga', 'Leander.adf'), 'L');
  const logs = [];
  const keeper = createFolderKeeper({ getDirs: async () => ({ romsDir }), getSystems: async () => [{ id: 'amiga' }, { id: 'gba' }], log: (m) => logs.push(m), warn: () => {} });
  assert.deepEqual((await keeper.prepare()).created, ['gba']);
  assert.deepEqual((await readdir(romsDir)).sort(), ['Amiga', 'gba']);
  assert.deepEqual(await readdir(join(romsDir, 'Amiga')), ['Leander.adf']);
  assert.match(logs.join('\n'), /roms\/gba/);
  assert.deepEqual((await keeper.prepare()).created, [], 'rien à refaire');
  assert.deepEqual((await keeper.prepare({ romsDir: other })).created, ['amiga', 'gba'], 'nouveau dossier des jeux choisi');
});
