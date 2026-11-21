// Tests du partage Mac -> téléphone côté Mac (T43 ; T51 : appairage par mot de passe) : appairage (sync-pairing.mjs), certificats (sync-cert.mjs, vraie commande openssl),
// serveur HTTPS en lecture seule (sync-server.mjs, vrai serveur sur 127.0.0.1) et commande depuis Clone90 (sync-api.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';
import { execFile, execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, symlink, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPairing, readSyncState, SYNC_STATE_FILE } from '../scripts/sync-pairing.mjs';
import { ensureCertificates, serverAltNames, SYNC_CERT_DIR, CA_NAME } from '../scripts/sync-cert.mjs';
import { createSyncHandler, startSyncServer, buildManifest, HELP_PAGE, isCertificateRejection } from '../scripts/sync-server.mjs';
import { createSyncController } from '../scripts/sync-api.mjs';

const IDS = ['amiga', 'nes'];
const hasOpenssl = (() => { try { execFileSync('openssl', ['version']); return true; } catch { return false; } })();

async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'clone90-sync-'));
  await writeFile(join(root, 'systems.json'), JSON.stringify({ systems: IDS.map((id) => ({ id, name: id })) }));
  return root;
}

// --- Appairage (T51 : mot de passe choisi une fois sur le Mac) ---
test('T51 mot de passe : aucun mot de passe -> refus ; bon mot de passe -> jeton ; seules les empreintes sont gardées (fichier 0600)', async () => {
  const root = await tempRoot();
  const pairing = await createPairing({ root, makeToken: () => 'b'.repeat(64) });
  assert.equal(pairing.hasPassword, false);
  assert.deepEqual(await pairing.tryPassword('secret-du-mac'), { error: 'no-password' });
  assert.equal(await pairing.setPassword('secret-du-mac'), true);
  assert.equal(pairing.hasPassword, true);
  assert.deepEqual(await pairing.tryPassword('autre-chose'), { error: 'wrong-password', triesLeft: 4 });
  assert.deepEqual(await pairing.tryPassword('secret-du-mac'), { token: 'b'.repeat(64) });
  assert.deepEqual(await pairing.tryPassword('secret-du-mac'), { token: 'b'.repeat(64) }, 'plusieurs téléphones avec le même mot de passe');
  assert.equal(pairing.isValidToken('b'.repeat(64)), true);
  assert.equal(pairing.isValidToken('c'.repeat(64)), false);
  assert.equal(pairing.isValidToken('court'), false);
  const raw = await readFile(join(root, SYNC_STATE_FILE), 'utf8');
  assert.equal(raw.includes('b'.repeat(64)), false, 'jamais le jeton en clair');
  assert.equal(raw.includes('secret-du-mac'), false, 'jamais le mot de passe en clair');
  assert.match(JSON.parse(raw).password.hash, /^[0-9a-f]{64}$/);
  assert.equal((await stat(join(root, SYNC_STATE_FILE))).mode & 0o077, 0, 'lisible par la seule personne');
  const again = await createPairing({ root });
  assert.equal(again.isValidToken('b'.repeat(64)), true, 'gardé après relance');
  assert.equal(again.hasPassword, true);
  assert.ok((await again.tryPassword('secret-du-mac')).token, 'mot de passe gardé après relance');
});

test('T51 mot de passe : 5 mauvais essais -> blocage de 15 minutes, même avec le bon mot de passe ; puis de nouveau permis', async () => {
  const root = await tempRoot();
  let now = 0;
  const pairing = await createPairing({ root, now: () => now });
  await pairing.setPassword('bon-mot-de-passe');
  for (let i = 4; i >= 1; i -= 1) assert.deepEqual(await pairing.tryPassword('mauvais'), { error: 'wrong-password', triesLeft: i });
  assert.deepEqual(await pairing.tryPassword('mauvais'), { error: 'locked', retryAt: 15 * 60 * 1000 });
  assert.equal(pairing.lockedUntil, 15 * 60 * 1000);
  now = 14 * 60 * 1000;
  assert.deepEqual(await pairing.tryPassword('bon-mot-de-passe'), { error: 'locked', retryAt: 15 * 60 * 1000 });
  now = 15 * 60 * 1000 + 1;
  assert.equal(pairing.lockedUntil, null);
  assert.ok((await pairing.tryPassword('bon-mot-de-passe')).token);
});

test('T51 mot de passe : trop court, trop long ou caractère de contrôle refusé ; accents et espaces acceptés', async () => {
  const pairing = await createPairing({ root: await tempRoot() });
  for (const bad of ['', '12345', 'a'.repeat(129), 'abc\ndef', 42, null]) assert.equal(await pairing.setPassword(bad), false, String(bad));
  assert.equal(pairing.hasPassword, false);
  assert.equal(await pairing.setPassword('été à la mer'), true);
  assert.ok((await pairing.tryPassword('été à la mer')).token);
  assert.equal(await pairing.setPassword('😀'.repeat(128)), true, '128 caractères, même hors de l\'ASCII');
});

test('T51 mot de passe : le changer oublie les téléphones associés ; oublier les téléphones invalide leurs jetons ; état illisible -> partage arrêté', async () => {
  const root = await tempRoot();
  let n = 0;
  const pairing = await createPairing({ root, makeToken: () => String(n += 1).repeat(64).slice(0, 64) });
  await pairing.setEnabled(true);
  await pairing.setPassword('premier-mdp');
  const { token: first } = await pairing.tryPassword('premier-mdp');
  await pairing.setPassword('second-mdp');
  assert.equal(pairing.isValidToken(first), false, 'ancien téléphone oublié');
  assert.equal((await pairing.tryPassword('premier-mdp')).error, 'wrong-password');
  const { token: second } = await pairing.tryPassword('second-mdp');
  await pairing.forgetDevices();
  assert.equal(pairing.isValidToken(second), false);
  assert.equal(pairing.hasPassword, true, 'oublier les téléphones garde le mot de passe');
  assert.equal((await readSyncState(root)).enabled, true);
  await writeFile(join(root, SYNC_STATE_FILE), '{pas du json');
  assert.deepEqual(await readSyncState(root), { enabled: false, acceptUploads: false, password: null, devices: [] });
  await writeFile(join(root, SYNC_STATE_FILE), JSON.stringify({ enabled: true, password: { salt: 'zz', hash: 'x' }, devices: [] }));
  assert.equal((await readSyncState(root)).password, null, 'empreinte mal formée ignorée');
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
  const pairing = await createPairing({ root: folders.root });
  await pairing.setPassword('mot-de-passe');
  const handler = createSyncHandler({ pairing, getDirs: async () => folders, getSystemIds: async () => IDS, getCa: () => tls.ca, getName: () => 'mac-de-hicham.local' });
  const rejected = [];
  const server = await startSyncServer({ tls, port: 0, host: '127.0.0.1', handler, onCertificateRejected: (a) => rejected.push(a) });
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
    const res = await request('/sync/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: 'mot-de-passe' }) });
    return JSON.parse(res.text).token;
  };
  return { ...folders, tls, server, port, pairing, rejected, request, pair, close: () => new Promise((r) => { server.close(r); server.closeAllConnections(); }) };
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

test('T51 serveur : appairage par mot de passe, puis liste et fichiers avec le jeton', { skip: !hasOpenssl && 'openssl absent' }, async () => {
  const s = await startShared();
  try {
    const wrong = await s.request('/sync/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"password":"pas-le-bon"}' });
    assert.equal(wrong.status, 403);
    assert.match(JSON.parse(wrong.text).message, /Mot de passe incorrect\. Encore 4 essais/);
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

test('T51 serveur : mot de passe mal formé, ancien code à 6 chiffres ou corps trop grand refusés', { skip: !hasOpenssl && 'openssl absent' }, async () => {
  const s = await startShared();
  try {
    for (const body of ['{"password":"12"}', 'pas du json', '{"password":"mot-de-passe","x":1}', '{"code":"123456"}', JSON.stringify({ password: '1'.repeat(5000) })]) {
      assert.equal((await s.request('/sync/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, 400, body);
    }
    assert.equal((await s.request('/sync/pair')).status, 405);
  } finally { await s.close(); }
});

test('T51 serveur : /sync/hello sans jeton dit « Mac Clone90 » et son nom .local (CORS), sans rien d\'autre', { skip: !hasOpenssl && 'openssl absent' }, async () => {
  const s = await startShared();
  try {
    const hello = await s.request('/sync/hello', { headers: { Origin: 'https://hnaoai.github.io' } });
    assert.equal(hello.status, 200);
    assert.deepEqual(JSON.parse(hello.text), { app: 'clone90', version: 1, name: 'mac-de-hicham.local' });
    assert.equal(hello.headers['access-control-allow-origin'], 'https://hnaoai.github.io');
    assert.equal((await s.request('/sync/hello', { method: 'POST' })).status, 404);
  } finally { await s.close(); }
});

test('T51 serveur : 5 mauvais mots de passe -> 429 avec délai, même le bon est refusé ; aucun mot de passe sur le Mac -> 409 expliqué', { skip: !hasOpenssl && 'openssl absent' }, async () => {
  const s = await startShared();
  try {
    const post = (password) => s.request('/sync/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
    for (let i = 0; i < 4; i += 1) assert.equal((await post('mauvais-mdp')).status, 403);
    const locked = await post('mauvais-mdp');
    assert.equal(locked.status, 429);
    assert.match(JSON.parse(locked.text).message, /réessayez dans 15 min/);
    assert.equal(locked.headers['retry-after'], '900');
    assert.equal((await post('mot-de-passe')).status, 429);
  } finally { await s.close(); }
  const root = await tempRoot();
  const handler = createSyncHandler({ pairing: await createPairing({ root }), getDirs: async () => ({}), getSystemIds: async () => IDS, getCa: () => '' });
  const res = await new Promise((resolve) => {
    const listeners = {};
    const req = { method: 'POST', url: '/sync/pair', headers: {}, on: (t, f) => { listeners[t] = f; return req; } };
    handler(req, { writeHead(st) { this.status = st; }, end(text) { resolve({ status: this.status, body: JSON.parse(text) }); } });
    setImmediate(() => { listeners.data?.(Buffer.from('{"password":"mot-de-passe"}')); listeners.end?.(); });
  });
  assert.equal(res.status, 409);
  assert.match(res.body.message, /Choisir le mot de passe/);
});

test('T51 serveur : un appareil qui refuse le certificat (autorité non installée) est signalé avec son adresse', { skip: !hasOpenssl && 'openssl absent' }, async () => {
  const s = await startShared();
  try {
    // Comme Chrome sur Android sans l'autorité : openssl refuse le certificat et l'annonce au serveur (alerte TLS « unknown ca »).
    // Lancé sans bloquer (le serveur tourne dans ce même processus).
    await new Promise((resolve) => {
      const child = execFile('openssl', ['s_client', '-connect', `127.0.0.1:${s.port}`, '-verify_return_error', '-no-CAfile', '-no-CApath', '-no-CAstore'],
        { timeout: 10000 }, () => resolve());
      child.stdin.end();
    });
    await new Promise((r) => setTimeout(r, 300));
    assert.deepEqual(s.rejected, ['127.0.0.1']);
    assert.equal(isCertificateRejection(new Error('SSL alert number 48')), true);
    assert.equal(isCertificateRejection(Object.assign(new Error('x'), { code: 'ERR_SSL_SSLV3_ALERT_CERTIFICATE_UNKNOWN' })), true);
    assert.equal(isCertificateRejection(new Error('socket hang up')), false);
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

test('T51 commande : mot de passe choisi par POST api/sync/password {password}, jamais renvoyé ; état : nom .local, mot de passe choisi ; partage repris au lancement suivant', async () => {
  const { c, root } = await controller();
  const before = await call(c, 'GET', '/api/sync', LOCAL(8080));
  assert.equal(before.body.hasPassword, false);
  assert.equal(before.body.name, 'mac.local');
  assert.equal(before.body.certRejected, null);
  const set = await call(c, 'POST', '/api/sync/password', LOCAL(8080), '{"password":"mon-secret"}');
  assert.equal(set.status, 200);
  assert.equal(set.body.hasPassword, true);
  assert.equal(JSON.stringify(set.body).includes('mon-secret'), false, 'jamais renvoyé');
  assert.equal((await readSyncState(root)).password !== null, true);
  const short = await call(c, 'POST', '/api/sync/password', LOCAL(8080), '{"password":"123"}');
  assert.equal(short.status, 400);
  assert.match(short.body.message, /6 caractères au moins/);
  assert.equal((await call(c, 'POST', '/api/sync/password', LOCAL(8080), '{}')).status, 400);
  assert.equal((await call(c, 'POST', '/api/sync/password', LOCAL(8080), '{"password":"mon-secret","x":1}')).status, 400);
  assert.equal((await call(c, 'POST', '/api/sync/pair', LOCAL(8080))).status, 404, 'plus de code à 6 chiffres');
  await call(c, 'POST', '/api/sync/enable', LOCAL(8080));
  const started = [];
  const next = await createSyncController({ root, enabled: true, getPort: () => 8080, getAddresses: () => [], certificates: async () => ({ key: 'k', cert: 'c', ca: 'CA' }),
    start: async (o) => { started.push(o); return { close: (cb) => cb() }; } });
  await next.startIfEnabled();
  assert.equal(started.length, 1);
});

test('T51 commande : un téléphone qui refuse le certificat est signalé sur le Mac pendant 30 minutes', async () => {
  let now = 1000;
  const { c, started } = await controller({ now: () => now });
  await call(c, 'POST', '/api/sync/enable', LOCAL(8080));
  started[0].onCertificateRejected('192.168.1.40');
  assert.equal((await call(c, 'GET', '/api/sync', LOCAL(8080))).body.certRejected, '192.168.1.40');
  now += 31 * 60 * 1000;
  assert.equal((await call(c, 'GET', '/api/sync', LOCAL(8080))).body.certRejected, null);
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
