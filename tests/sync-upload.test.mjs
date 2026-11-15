// Tests de l'envoi des jeux du téléphone vers le Mac (T44) : règles pures (js/sync-plan.js), téléphone (js/sync-client.js, rubrique de
// « Mes fichiers »), réception sur le Mac (scripts/sync-upload.mjs, vrai serveur HTTPS sur 127.0.0.1) et commande depuis Clone90 (sync-api.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, readdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadTargetPath, planUpload, describeUploadResult, planSync, MAX_UPLOAD_BYTES } from '../js/sync-plan.js';
import { sendGamesToMac, syncFromMac, saveSyncPairing, readSyncPairing, UPLOADS_OFF_TEXT } from '../js/sync-client.js';
import { renderSyncSection, SYNC_NAV, SEND_INFO } from '../js/ui/sync-section.js';
import { describeSyncStatus } from '../js/ui/sync-panel.js';
import { createPairing, readSyncState } from '../scripts/sync-pairing.mjs';
import { ensureCertificates } from '../scripts/sync-cert.mjs';
import { createSyncHandler, startSyncServer } from '../scripts/sync-server.mjs';
import { createSyncController } from '../scripts/sync-api.mjs';

const IDS = ['amiga', 'neogeo', 'nes'];
const SYSTEMS = IDS.map((id) => ({ id, name: id }));
const TOKEN = 'a'.repeat(64);
const hasOpenssl = (() => { try { execFileSync('openssl', ['version']); return true; } catch { return false; } })();

// --- Règles pures ---
test('T44 jeux acceptés par le Mac : seulement roms/<machine connue>/<fichier>, ni BIOS, ni logo, ni pochette, ni fichier caché', () => {
  assert.equal(uploadTargetPath('roms/nes/Mario.nes', IDS), 'roms/nes/Mario.nes');
  assert.equal(uploadTargetPath('roms/amiga/Leander (Disk 1).adf', IDS), 'roms/amiga/Leander (Disk 1).adf');
  for (const p of ['bios/neogeo.zip', 'roms/clone90-logos/nes.svg', 'roms/nes/Mario.png', 'roms/nes/Mario.JPG', 'roms/nes/.DS_Store', 'roms/psx/jeu.bin',
    'roms/nes/../x.nes', 'roms/../x', 'roms/nes/sous/x.nes', 'roms/nes/', 'roms/nes/a\\b.nes', 'games.json', '', null, `roms/nes/${'x'.repeat(300)}.nes`]) {
    assert.equal(uploadTargetPath(p, IDS), null, String(p));
  }
});

test('T44 plan d\'envoi : seulement les jeux mis sur le téléphone et absents du Mac ; même nom sur le Mac = non envoyé, signalé', () => {
  const local = [{ path: 'roms/nes/AMoi.nes', size: 30 }, { path: 'roms/nes/Petit.nes', size: 2 }, { path: 'roms/nes/Mario.nes', size: 9 },
    { path: 'roms/nes/VenuDuMac.nes', size: 4 }, { path: 'bios/neogeo.zip', size: 5 }, { path: 'roms/nes/AMoi.png', size: 3 },
    { path: 'roms/clone90-logos/nes.svg', size: 1 }, { path: 'roms/nes/Enorme.nes', size: MAX_UPLOAD_BYTES + 1 }];
  const remote = [{ target: 'roms/nes/Mario.nes' }, { target: 'roms/nes/VenuDuMac.nes' }];
  const plan = planUpload({ remote, local, synced: { 'roms/nes/VenuDuMac.nes': { size: 4, mtime: 1 } }, systemIds: IDS });
  assert.deepEqual(plan.send.map((e) => e.path), ['roms/nes/Petit.nes', 'roms/nes/AMoi.nes'], 'du plus petit au plus gros');
  assert.equal(plan.already, 1);
  assert.equal(plan.tooBig, 1);
  assert.deepEqual(planUpload({ remote: [], local: [], synced: {}, systemIds: IDS }), { send: [], already: 0, tooBig: 0 });
});

test('T44 message de fin de l\'envoi', () => {
  assert.equal(describeUploadResult({}), 'Envoi : le Mac a déjà tous les jeux de ce téléphone.');
  assert.equal(describeUploadResult({ sent: 2, already: 1 }), 'Envoi : 2 jeux envoyés au Mac ; 1 jeu non envoyé : un fichier du même nom est déjà sur le Mac.');
  assert.match(describeUploadResult({ sent: 1, noSpace: 2, failed: 1, tooBig: 1 }), /1 jeu envoyé.*1 jeu trop gros.*2 jeux non envoyés : plus assez de place sur le Mac.*1 jeu en échec/);
});

// --- Téléphone ---
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
/** Faux Mac : liste + réception (en mémoire). `answers` : réponse forcée par chemin. */
function fakeMac({ files = [], uploads = true, answers = {}, log = [] } = {}) {
  const disk = new Map(files.map((f) => [f.path, f]));
  const fetchFn = async (url, init = {}) => {
    log.push({ url, init });
    const u = new URL(url);
    if (u.pathname === '/sync/manifest') return { ok: true, status: 200, json: async () => ({ version: 1, uploads, files: [...disk.values()] }) };
    if (u.pathname === '/sync/upload') {
      const path = u.searchParams.get('path');
      if (answers[path]) return { ok: false, status: answers[path].status, json: async () => answers[path].body };
      if (disk.has(path)) return { ok: false, status: 409, json: async () => ({ error: 'exists' }) };
      disk.set(path, { path, size: init.body.size, mtime: 77 });
      return { ok: true, status: 201, json: async () => ({ path, size: init.body.size, mtime: 77 }) };
    }
    if (u.pathname === '/sync/file') return { ok: true, status: 200, blob: async () => blobOf(disk.get(u.searchParams.get('path')).size) };
    return { ok: false, status: 404, json: async () => ({}) };
  };
  return { fetchFn, disk, log };
}

test('T44 téléphone : envoie ses jeux absents du Mac, avec le jeton, seulement au Mac associé ; ni BIOS, ni pochettes, ni jeux venus du Mac', async () => {
  const storage = paired({ 'roms/nes/DuMac.nes': { size: 3, mtime: 1 } });
  const library = fakeLibrary({ 'roms/nes/AMoi.nes': blobOf(5), 'roms/nes/AMoi.png': blobOf(2), 'bios/neogeo.zip': blobOf(4), 'roms/nes/DuMac.nes': blobOf(3),
    'roms/nes/Mario.nes': blobOf(6) });
  const mac = fakeMac({ files: [{ path: 'roms/nes/DuMac.nes', size: 3, mtime: 1 }, { path: 'roms/nes/Mario.nes', size: 9, mtime: 1 }] });
  const progress = [];
  const out = await sendGamesToMac({ library, systems: SYSTEMS, fetchFn: mac.fetchFn, storage, onProgress: (p) => progress.push(p) });
  assert.equal(out.status, 'done');
  assert.equal(out.sent, 1);
  assert.equal(out.text, 'Envoi : 1 jeu envoyé au Mac ; 1 jeu non envoyé : un fichier du même nom est déjà sur le Mac.');
  const uploads = mac.log.filter((c) => c.url.includes('/sync/upload'));
  assert.deepEqual(uploads.map((c) => new URL(c.url).searchParams.get('path')), ['roms/nes/AMoi.nes']);
  assert.ok(mac.log.every((c) => c.url.startsWith('https://192.168.1.20:8443/') && c.init.headers.Authorization === `Bearer ${TOKEN}` && c.init.credentials === 'omit'));
  assert.equal(uploads[0].init.method, 'POST');
  assert.deepEqual(progress.at(-1), { done: 1, total: 1 });
});

test('T44 téléphone : un jeu envoyé devient géré par le Mac : supprimé sur le Mac, il est retiré du téléphone à la synchronisation suivante', async () => {
  const storage = paired();
  const library = fakeLibrary({ 'roms/nes/AMoi.nes': blobOf(5) });
  const mac = fakeMac();
  await sendGamesToMac({ library, systems: SYSTEMS, fetchFn: mac.fetchFn, storage });
  assert.deepEqual(readSyncPairing(storage).files['roms/nes/AMoi.nes'], { size: 5, mtime: 77 });
  const same = await syncFromMac({ library, systems: SYSTEMS, fetchFn: mac.fetchFn, storage, estimate: async () => ({}) });
  assert.equal(same.changed, false, 'rien à recopier : même taille et même date');
  mac.disk.delete('roms/nes/AMoi.nes');
  const after = await syncFromMac({ library, systems: SYSTEMS, fetchFn: mac.fetchFn, storage, estimate: async () => ({}) });
  assert.match(after.text, /1 fichier retiré/);
  assert.equal(library.files.has('roms/nes/AMoi.nes'), false);
  const again = await sendGamesToMac({ library: fakeLibrary({ 'roms/nes/AMoi.nes': blobOf(5) }), systems: SYSTEMS, fetchFn: fakeMac().fetchFn, storage });
  assert.equal(again.sent, 1, 'remis à la main sur le téléphone : de nouveau un jeu de la personne');
});

test('T44 téléphone : Mac qui n\'accepte pas les jeux -> rien n\'est envoyé, message qui dit quoi cocher sur le Mac', async () => {
  const mac = fakeMac({ uploads: false });
  const out = await sendGamesToMac({ library: fakeLibrary({ 'roms/nes/AMoi.nes': blobOf(5) }), systems: SYSTEMS, fetchFn: mac.fetchFn, storage: paired() });
  assert.equal(out.status, 'refused');
  assert.equal(out.text, UPLOADS_OFF_TEXT);
  assert.match(UPLOADS_OFF_TEXT, /Accepter les jeux du téléphone/);
  assert.equal(mac.log.some((c) => c.url.includes('/sync/upload')), false);
});

test('T44 téléphone : place manquante, fichier existant et refus du Mac comptés ; refus « réception coupée » arrête l\'envoi', async () => {
  const library = fakeLibrary({ 'roms/nes/A.nes': blobOf(1), 'roms/nes/B.nes': blobOf(2), 'roms/nes/C.nes': blobOf(3), 'roms/nes/D.nes': blobOf(4) });
  const mac = fakeMac({ answers: { 'roms/nes/A.nes': { status: 507, body: { error: 'no-space' } }, 'roms/nes/B.nes': { status: 409, body: { error: 'exists' } },
    'roms/nes/C.nes': { status: 403, body: { error: 'uploads-off' } } } });
  const out = await sendGamesToMac({ library, systems: SYSTEMS, fetchFn: mac.fetchFn, storage: paired() });
  assert.match(out.text, /1 jeu non envoyé : un fichier du même nom.*1 jeu non envoyé : plus assez de place sur le Mac.*1 jeu en échec/);
  assert.match(out.text, /Accepter les jeux du téléphone/);
  assert.equal(mac.log.some((c) => c.url.includes('D.nes')), false, 'arrêté après le refus');
});

test('T44 téléphone : non associé, Mac injoignable, plus associé -> message, rien envoyé ; ne lève jamais', async () => {
  const lib = fakeLibrary({ 'roms/nes/A.nes': blobOf(1) });
  assert.equal((await sendGamesToMac({ library: lib, systems: SYSTEMS, storage: memoryStorage(), fetchFn: async () => { throw new Error('x'); } })).status, 'unpaired');
  assert.match((await sendGamesToMac({ library: lib, systems: SYSTEMS, storage: paired(), fetchFn: async () => { throw new Error('réseau'); } })).text, /Mac injoignable/);
  const gone = await sendGamesToMac({ library: lib, systems: SYSTEMS, storage: paired(), fetchFn: async () => ({ ok: false, status: 401, json: async () => ({}) }) });
  assert.equal(gone.status, 'unpaired');
  assert.match(gone.text, /plus associé/);
  const broken = await sendGamesToMac({ library: { list: async () => { throw new Error('idb'); } }, systems: SYSTEMS, storage: paired(), fetchFn: fakeMac().fetchFn });
  assert.equal(broken.status, 'error');
});

test('T44 « Mes fichiers » : bouton « Envoyer mes jeux au Mac » (data-nav) seulement une fois associé, avec son explication', () => {
  const doc = fakeDoc();
  let sent = 0;
  const nodes = renderSyncSection({ pairing: { url: 'https://192.168.1.20:8443', lastSync: null }, onPair() {}, onSyncNow() {}, onSend: () => { sent += 1; }, onForget() {} }, doc);
  const button = findAll(nodes, (n) => n.dataset?.navId === SYNC_NAV.send)[0];
  assert.equal(button.textContent, 'Envoyer mes jeux au Mac');
  assert.equal(button.dataset.nav, '');
  button.listeners.click();
  assert.equal(sent, 1);
  assert.ok(findAll(nodes, (n) => n.textContent === SEND_INFO).length === 1);
  assert.match(SEND_INFO, /pas les BIOS/);
  const unpaired = renderSyncSection({ pairing: null, onPair() {}, onSyncNow() {}, onForget() {} }, fakeDoc());
  assert.equal(findAll(unpaired, (n) => n.dataset?.navId === SYNC_NAV.send).length, 0);
});

test('T44 panneau du Mac : dit si le Mac accepte les jeux du téléphone', () => {
  const base = { enabled: true, running: true, addresses: [], devices: 1 };
  assert.match(describeSyncStatus({ ...base, acceptUploads: false }).uploads, /n'accepte pas/);
  assert.match(describeSyncStatus({ ...base, acceptUploads: true }).uploads, /accepte les jeux/);
});

// --- Mac : réception ---
async function startMac({ accept = true, free = Infinity } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'clone90-upload-'));
  const romsDir = join(root, 'roms');
  const biosDir = join(root, 'bios');
  await mkdir(join(romsDir, 'nes'), { recursive: true });
  await mkdir(biosDir, { recursive: true });
  await writeFile(join(romsDir, 'nes', 'Mario.nes'), 'ORIGINAL');
  await mkdir(join(root, 'ailleurs'));
  await symlink(join(root, 'ailleurs'), join(romsDir, 'amiga'));
  const tls = await ensureCertificates({ root, addresses: [], hostname: '' });
  const pairing = await createPairing({ root, makeCode: () => '424242' });
  if (accept) await pairing.setAcceptUploads(true);
  let regenerated = 0;
  const handler = createSyncHandler({ pairing, getDirs: async () => ({ romsDir, biosDir }), getSystemIds: async () => IDS, getCa: () => tls.ca,
    onUploaded: () => { regenerated += 1; }, getFreeBytes: async () => free });
  const server = await startSyncServer({ tls, port: 0, host: '127.0.0.1', handler });
  const port = server.address().port;
  const request = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, path, method, headers, ca: tls.ca }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') }));
    });
    req.on('error', reject);
    req.end(body);
  });
  pairing.newCode();
  const { token } = (await request('/sync/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"code":"424242"}' })).body;
  const auth = { Authorization: `Bearer ${token}` };
  const upload = (path, body, headers = {}) => request(`/sync/upload?path=${encodeURIComponent(path)}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/octet-stream', ...headers }, body });
  return { root, romsDir, biosDir, pairing, port, ca: tls.ca, request, upload, auth, regenerated: () => regenerated, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) };
}

const skip = !hasOpenssl && 'openssl absent';

test('T44 Mac : jeu reçu rangé dans le dossier de la machine, liste des jeux refaite, présent ensuite dans la liste du Mac', { skip }, async () => {
  const m = await startMac();
  try {
    const res = await m.upload('roms/nes/Zelda.nes', 'ZELDA');
    assert.equal(res.status, 201);
    assert.deepEqual({ path: res.body.path, size: res.body.size }, { path: 'roms/nes/Zelda.nes', size: 5 });
    assert.equal(await readFile(join(m.romsDir, 'nes', 'Zelda.nes'), 'utf8'), 'ZELDA');
    assert.equal(m.regenerated(), 1);
    const list = (await m.request('/sync/manifest', { headers: m.auth })).body;
    assert.equal(list.uploads, true);
    assert.ok(list.files.some((f) => f.path === 'roms/nes/Zelda.nes' && f.mtime === res.body.mtime));
    const neo = await m.upload('roms/neogeo/kof98.zip', 'KOF');
    assert.equal(neo.status, 201, 'dossier de la machine créé s\'il manque');
    assert.deepEqual((await readdir(join(m.romsDir, 'nes'))).filter((n) => n.startsWith('.')), [], 'aucun fichier temporaire laissé');
  } finally { await m.close(); }
});

test('T44 Mac : rien n\'est reçu tant que « Accepter les jeux du téléphone » n\'est pas coché (éteint par défaut)', { skip }, async () => {
  const m = await startMac({ accept: false });
  try {
    const res = await m.upload('roms/nes/Zelda.nes', 'ZELDA');
    assert.equal(res.status, 403);
    assert.equal(res.body.error, 'uploads-off');
    assert.equal((await m.request('/sync/manifest', { headers: m.auth })).body.uploads, false);
    assert.deepEqual(await readdir(join(m.romsDir, 'nes')), ['Mario.nes']);
    assert.equal(m.regenerated(), 0);
  } finally { await m.close(); }
});

test('T44 Mac : jeton obligatoire (401) ; seule la méthode POST', { skip }, async () => {
  const m = await startMac();
  try {
    for (const headers of [{}, { Authorization: `Bearer ${'e'.repeat(64)}` }]) {
      assert.equal((await m.request('/sync/upload?path=roms%2Fnes%2FZ.nes', { method: 'POST', headers, body: 'Z' })).status, 401);
    }
    assert.equal((await m.request('/sync/upload?path=roms%2Fnes%2FZ.nes', { headers: m.auth })).status, 405);
    assert.deepEqual(await readdir(join(m.romsDir, 'nes')), ['Mario.nes']);
  } finally { await m.close(); }
});

test('T44 Mac : jamais d\'écrasement d\'un fichier existant', { skip }, async () => {
  const m = await startMac();
  try {
    const res = await m.upload('roms/nes/Mario.nes', 'PIRATE');
    assert.equal(res.status, 409);
    assert.equal(res.body.error, 'exists');
    assert.equal(await readFile(join(m.romsDir, 'nes', 'Mario.nes'), 'utf8'), 'ORIGINAL');
  } finally { await m.close(); }
});

test('T44 Mac : seulement des jeux de machines connues ; ni BIOS, logo, pochette, fichier caché, .., ni dossier lié hors du dossier des jeux', { skip }, async () => {
  const m = await startMac();
  try {
    for (const p of ['bios/neogeo.zip', 'roms/clone90-logos/nes.svg', 'roms/nes/Mario.png', 'roms/nes/.cache', 'roms/../evil.nes', 'roms/nes/../../evil.nes',
      'roms/psx/jeu.bin', 'roms/nes/sous/x.nes', 'systems.json', '']) {
      const res = await m.upload(p, 'X');
      assert.equal(res.status, 400, p);
    }
    const linked = await m.upload('roms/amiga/jeu.adf', 'X');
    assert.equal(linked.status, 409, 'dossier de machine qui est un lien vers ailleurs');
    assert.deepEqual(await readdir(join(m.root, 'ailleurs')), []);
    assert.deepEqual(await readdir(m.biosDir), []);
    assert.equal((await readdir(m.root)).includes('evil.nes'), false);
  } finally { await m.close(); }
});

test('T44 Mac : taille obligatoire et limitée à 1 Go ; place libre vérifiée', { skip }, async () => {
  const m = await startMac();
  try {
    const tooBig = await m.upload('roms/nes/Gros.nes', undefined, { 'Content-Length': String(MAX_UPLOAD_BYTES + 1) });
    assert.equal(tooBig.status, 413);
    const chunked = await m.upload('roms/nes/Sans.nes', undefined, { 'Transfer-Encoding': 'chunked' });
    assert.equal(chunked.status, 411);
  } finally { await m.close(); }
  const full = await startMac({ free: 10 });
  try {
    const res = await full.upload('roms/nes/Zelda.nes', 'ZELDA');
    assert.equal(res.status, 507);
    assert.equal(res.body.error, 'no-space');
    assert.deepEqual(await readdir(join(full.romsDir, 'nes')), ['Mario.nes']);
  } finally { await full.close(); }
});

test('T44 Mac : envoi coupé avant la fin -> aucun jeu gardé, aucun fichier temporaire', { skip }, async () => {
  const m = await startMac();
  try {
    await new Promise((resolve) => {
      const req = https.request({ host: '127.0.0.1', port: m.port, method: 'POST', ca: m.ca, path: '/sync/upload?path=roms%2Fnes%2FCoupe.nes',
        headers: { ...m.auth, 'Content-Length': '100' } });
      req.on('error', () => resolve());
      req.write('0123456789', () => setTimeout(() => { req.destroy(); setTimeout(resolve, 150); }, 50));
    });
    // Le Mac voit la coupure un peu après le téléphone : on attend au plus 3 s que le fichier temporaire soit effacé.
    for (let i = 0; i < 30 && (await readdir(join(m.romsDir, 'nes'))).length > 1; i += 1) await new Promise((r) => setTimeout(r, 100));
    assert.deepEqual(await readdir(join(m.romsDir, 'nes')), ['Mario.nes']);
    assert.equal(m.regenerated(), 0);
    assert.equal((await m.upload('roms/nes/Coupe.nes', 'ENTIER')).status, 201, 'le serveur accepte de nouveau un envoi');
  } finally { await m.close(); }
});

test('T44 commande du Mac : « Accepter les jeux du téléphone » s\'allume et s\'éteint, gardé dans l\'état, éteint par défaut', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clone90-upload-api-'));
  await writeFile(join(root, 'systems.json'), JSON.stringify({ systems: SYSTEMS }));
  const c = await createSyncController({ root, enabled: true, getPort: () => 8080, getAddresses: () => [], certificates: async () => ({ key: 'k', cert: 'c', ca: 'CA' }),
    start: async () => ({ close: (cb) => cb() }), regenerate: async () => {} });
  const LOCAL = { host: 'localhost:8080', origin: 'http://localhost:8080', 'content-type': 'application/json' };
  const call = (method, url) => new Promise((resolve) => {
    const listeners = {};
    const req = { method, url, headers: LOCAL, on: (t, f) => { listeners[t] = f; return req; }, destroy() {} };
    const res = { headersSent: false, writeHead(status) { this.status = status; }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }); } };
    c.handle(req, res);
    setImmediate(() => { if (method === 'POST') { listeners.data?.('{}'); listeners.end?.(); } });
  });
  assert.equal((await call('GET', '/api/sync')).body.acceptUploads, false);
  assert.equal((await call('POST', '/api/sync/uploads-on')).body.acceptUploads, true);
  assert.equal((await readSyncState(root)).acceptUploads, true);
  assert.equal((await call('POST', '/api/sync/uploads-off')).body.acceptUploads, false);
  assert.equal((await readSyncState(root)).acceptUploads, false);
  assert.equal((await call('GET', '/api/sync/uploads-on')).status, 405);
});

// --- Document factice (comme tests/sync-plan.test.mjs) ---
class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...items) { for (const i of items) this.children.push(i); }
  replaceChildren(...items) { this.children = [...items]; }
  addEventListener(t, f) { this.listeners[t] = f; }
}
function fakeDoc() {
  return { createTextNode: (s) => ({ text: s }), createElement: (t) => new FakeNode(t) };
}
function findAll(nodes, pred, out = []) {
  for (const n of nodes) { if (!n || typeof n !== 'object') continue; if (pred(n)) out.push(n); if (n.children) findAll(n.children, pred, out); }
  return out;
}
