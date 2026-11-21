// Tests T53 : BIOS dans la synchronisation Mac <-> téléphone (js/sync-bios.js, js/sync-plan.js, js/sync-client.js, scripts/sync-upload.mjs,
// scripts/sync-server.mjs) et dossiers des machines créés au démarrage du Mac (scripts/rom-folders.mjs). Sans réseau : faux Mac pour le
// téléphone, vrai serveur HTTPS sur 127.0.0.1 pour le Mac (sauté sans openssl).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { syncTargetPath, readManifest, uploadTargetPath, planUpload, describeUploadResult, maxUploadBytes, MAX_UPLOAD_BYTES, biosIndex,
  declaredBiosFiles } from '../js/sync-plan.js';
import { syncFromMac, sendGamesToMac, saveSyncPairing, readSyncPairing } from '../js/sync-client.js';
import { SEND_INFO } from '../js/ui/sync-section.js';
import { ensureRomFolders } from '../scripts/rom-folders.mjs';
import { createPairing } from '../scripts/sync-pairing.mjs';
import { ensureCertificates } from '../scripts/sync-cert.mjs';
import { createSyncHandler, startSyncServer, buildManifest } from '../scripts/sync-server.mjs';

const SYSTEMS = JSON.parse(readFileSync(new URL('../systems.json', import.meta.url), 'utf8')).systems;
const IDS = SYSTEMS.map((s) => s.id);
const BIOS = biosIndex(SYSTEMS);
const TOKEN = 'a'.repeat(64);
const hasOpenssl = (() => { try { execFileSync('openssl', ['version']); return true; } catch { return false; } })();

// --- Règles pures ---
test('T53 Mac -> téléphone : un BIOS du Mac est rangé sous son nom déclaré dans bios/, même avec une autre casse', () => {
  assert.equal(syncTargetPath('bios/SYSCARD3.PCE', IDS, BIOS), 'bios/syscard3.pce');
  assert.equal(syncTargetPath('bios/Kick40068.a1200', IDS, BIOS), 'bios/kick40068.A1200');
  assert.equal(syncTargetPath('bios/neogeo.zip', IDS, BIOS), 'bios/neogeo.zip');
  assert.equal(syncTargetPath('bios/inconnu.bin', IDS, BIOS), 'bios/inconnu.bin', 'BIOS non déclaré : gardé sous son nom');
  assert.equal(syncTargetPath('bios/SYSCARD3.PCE', IDS), 'bios/SYSCARD3.PCE', 'sans index : chemin inchangé (Mac)');
});

test('T53 Mac -> téléphone : un BIOS déclaré rangé avec les jeux sur le Mac (roms/neogeo/neogeo.zip) va dans bios/ sur le téléphone', () => {
  assert.equal(syncTargetPath('roms/neogeo/neogeo.zip', IDS, BIOS), 'bios/neogeo.zip');
  assert.equal(syncTargetPath('roms/pcenginecd/BIOS/SYSCARD3.PCE', IDS, BIOS), 'bios/syscard3.pce');
  assert.equal(syncTargetPath('roms/nes/neogeo.zip', IDS, BIOS), 'roms/nes/neogeo.zip', 'BIOS d\'une autre machine : un fichier comme un autre');
  assert.equal(syncTargetPath('roms/neogeo/mslug.zip', IDS, BIOS), 'roms/neogeo/mslug.zip');
  const files = [{ path: 'bios/neogeo.zip', size: 10, mtime: 1 }, { path: 'roms/neogeo/neogeo.zip', size: 11, mtime: 2 }, { path: 'roms/neogeo/mslug.zip', size: 3, mtime: 1 }];
  assert.deepEqual(readManifest({ files }, IDS, BIOS).map((e) => [e.path, e.target]),
    [['bios/neogeo.zip', 'bios/neogeo.zip'], ['roms/neogeo/mslug.zip', 'roms/neogeo/mslug.zip']], 'bios/ du Mac prioritaire, une seule copie');
});

test('T53 samples : bios/<sous-dossier>/<fichier> partagé tel quel ; jamais plus profond, caché ou ..', () => {
  assert.equal(syncTargetPath('bios/samples/mslug.zip', IDS, BIOS), 'bios/samples/mslug.zip');
  for (const p of ['bios/a/b/c.zip', 'bios/.cache', 'bios/samples/.x', 'bios/../x', 'bios/', 'bios']) assert.equal(syncTargetPath(p, IDS, BIOS), null, p);
});

test('T53 téléphone -> Mac : BIOS et samples acceptés (fin de « tout sauf le BIOS ») ; BIOS rangé avec les jeux toujours refusé comme jeu', () => {
  const declared = declaredBiosFiles(SYSTEMS);
  assert.equal(uploadTargetPath('bios/syscard3.pce', IDS, declared), 'bios/syscard3.pce');
  assert.equal(uploadTargetPath('bios/samples/mslug.zip', IDS, declared), 'bios/samples/mslug.zip');
  assert.equal(maxUploadBytes('bios/syscard3.pce'), MAX_UPLOAD_BYTES);
  assert.equal(maxUploadBytes('bios/fond.png'), MAX_UPLOAD_BYTES, 'un fichier de bios/ n\'est pas une pochette');
  for (const p of ['bios/a/b/c.zip', 'bios/.x', 'bios/../x', 'bios/', 'roms/neogeo/neogeo.zip', 'roms/clone90-logos/nes.svg']) assert.equal(uploadTargetPath(p, IDS, declared), null, p);
});

test('T53 plan d\'envoi : jeux, puis BIOS, puis pochettes ; BIOS déjà sur le Mac (casse près) gardé sans message ; BIOS venu du Mac jamais renvoyé', () => {
  const local = [{ path: 'roms/nes/A.png', size: 1 }, { path: 'bios/syscard3.pce', size: 5 }, { path: 'bios/gba_bios.bin', size: 2 },
    { path: 'roms/nes/A.nes', size: 9 }, { path: 'bios/neogeo.zip', size: 3 }, { path: 'bios/kick40068.A1200', size: 4 }];
  const remote = [{ target: 'bios/NEOGEO.ZIP' }];
  const plan = planUpload({ remote, local, synced: { 'bios/kick40068.A1200': { size: 4, mtime: 1 } }, systemIds: IDS, biosFiles: declaredBiosFiles(SYSTEMS) });
  assert.deepEqual(plan.send.map((e) => e.path), ['roms/nes/A.nes', 'bios/gba_bios.bin', 'bios/syscard3.pce', 'roms/nes/A.png']);
  assert.deepEqual(plan.send.map((e) => e.bios), [false, true, true, false]);
  assert.equal(plan.already, 0);
});

test('T53 message de fin de l\'envoi : BIOS comptés à part', () => {
  assert.equal(describeUploadResult({ sent: 1, bios: 2, covers: 1 }), 'Envoi : 1 jeu envoyé au Mac ; 2 BIOS envoyés au Mac ; 1 pochette envoyée au Mac.');
  assert.equal(describeUploadResult({ bios: 1 }), 'Envoi : 1 BIOS envoyé au Mac.');
  assert.equal(describeUploadResult({}), 'Envoi : le Mac a déjà tous les jeux, BIOS et pochettes de ce téléphone.');
  assert.doesNotMatch(SEND_INFO, /pas les BIOS/);
  assert.match(SEND_INFO, /BIOS/);
});

// --- Téléphone (faux Mac) ---
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const paired = (files = {}) => { const s = memoryStorage(); saveSyncPairing({ url: 'https://192.168.1.20:8443', token: TOKEN, files, lastSync: null }, s); return s; };
const blobOf = (n) => new Blob([new Uint8Array(n)]);
function fakeLibrary(initial = {}) {
  const files = new Map(Object.entries(initial));
  return { files, list: async () => [...files].map(([path, blob]) => ({ path, size: blob.size })), get: async (p) => files.get(p) ?? null,
    put: async (p, b) => { files.set(p, b); }, remove: async (p) => { files.delete(p); } };
}
function fakeMac({ files = [], uploads = true } = {}) {
  const disk = new Map(files.map((f) => [f.path, f]));
  const log = [];
  const fetchFn = async (url, init = {}) => {
    log.push(url);
    const u = new URL(url);
    if (u.pathname === '/sync/manifest') return { ok: true, status: 200, json: async () => ({ version: 1, uploads, files: [...disk.values()] }) };
    if (u.pathname === '/sync/file') return { ok: true, status: 200, blob: async () => blobOf(disk.get(u.searchParams.get('path')).size) };
    if (u.pathname === '/sync/upload') {
      const path = u.searchParams.get('path');
      if (disk.has(path)) return { ok: false, status: 409, json: async () => ({ error: 'exists' }) };
      disk.set(path, { path, size: init.body.size, mtime: 77 });
      return { ok: true, status: 201, json: async () => ({ path, size: init.body.size, mtime: 77 }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchFn, disk, log };
}

test('T53 synchronisation : les BIOS du Mac arrivent dans bios/ du téléphone, sous leur nom déclaré, là où le lecteur les cherche', async () => {
  const storage = paired();
  const library = fakeLibrary();
  const mac = fakeMac({ files: [{ path: 'bios/SYSCARD3.PCE', size: 4, mtime: 1 }, { path: 'roms/neogeo/neogeo.zip', size: 6, mtime: 1 },
    { path: 'roms/pcenginecd/Ys.cue', size: 2, mtime: 1 }, { path: 'bios/samples/mslug.zip', size: 3, mtime: 1 }] });
  const out = await syncFromMac({ library, systems: SYSTEMS, fetchFn: mac.fetchFn, storage, estimate: async () => ({}) });
  assert.deepEqual([...library.files.keys()].sort(), ['bios/neogeo.zip', 'bios/samples/mslug.zip', 'bios/syscard3.pce', 'roms/pcenginecd/Ys.cue']);
  assert.match(out.text, /4 fichiers copiés/);
  assert.ok(mac.log.some((u) => u.includes(`path=${encodeURIComponent('roms/neogeo/neogeo.zip')}`)), 'lu sur le Mac à son vrai chemin');
  const again = await syncFromMac({ library, systems: SYSTEMS, fetchFn: mac.fetchFn, storage, estimate: async () => ({}) });
  assert.equal(again.changed, false, 'seconde fois : rien de recopié');
});

test('T53 synchronisation : un BIOS mis par la personne sur le téléphone n\'est jamais remplacé ni effacé, même absent du Mac', async () => {
  const storage = paired();
  const library = fakeLibrary({ 'bios/syscard3.pce': blobOf(9), 'bios/neogeo.zip': blobOf(8) });
  const mac = fakeMac({ files: [{ path: 'bios/syscard3.pce', size: 4, mtime: 1 }] });
  await syncFromMac({ library, systems: SYSTEMS, fetchFn: mac.fetchFn, storage, estimate: async () => ({}) });
  assert.equal(library.files.get('bios/syscard3.pce').size, 9);
  assert.ok(library.files.has('bios/neogeo.zip'));
});

test('T53 envoi au Mac : les BIOS du téléphone partent après les jeux, comptés à part, puis suivent le Mac', async () => {
  const storage = paired();
  const library = fakeLibrary({ 'bios/syscard3.pce': blobOf(4), 'roms/pcenginecd/Ys.cue': blobOf(2), 'bios/neogeo.zip': blobOf(5) });
  const mac = fakeMac({ files: [{ path: 'bios/neogeo.zip', size: 5, mtime: 1 }] });
  const out = await sendGamesToMac({ library, systems: SYSTEMS, fetchFn: mac.fetchFn, storage });
  assert.equal(out.status, 'done');
  assert.equal(out.sent, 2);
  assert.equal(out.text, 'Envoi : 1 jeu envoyé au Mac ; 1 BIOS envoyé au Mac.');
  const sent = mac.log.filter((u) => u.includes('/sync/upload')).map((u) => new URL(u).searchParams.get('path'));
  assert.deepEqual(sent, ['roms/pcenginecd/Ys.cue', 'bios/syscard3.pce']);
  assert.deepEqual(readSyncPairing(storage).files['bios/syscard3.pce'], { size: 4, mtime: 77 });
});

// --- Mac : réception (vrai serveur HTTPS) ---
async function startMac() {
  const root = await mkdtemp(join(tmpdir(), 'clone90-t53-'));
  const romsDir = join(root, 'roms');
  const biosDir = join(root, 'bios');
  await mkdir(join(romsDir, 'neogeo'), { recursive: true });
  await mkdir(biosDir, { recursive: true });
  await writeFile(join(biosDir, 'NEOGEO.ZIP'), 'ORIGINAL');
  const tls = await ensureCertificates({ root, addresses: [], hostname: '' });
  const pairing = await createPairing({ root });
  await pairing.setPassword('mot-de-passe');
  await pairing.setAcceptUploads(true);
  const handler = createSyncHandler({ pairing, getDirs: async () => ({ romsDir, biosDir }), getSystemIds: async () => IDS, getCa: () => tls.ca,
    getBiosFiles: async () => declaredBiosFiles(SYSTEMS), getFreeBytes: async () => Infinity });
  const server = await startSyncServer({ tls, port: 0, host: '127.0.0.1', handler });
  const port = server.address().port;
  const request = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, path, method, headers, ca: tls.ca }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') }));
    });
    req.on('error', reject);
    req.end(body);
  });
  const { token } = (await request('/sync/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"mot-de-passe"}' })).body;
  const auth = { Authorization: `Bearer ${token}` };
  const upload = (path, body) => request(`/sync/upload?path=${encodeURIComponent(path)}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/octet-stream' }, body });
  return { romsDir, biosDir, request, upload, auth, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) };
}
const skip = !hasOpenssl && 'openssl absent';

test('T53 Mac : BIOS reçu du téléphone rangé dans le dossier des BIOS, puis proposé dans la liste du Mac', { skip }, async () => {
  const m = await startMac();
  try {
    const res = await m.upload('bios/syscard3.pce', 'CARD');
    assert.equal(res.status, 201);
    assert.equal(res.body.path, 'bios/syscard3.pce');
    assert.equal(await readFile(join(m.biosDir, 'syscard3.pce'), 'utf8'), 'CARD');
    const samples = await m.upload('bios/samples/mslug.zip', 'S');
    assert.equal(samples.status, 201, 'sous-dossier des samples créé');
    assert.equal(await readFile(join(m.biosDir, 'samples', 'mslug.zip'), 'utf8'), 'S');
    const list = (await m.request('/sync/manifest', { headers: m.auth })).body.files.map((f) => f.path);
    assert.ok(list.includes('bios/syscard3.pce') && list.includes('bios/samples/mslug.zip'));
    assert.deepEqual((await readdir(m.biosDir)).filter((n) => n.startsWith('.')), [], 'aucun fichier temporaire laissé');
  } finally { await m.close(); }
});

test('T53 Mac : un BIOS déjà présent n\'est jamais remplacé, même écrit avec une autre casse ; BIOS rangé avec les jeux refusé', { skip }, async () => {
  const m = await startMac();
  try {
    const res = await m.upload('bios/neogeo.zip', 'AUTRE');
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'exists');
    assert.equal(await readFile(join(m.biosDir, 'NEOGEO.ZIP'), 'utf8'), 'ORIGINAL');
    assert.deepEqual((await readdir(m.biosDir)).sort(), ['NEOGEO.ZIP']);
    const asGame = await m.upload('roms/neogeo/neogeo.zip', 'X');
    assert.equal(asGame.status, 400);
    assert.equal(asGame.body.error, 'bios');
  } finally { await m.close(); }
});

test('T53 Mac : la liste partagée contient bios/<sous-dossier>/ (samples), jamais plus profond', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clone90-t53m-'));
  await mkdir(join(root, 'bios', 'samples', 'trop'), { recursive: true });
  await mkdir(join(root, 'roms'), { recursive: true });
  await writeFile(join(root, 'bios', 'syscard3.pce'), 'C');
  await writeFile(join(root, 'bios', 'samples', 'mslug.zip'), 'S');
  await writeFile(join(root, 'bios', 'samples', 'trop', 'x.zip'), 'X');
  const files = await buildManifest({ romsDir: join(root, 'roms'), biosDir: join(root, 'bios'), systemIds: IDS });
  assert.deepEqual(files.map((f) => f.path), ['bios/samples/mslug.zip', 'bios/syscard3.pce']);
});

// --- Dossiers des machines ---
test('T53 dossiers : au démarrage, roms/<machine> créé pour chaque machine de systems.json qui n\'en a pas, en minuscules sans espace', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clone90-t53d-'));
  const romsDir = join(root, 'roms');
  const biosDir = join(root, 'bios');
  await mkdir(join(romsDir, 'Amiga'), { recursive: true });
  await writeFile(join(romsDir, 'Amiga', 'Leander.adf'), 'L');
  await writeFile(join(romsDir, 'nes'), 'un fichier, pas un dossier');
  const out = await ensureRomFolders({ romsDir, biosDir, systems: SYSTEMS });
  const expected = IDS.filter((id) => id !== 'amiga' && id !== 'nes');
  assert.deepEqual(out.created.sort(), [...expected].sort());
  assert.deepEqual(out.errors, []);
  for (const id of expected) assert.ok((await stat(join(romsDir, id))).isDirectory(), id);
  assert.ok(expected.includes('pcengine') && expected.includes('gba'));
  assert.ok((await stat(biosDir)).isDirectory(), 'dossier des BIOS créé s\'il manque');
  assert.deepEqual(await readdir(join(romsDir, 'Amiga')), ['Leander.adf'], 'dossier existant (autre casse) gardé tel quel, rien déplacé');
  assert.equal(await readFile(join(romsDir, 'nes'), 'utf8'), 'un fichier, pas un dossier', 'fichier du même nom jamais touché');
  assert.ok(!(await readdir(romsDir)).includes('amiga'));
  assert.deepEqual((await ensureRomFolders({ romsDir, biosDir, systems: SYSTEMS })).created, [], 'seconde fois : rien à créer');
});

test('T53 dossiers : une future machine de systems.json a aussi son dossier ; id mal formé ignoré ; dossier des jeux absent créé', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clone90-t53f-'));
  const romsDir = join(root, 'nouveau', 'roms');
  const out = await ensureRomFolders({ romsDir, systems: [{ id: 'dreamcast' }, { id: '../evil' }, { id: 'Mega Drive' }, { id: '' }, {}] });
  assert.deepEqual(out.created, ['dreamcast']);
  assert.deepEqual(await readdir(romsDir), ['dreamcast']);
});
