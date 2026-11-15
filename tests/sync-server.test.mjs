// Tests du partage Mac -> téléphone côté Mac (T43) : appairage (sync-pairing.mjs), certificats (sync-cert.mjs, vraie commande openssl),
// serveur HTTPS en lecture seule (sync-server.mjs, vrai serveur sur 127.0.0.1) et commande depuis Clone90 (sync-api.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPairing, readSyncState, SYNC_STATE_FILE } from '../scripts/sync-pairing.mjs';
import { ensureCertificates, serverAltNames, SYNC_CERT_DIR, CA_NAME } from '../scripts/sync-cert.mjs';
import { createSyncHandler, startSyncServer, buildManifest, HELP_PAGE } from '../scripts/sync-server.mjs';
import { createSyncController } from '../scripts/sync-api.mjs';

const IDS = ['amiga', 'nes'];
const hasOpenssl = (() => { try { execFileSync('openssl', ['version']); return true; } catch { return false; } })();

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'clone90-sync-'));
  await writeFile(join(root, 'systems.json'), JSON.stringify({ systems: IDS.map((id) => ({ id, name: id })) }));
  return root;
}

// --- Appairage ---
test('T43 appairage : aucun code sans demande sur le Mac ; bon code -> jeton, une seule fois ; seule l\'empreinte est gardée', async () => {
  const root = await tempRoot();
  const pairing = await createPairing({ root, makeCode: () => '123456', makeToken: () => 'b'.repeat(64) });
  assert.deepEqual(await pairing.tryCode('123456'), { error: 'no-code' });
  pairing.newCode();
  assert.deepEqual(await pairing.tryCode('654321'), { error: 'wrong-code' });
  assert.deepEqual(await pairing.tryCode('123456'), { token: 'b'.repeat(64) });
  assert.deepEqual(await pairing.tryCode('123456'), { error: 'no-code' }, 'code annulé après usage');
  assert.equal(pairing.isValidToken('b'.repeat(64)), true);
  assert.equal(pairing.isValidToken('c'.repeat(64)), false);
  assert.equal(pairing.isValidToken('court'), false);
  const raw = await readFile(join(root, SYNC_STATE_FILE), 'utf8');
  assert.equal(raw.includes('b'.repeat(64)), false, 'jamais le jeton en clair');
  assert.equal((await stat(join(root, SYNC_STATE_FILE))).mode & 0o077, 0, 'lisible par la seule personne');
  const again = await createPairing({ root });
  assert.equal(again.isValidToken('b'.repeat(64)), true, 'gardé après relance');
});

test('T43 appairage : 5 essais au plus puis code annulé ; code expiré au bout de 5 minutes', async () => {
  const root = await tempRoot();
  let now = 0;
  const pairing = await createPairing({ root, now: () => now, makeCode: () => '111111' });
  pairing.newCode();
  for (let i = 0; i < 5; i += 1) assert.deepEqual(await pairing.tryCode('000000'), { error: 'wrong-code' });
  assert.deepEqual(await pairing.tryCode('111111'), { error: 'no-code' });
  pairing.newCode();
  now = 5 * 60 * 1000 + 1;
  assert.equal(pairing.currentCode(), null);
  assert.deepEqual(await pairing.tryCode('111111'), { error: 'no-code' });
});

test('T43 appairage : oublier les téléphones invalide leurs jetons ; état illisible -> partage arrêté', async () => {
  const root = await tempRoot();
  const pairing = await createPairing({ root, makeCode: () => '222222', makeToken: () => 'd'.repeat(64) });
  await pairing.setEnabled(true);
  pairing.newCode();
  await pairing.tryCode('222222');
  await pairing.forgetDevices();
  assert.equal(pairing.isValidToken('d'.repeat(64)), false);
  assert.equal((await readSyncState(root)).enabled, true);
  await writeFile(join(root, SYNC_STATE_FILE), '{pas du json');
  assert.deepEqual(await readSyncState(root), { enabled: false, devices: [] });
});

// --- Certificats ---
test('T43 certificat : noms du serveur (adresses du Mac, localhost, nom .local)', () => {
  assert.equal(serverAltNames(['192.168.1.20', 'fe80::1'], 'Mac de Hicham.local'), 'IP:127.0.0.1,IP:192.168.1.20,DNS:localhost,DNS:mac-de-hicham.local');
  assert.equal(serverAltNames([], ''), 'IP:127.0.0.1,DNS:localhost');
});

test('T43 certificat : autorité limitée au réseau local, clés privées, certificat refait seulement si les adresses changent', { skip: !hasOpenssl && 'openssl absent' }, async () => {
  const root = await tempRoot();
  const first = await ensureCertificates({ root, addresses: ['192.168.1.20'], hostname: 'mac' });
  assert.equal(first.created, true);
  assert.match(first.cert, /BEGIN CERTIFICATE/);
  const caText = execFileSync('openssl', ['x509', '-noout', '-text', '-in', join(root, SYNC_CERT_DIR, 'ca.pem')], { encoding: 'utf8' });
  assert.match(caText, new RegExp(CA_NAME));
  assert.match(caText, /CA:TRUE/);
  assert.match(caText, /Name Constraints: critical/);
  assert.match(caText, /192\.168\.0\.0\/255\.255\.0\.0/);
  const serverText = execFileSync('openssl', ['x509', '-noout', '-text', '-in', join(root, SYNC_CERT_DIR, 'server.pem')], { encoding: 'utf8' });
  assert.match(serverText, /IP Address:192\.168\.1\.20/);
  assert.match(serverText, /TLS Web Server Authentication/);
  for (const key of ['ca.key', 'server.key']) assert.equal((await stat(join(root, SYNC_CERT_DIR, key))).mode & 0o077, 0, key);
  const same = await ensureCertificates({ root, addresses: ['192.168.1.20'], hostname: 'mac' });
  assert.equal(same.created, false);
  assert.equal(same.cert, first.cert);
  const moved = await ensureCertificates({ root, addresses: ['10.0.0.7'], hostname: 'mac' });
  assert.equal(moved.created, true);
  assert.equal(moved.ca, first.ca, 'même autorité : rien à réinstaller sur le téléphone');
});

// --- Serveur de partage ---
async function sharedFolders() {
  const root = await tempRoot();
  const roms = join(root, 'roms');
  const bios = join(root, 'bios');
  for (const d of ['nes', 'amiga/Leander', 'psx', 'clone90-logos']) await mkdir(join(roms, d), { recursive: true });
  await mkdir(bios, { recursive: true });
  await writeFile(join(roms, 'nes', 'Mario.nes'), 'NES-DATA');
  await writeFile(join(roms, 'nes', 'Mario.png'), 'PNG');
  await writeFile(join(roms, 'nes', '.DS_Store'), 'x');
  await writeFile(join(roms, 'amiga', 'Leander', 'Leander (Disk 1).adf'), 'ADF');
  await writeFile(join(roms, 'psx', 'jeu.bin'), 'BIN');
  await writeFile(join(roms, 'clone90-logos', 'nes.svg'), '<svg/>');
  await writeFile(join(bios, 'neogeo.zip'), 'ZIP');
  await writeFile(join(root, 'secret.txt'), 'SECRET');
  await symlink(join(root, 'secret.txt'), join(roms, 'nes', 'Lien.nes'));
  return { root, romsDir: roms, biosDir: bios };
}

test('T43 liste du Mac : jeux (un sous-dossier), pochettes, logos et BIOS ; jamais de fichier caché, de machine inconnue ni de lien vers l\'extérieur', async () => {
  const { romsDir, biosDir } = await sharedFolders();
  const paths = (await buildManifest({ romsDir, biosDir, systemIds: IDS })).map((f) => f.path);
  assert.deepEqual(paths, ['bios/neogeo.zip', 'roms/amiga/Leander/Leander (Disk 1).adf', 'roms/clone90-logos/nes.svg', 'roms/nes/Mario.nes', 'roms/nes/Mario.png']);
  const empty = await buildManifest({ romsDir: '/nexistepas', biosDir: '/nexistepas', systemIds: IDS });
  assert.deepEqual(empty, []);
});

/** Serveur de partage HTTPS sur 127.0.0.1 (port libre), avec un vrai certificat. */
async function startShared() {
  const folders = await sharedFolders();
  const tls = await ensureCertificates({ root: folders.root, addresses: [], hostname: '' });
  const pairing = await createPairing({ root: folders.root, makeCode: () => '424242' });
  const handler = createSyncHandler({ pairing, getDirs: async () => folders, getSystemIds: async () => IDS, getCa: () => tls.ca });
  const server = await startSyncServer({ tls, port: 0, host: '127.0.0.1', handler });
  const port = server.address().port;
  /** Requête HTTPS vérifiée avec l'autorité du Mac (comme le téléphone qui l'a installée). */
  const request = (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const req = https.request({ host: '127.0.0.1', port, path, method, headers, ca: tls.ca }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
  const pair = async () => {
    pairing.newCode();
    const res = await request('/sync/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: '424242' }) });
    return JSON.parse(res.text).token;
  };
  return { ...folders, tls, server, request, pair, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) };
}

test('T43 serveur : HTTPS vérifié par l\'autorité du Mac ; page d\'aide et certificat lisibles sans jeton', { skip: !hasOpenssl && 'openssl absent' }, async () => {
  const s = await startShared();
  try {
    const help = await s.request('/');
    assert.equal(help.status, 200);
    assert.equal(help.text, HELP_PAGE);
    assert.match(help.headers['content-security-policy'], /default-src 'none'/);
    const ca = await s.request('/clone90-ca.crt');
    assert.equal(ca.status, 200);
    assert.equal(ca.headers['content-type'], 'application/x-x509-ca-cert');
    assert.equal(ca.text, s.tls.ca);
    assert.doesNotMatch(ca.text, /PRIVATE KEY/);
  } finally { await s.close(); }
});

test('T43 serveur : liste et fichiers refusés sans jeton valide (401)', { skip: !hasOpenssl && 'openssl absent' }, async () => {
  const s = await startShared();
  try {
    for (const headers of [{}, { Authorization: 'Bearer nope' }, { Authorization: `Bearer ${'e'.repeat(64)}` }]) {
      assert.equal((await s.request('/sync/manifest', { headers })).status, 401);
      assert.equal((await s.request('/sync/file?path=roms%2Fnes%2FMario.nes', { headers })).status, 401);
    }
  } finally { await s.close(); }
});

test('T43 serveur : appairage par code, puis liste et fichiers avec le jeton', { skip: !hasOpenssl && 'openssl absent' }, async () => {
  const s = await startShared();
  try {
    const wrong = await s.request('/sync/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"code":"000000"}' });
    assert.equal(wrong.status, 403);
    assert.match(JSON.parse(wrong.text).message, /Aucun code en cours/);
    const token = await s.pair();
    assert.match(token, /^[0-9a-f]{64}$/);
    const auth = { Authorization: `Bearer ${token}` };
    const list = JSON.parse((await s.request('/sync/manifest', { headers: auth })).text);
    assert.ok(list.files.some((f) => f.path === 'roms/nes/Mario.nes' && f.size === 8 && Number.isFinite(f.mtime)));
    const file = await s.request(`/sync/file?path=${encodeURIComponent('roms/amiga/Leander/Leander (Disk 1).adf')}`, { headers: auth });
    assert.equal(file.status, 200);
    assert.equal(file.text, 'ADF');
    assert.equal(file.headers['content-type'], 'application/octet-stream');
  } finally { await s.close(); }
});

test('T43 serveur : jamais hors des dossiers partagés (.., fichier caché, autre machine, lien vers l\'extérieur, racine du projet)', { skip: !hasOpenssl && 'openssl absent' }, async () => {
  const s = await startShared();
  try {
    const auth = { Authorization: `Bearer ${await s.pair()}` };
    for (const p of ['roms/../secret.txt', 'roms/nes/../../secret.txt', 'secret.txt', 'roms/nes/.DS_Store', 'roms/psx/jeu.bin', 'roms/nes/Lien.nes',
      'systems.json', '/etc/passwd', 'roms/nes/Absent.nes', '']) {
      const res = await s.request(`/sync/file?path=${encodeURIComponent(p)}`, { headers: auth });
      assert.equal(res.status, 404, p);
      assert.doesNotMatch(res.text, /SECRET/);
    }
  } finally { await s.close(); }
});

test('T43 serveur : lecture seule (aucune écriture, aucune route de l\'API du Mac), CORS et réseau privé pour le téléphone', { skip: !hasOpenssl && 'openssl absent' }, async () => {
  const s = await startShared();
  try {
    const auth = { Authorization: `Bearer ${await s.pair()}` };
    for (const method of ['PUT', 'DELETE', 'POST']) assert.equal((await s.request('/sync/file?path=roms%2Fnes%2FMario.nes', { method, headers: auth })).status, 405, method);
    for (const path of ['/api/settings', '/api/sync/enable', '/index.html', '/games.json', '/sync/delete']) assert.equal((await s.request(path, { headers: auth })).status, 404, path);
    assert.equal(await readFile(join(s.romsDir, 'nes', 'Mario.nes'), 'utf8'), 'NES-DATA');
    const pre = await s.request('/sync/manifest', { method: 'OPTIONS', headers: { Origin: 'https://hnaoai.github.io', 'Access-Control-Request-Method': 'GET',
      'Access-Control-Request-Headers': 'authorization', 'Access-Control-Request-Private-Network': 'true' } });
    assert.equal(pre.status, 204);
    assert.equal(pre.headers['access-control-allow-origin'], 'https://hnaoai.github.io');
    assert.match(pre.headers['access-control-allow-headers'], /Authorization/);
    assert.equal(pre.headers['access-control-allow-private-network'], 'true');
    const get = await s.request('/sync/manifest', { headers: { ...auth, Origin: 'https://hnaoai.github.io' } });
    assert.equal(get.headers['access-control-allow-origin'], 'https://hnaoai.github.io');
    assert.equal(get.headers['x-content-type-options'], 'nosniff');
  } finally { await s.close(); }
});

test('T43 serveur : code mal formé ou corps trop grand refusés', { skip: !hasOpenssl && 'openssl absent' }, async () => {
  const s = await startShared();
  try {
    for (const body of ['{"code":"12"}', 'pas du json', '{"code":"123456","x":1}', JSON.stringify({ code: '1'.repeat(400) })]) {
      assert.equal((await s.request('/sync/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 400, body);
    }
    assert.equal((await s.request('/sync/pair')).status, 405);
  } finally { await s.close(); }
});

// --- Commande depuis Clone90 sur le Mac ---
const LOCAL = (port) => ({ host: `localhost:${port}`, origin: `http://localhost:${port}`, 'content-type': 'application/json' });
function call(controller, method, url, headers, body = '{}') {
  return new Promise((resolve) => {
    const listeners = {};
    const req = { method, url, headers, on: (t, f) => { listeners[t] = f; return req; }, destroy() {} };
    const res = { headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }); } };
    controller.handle(req, res).then(() => {});
    setImmediate(() => { if (method === 'POST') { listeners.data?.(body); listeners.end?.(); } });
  });
}

async function controller(extra = {}) {
  const root = await tempRoot();
  const started = [];
  const fakeServer = () => ({ close: (cb) => cb(), closeAllConnections() {}, setSecureContext() {} });
  const c = await createSyncController({ root, enabled: true, getPort: () => 8080, getAddresses: () => ['192.168.1.20'], getHostname: () => 'mac',
    certificates: async () => ({ key: 'k', cert: 'c', ca: 'CA', created: false }), start: async (o) => { started.push(o); return fakeServer(); }, ...extra });
  return { c, root, started };
}

test('T43 commande : rien d\'ouvert au réseau avant « Activer le partage » ; activé -> adresse https du Mac et état gardé', async () => {
  const { c, root, started } = await controller();
  await c.startIfEnabled();
  assert.equal(started.length, 0);
  const before = await call(c, 'GET', '/api/sync', LOCAL(8080));
  assert.equal(before.body.running, false);
  assert.deepEqual(before.body.addresses, []);
  const on = await call(c, 'POST', '/api/sync/enable', LOCAL(8080));
  assert.equal(on.status, 200);
  assert.equal(on.body.running, true);
  assert.deepEqual(on.body.addresses, ['https://192.168.1.20:8443']);
  assert.equal(started[0].port, 8443);
  assert.equal((await readSyncState(root)).enabled, true);
  const off = await call(c, 'POST', '/api/sync/disable', LOCAL(8080));
  assert.equal(off.body.running, false);
  assert.equal((await readSyncState(root)).enabled, false);
});

test('T43 commande : code seulement quand le partage est actif ; repris au lancement suivant s\'il était activé', async () => {
  const { c, root } = await controller();
  assert.equal((await call(c, 'POST', '/api/sync/pair', LOCAL(8080))).status, 409);
  await call(c, 'POST', '/api/sync/enable', LOCAL(8080));
  const pair = await call(c, 'POST', '/api/sync/pair', LOCAL(8080));
  assert.match(pair.body.code.value, /^\d{6}$/);
  const started = [];
  const next = await createSyncController({ root, enabled: true, getPort: () => 8080, getAddresses: () => [], certificates: async () => ({ key: 'k', cert: 'c', ca: 'CA' }),
    start: async (o) => { started.push(o); return { close: (cb) => cb() }; } });
  await next.startIfEnabled();
  assert.equal(started.length, 1);
});

test('T43 commande : mêmes contrôles que l\'API du Mac (hôte, origine, X-Clone90, corps {}) ; absente hors du Mac', async () => {
  const { c } = await controller();
  assert.equal((await call(c, 'POST', '/api/sync/enable', { ...LOCAL(8080), host: '192.168.1.20:8080' })).status, 403);
  assert.equal((await call(c, 'POST', '/api/sync/enable', { ...LOCAL(8080), origin: 'https://evil.example' })).status, 403);
  assert.equal((await call(c, 'POST', '/api/sync/enable', { host: 'localhost:8080', 'content-type': 'application/json' })).status, 403, 'sans Origin ni X-Clone90');
  assert.equal((await call(c, 'POST', '/api/sync/enable', LOCAL(8080), '{"port":1}')).status, 400);
  assert.equal((await call(c, 'GET', '/api/sync/enable', LOCAL(8080))).status, 405);
  const { c: off } = await controller({ enabled: false });
  assert.equal((await call(off, 'GET', '/api/sync', LOCAL(8080))).status, 404);
  assert.equal(c.owns('/api/sync'), true);
  assert.equal(c.owns('/api/settings'), false);
});

test('T43 commande : openssl absent ou port occupé -> message français, partage non activé', async () => {
  const { c: noCert, root } = await controller({ certificates: async () => { throw new Error('openssl: not found'); } });
  const r1 = await call(noCert, 'POST', '/api/sync/enable', LOCAL(8080));
  assert.equal(r1.body.running, false);
  assert.match(r1.body.error, /certificat/);
  assert.equal((await readSyncState(root)).enabled, false);
  const { c: busyPort } = await controller({ start: async () => { throw Object.assign(new Error('x'), { code: 'EADDRINUSE' }); } });
  assert.match((await call(busyPort, 'POST', '/api/sync/enable', LOCAL(8080))).body.error, /8443 est déjà utilisé/);
});
