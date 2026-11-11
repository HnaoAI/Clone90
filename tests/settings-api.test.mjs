// Tests de l'API locale des dossiers (T25) : GET /api/settings, POST /api/settings/choose, chaque refus de sécurité, verrou, boîte du Mac factice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import { mkdtemp, mkdir, writeFile, readFile, copyFile, access } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { createStaticServer, isSettingsApiEnabled } from '../scripts/serve.mjs';
import { createSettingsApi, MAX_BODY_BYTES } from '../scripts/settings-api.mjs';
import { chooseFolderOnMac, buildAppleScript } from '../scripts/mac-folder-dialog.mjs';
import { PROJECT_ROOT } from '../scripts/project-root.mjs';

const tmp = (prefix) => mkdtemp(join(tmpdir(), `clone90-${prefix}-`));
const exists = (p) => access(p).then(() => true, () => false);

/** Serveur de test : racine temporaire, boîte du Mac et générateur factices (enregistrent leurs appels). */
async function setup({ enabled = true, choose = async () => null, regenerate } = {}) {
  const root = await tmp('api');
  await writeFile(join(root, 'index.html'), '<title>x</title>');
  const calls = { choose: [], regenerate: 0, applied: [] };
  let server;
  const api = createSettingsApi({
    root, enabled, getPort: () => server.address().port,
    applyFolders: (f) => { calls.applied.push(f); server.setFolders(f); },
    chooseFolder: async (kind) => { calls.choose.push(kind); return choose(kind); },
    regenerate: regenerate ?? (async () => { calls.regenerate += 1; return { exitCode: 0 }; }),
  });
  server = createStaticServer({ root, api });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  /** Requête brute (http.request), pour contrôler Host et les en-têtes. */
  const call = (method, path, { headers = {}, body, json } = {}) => new Promise((resolve, reject) => {
    const payload = json !== undefined ? JSON.stringify(json) : body;
    const h = { ...headers };
    if (json !== undefined && h['Content-Type'] === undefined) h['Content-Type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(payload);
  });
  const ok = { 'X-Clone90': '1' };
  const post = (kind, headers = ok) => call('POST', '/api/settings/choose', { headers, json: { kind } });
  return { root, port, calls, call, post, ok, close: () => server.close() };
}

test('API : désactivée (serveur ouvert au réseau ou autre système que macOS) : 404 partout, y compris POST', async () => {
  const t = await setup({ enabled: false });
  try {
    assert.equal((await t.call('GET', '/api/settings')).status, 404);
    assert.equal((await t.post('roms')).status, 404);
    assert.equal(t.calls.choose.length, 0);
  } finally { t.close(); }
});

test('API : isSettingsApiEnabled vrai seulement pour une écoute locale sous macOS', () => {
  assert.equal(isSettingsApiEnabled('127.0.0.1', 'darwin'), true);
  assert.equal(isSettingsApiEnabled('localhost', 'darwin'), true);
  assert.equal(isSettingsApiEnabled('0.0.0.0', 'darwin'), false);
  assert.equal(isSettingsApiEnabled('192.168.1.5', 'darwin'), false);
  assert.equal(isSettingsApiEnabled('127.0.0.1', 'linux'), false);
  assert.equal(isSettingsApiEnabled('127.0.0.1', 'win32'), false);
});

test('API GET /api/settings : dossiers par défaut, puis dossiers choisis', async () => {
  const t = await setup();
  try {
    const first = await t.call('GET', '/api/settings');
    assert.equal(first.status, 200);
    assert.match(first.headers['content-type'], /^application\/json/);
    assert.deepEqual(first.json(), { romsDir: join(t.root, 'roms'), biosDir: join(t.root, 'bios'), romsIsDefault: true, biosIsDefault: true });
    const ext = await tmp('ext');
    await writeFile(join(t.root, 'clone90.local.json'), JSON.stringify({ romsDir: ext }));
    const second = (await t.call('GET', '/api/settings')).json();
    assert.deepEqual([second.romsDir, second.romsIsDefault, second.biosIsDefault], [ext, false, true]);
  } finally { t.close(); }
});

test('API : toutes les réponses portent nosniff et no-store', async () => {
  const t = await setup();
  try {
    for (const r of [await t.call('GET', '/api/settings'), await t.post('bios-default'), await t.call('GET', '/api/inconnu'), await t.call('PUT', '/api/settings')]) {
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.equal(r.headers['cache-control'], 'no-store');
    }
  } finally { t.close(); }
});

test('API sécurité : en-tête Host autre que localhost:<port> ou 127.0.0.1:<port> refusé (403), en GET comme en POST', async () => {
  const t = await setup();
  try {
    for (const host of ['evil.com', 'evil.com:80', `evil.com:${t.port}`, 'localhost', 'localhost:1', `127.0.0.1.evil.com:${t.port}`, `localhost.evil.com:${t.port}`, '[::1]:1']) {
      assert.equal((await t.call('GET', '/api/settings', { headers: { Host: host } })).status, 403, `GET Host=${host}`);
      assert.equal((await t.call('POST', '/api/settings/choose', { headers: { Host: host, ...t.ok }, json: { kind: 'roms' } })).status, 403, `POST Host=${host}`);
    }
    assert.equal(t.calls.choose.length, 0);
    for (const host of [`localhost:${t.port}`, `127.0.0.1:${t.port}`]) {
      assert.equal((await t.call('GET', '/api/settings', { headers: { Host: host } })).status, 200, host);
    }
  } finally { t.close(); }
});

test('API sécurité : requête sans en-tête Host (HTTP/1.0 brut) refusée (403)', async () => {
  const t = await setup();
  try {
    const answer = await new Promise((resolve, reject) => {
      const socket = net.connect(t.port, '127.0.0.1', () => socket.write('GET /api/settings HTTP/1.0\r\n\r\n'));
      let text = '';
      socket.on('data', (c) => { text += c; });
      socket.on('end', () => resolve(text));
      socket.on('error', reject);
    });
    assert.match(answer, /^HTTP\/1\.1 403/);
  } finally { t.close(); }
});

test('API sécurité : Origin étrangère, "null" ou autre port refusée (403) ; Origin identique acceptée', async () => {
  const t = await setup();
  try {
    for (const origin of ['https://evil.com', 'null', `http://evil.com:${t.port}`, 'http://localhost:1', `https://localhost:${t.port}`, `http://127.0.0.1:${t.port}.evil.com`]) {
      assert.equal((await t.post('bios-default', { Origin: origin, ...t.ok })).status, 403, origin);
      assert.equal((await t.call('GET', '/api/settings', { headers: { Origin: origin } })).status, 403, `GET ${origin}`);
    }
    assert.equal((await t.post('bios-default', { Origin: `http://localhost:${t.port}` })).status, 200);
    assert.equal((await t.post('bios-default', { Origin: `http://127.0.0.1:${t.port}`, Host: `127.0.0.1:${t.port}` })).status, 200);
  } finally { t.close(); }
});

test('API sécurité : sans Origin, l\'en-tête X-Clone90: 1 est obligatoire pour POST', async () => {
  const t = await setup();
  try {
    assert.equal((await t.post('bios-default', {})).status, 403);
    assert.equal((await t.post('bios-default', { 'X-Clone90': '0' })).status, 403);
    assert.equal((await t.post('bios-default', { 'X-Clone90': 'oui' })).status, 403);
    assert.equal((await t.post('bios-default', { 'X-Clone90': '1' })).status, 200);
  } finally { t.close(); }
});

test('API sécurité : Content-Type application/json obligatoire (415)', async () => {
  const t = await setup();
  try {
    for (const ct of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data', 'application/jsonp', 'text/json']) {
      const r = await t.call('POST', '/api/settings/choose', { headers: { ...t.ok, 'Content-Type': ct }, body: '{"kind":"roms"}' });
      assert.equal(r.status, 415, ct);
    }
    const sans = await t.call('POST', '/api/settings/choose', { headers: t.ok, body: '{"kind":"bios-default"}' });
    assert.equal(sans.status, 415, 'sans Content-Type');
    const charset = await t.call('POST', '/api/settings/choose', { headers: { ...t.ok, 'Content-Type': 'application/json; charset=utf-8' }, body: '{"kind":"bios-default"}' });
    assert.equal(charset.status, 200);
    assert.equal(t.calls.choose.length, 0);
  } finally { t.close(); }
});

test('API sécurité : corps limité à 1 Ko (413), la boîte ne s\'ouvre pas', async () => {
  const t = await setup();
  try {
    assert.equal(MAX_BODY_BYTES, 1024);
    const big = JSON.stringify({ kind: 'roms', bourrage: 'x'.repeat(2000) });
    const r = await t.call('POST', '/api/settings/choose', { headers: { ...t.ok, 'Content-Type': 'application/json' }, body: big });
    assert.equal(r.status, 413);
    assert.equal(t.calls.choose.length, 0);
    const exact = JSON.stringify({ kind: 'bios-default' });
    assert.equal((await t.call('POST', '/api/settings/choose', { headers: { ...t.ok, 'Content-Type': 'application/json' }, body: exact })).status, 200);
  } finally { t.close(); }
});

test('API sécurité : corps invalide, type inconnu ou chemin fourni par le navigateur : 400, jamais de boîte', async () => {
  const t = await setup();
  try {
    const json = { ...t.ok, 'Content-Type': 'application/json' };
    for (const body of ['', 'pas du json', '[]', 'null', '"roms"', '{}', '{"kind":"autre"}', '{"kind":["roms"]}', '{"kind":null}', '{"kind":"ROMS"}',
      '{"kind":"roms","path":"/etc"}', '{"kind":"roms","romsDir":"/etc"}', '{"path":"/etc"}', '{"kind":"__proto__"}']) {
      const r = await t.call('POST', '/api/settings/choose', { headers: json, body });
      assert.equal(r.status, 400, body);
    }
    assert.equal(t.calls.choose.length, 0);
    assert.equal(await exists(join(t.root, 'clone90.local.json')), false);
  } finally { t.close(); }
});

test('API : méthodes et chemins inconnus (405, 404)', async () => {
  const t = await setup();
  try {
    assert.equal((await t.call('PUT', '/api/settings')).status, 405);
    assert.equal((await t.call('POST', '/api/settings', { headers: t.ok, json: { kind: 'roms' } })).status, 405);
    assert.equal((await t.call('GET', '/api/settings/choose')).status, 405);
    assert.equal((await t.call('DELETE', '/api/settings/choose', { headers: t.ok })).status, 405);
    assert.equal((await t.call('GET', '/api/autre')).status, 404);
    assert.equal((await t.call('GET', '/api/')).status, 404);
    assert.equal((await t.call('GET', '/api/settings/../../index.html')).status, 404);
  } finally { t.close(); }
});

test('API : choisir le dossier des ROMs écrit clone90.local.json, régénère games.json et applique le dossier sans redémarrage', async () => {
  const ext = await tmp('roms-ext');
  await mkdir(join(ext, 'amiga'));
  await writeFile(join(ext, 'amiga', 'jeu.adf'), 'ADF');
  const t = await setup({ choose: async () => ext });
  try {
    assert.equal((await t.call('GET', '/roms/amiga/jeu.adf')).status, 404, 'avant : dossier du projet');
    const r = await t.post('roms');
    assert.equal(r.status, 200);
    const body = r.json();
    assert.equal(body.status, 'ok');
    assert.equal(body.settings.romsDir, ext);
    assert.equal(body.settings.romsIsDefault, false);
    assert.deepEqual(t.calls.choose, ['roms']);
    assert.equal(t.calls.regenerate, 1);
    assert.deepEqual(JSON.parse(await readFile(join(t.root, 'clone90.local.json'), 'utf8')), { romsDir: ext });
    assert.deepEqual(t.calls.applied.at(-1), { romsDir: ext, biosDir: join(t.root, 'bios') });
    const served = await t.call('GET', '/roms/amiga/jeu.adf');
    assert.equal(served.status, 200);
    assert.equal(served.text, 'ADF');
  } finally { t.close(); }
});

test('API : choisir le dossier des BIOS conserve le dossier des ROMs déjà choisi', async () => {
  const romsExt = await tmp('roms-ext');
  const biosExt = await tmp('bios-ext');
  await writeFile(join(biosExt, 'kick.rom'), 'KICK');
  const t = await setup({ choose: async () => biosExt });
  try {
    await writeFile(join(t.root, 'clone90.local.json'), JSON.stringify({ romsDir: romsExt, autre: 1 }));
    assert.equal((await t.post('bios')).json().status, 'ok');
    assert.deepEqual(JSON.parse(await readFile(join(t.root, 'clone90.local.json'), 'utf8')), { romsDir: romsExt, autre: 1, biosDir: biosExt });
    assert.equal((await t.call('GET', '/bios/kick.rom')).text, 'KICK');
  } finally { t.close(); }
});

test('API : « BIOS du projet » retire biosDir sans ouvrir de boîte', async () => {
  const biosExt = await tmp('bios-ext');
  const t = await setup();
  try {
    await writeFile(join(t.root, 'clone90.local.json'), JSON.stringify({ biosDir: biosExt }));
    const r = await t.post('bios-default');
    assert.equal(r.json().status, 'ok');
    assert.equal(r.json().settings.biosIsDefault, true);
    assert.deepEqual(JSON.parse(await readFile(join(t.root, 'clone90.local.json'), 'utf8')), {});
    assert.equal(t.calls.choose.length, 0);
    assert.equal(t.calls.regenerate, 1);
  } finally { t.close(); }
});

test('API : annuler la boîte du Mac ne change rien (statut cancelled, rien d\'écrit, pas de régénération)', async () => {
  const t = await setup({ choose: async () => null });
  try {
    const r = await t.post('roms');
    assert.equal(r.status, 200);
    assert.equal(r.json().status, 'cancelled');
    assert.equal(await exists(join(t.root, 'clone90.local.json')), false);
    assert.equal(t.calls.regenerate, 0);
    assert.equal(t.calls.applied.length, 0);
  } finally { t.close(); }
});

test('API : dossiers trop larges, inexistants ou fichiers refusés avec un message français, rien d\'écrit', async () => {
  const fichier = join(await tmp('f'), 'fichier.txt');
  await writeFile(fichier, 'x');
  for (const [chemin, attendu] of [[homedir(), /trop large/], ['/', /trop large/], ['/Users', /trop large/], ['/Volumes', /trop large/],
    [join(await tmp('x'), 'absent'), /introuvable/], [fichier, /introuvable/], ['relatif/dossier', /introuvable/]]) {
    const t = await setup({ choose: async () => chemin });
    try {
      const body = (await t.post('bios')).json();
      assert.equal(body.status, 'refused', chemin);
      assert.match(body.message, attendu, chemin);
      assert.equal(await exists(join(t.root, 'clone90.local.json')), false, chemin);
      assert.equal(t.calls.regenerate, 0);
    } finally { t.close(); }
  }
});

test('API : un échec de la boîte du Mac donne le statut error, rien d\'écrit, et le verrou est relâché', async () => {
  let fail = true;
  const ext = await tmp('ext');
  const t = await setup({ choose: async () => { if (fail) throw new Error('osascript a échoué'); return ext; } });
  try {
    const r = await t.post('roms');
    assert.equal(r.status, 200);
    assert.equal(r.json().status, 'error');
    assert.match(r.json().message, /fenêtre de choix/);
    assert.ok(!r.text.includes('osascript'), 'pas de détail technique envoyé au navigateur');
    assert.equal(await exists(join(t.root, 'clone90.local.json')), false);
    fail = false;
    assert.equal((await t.post('roms')).json().status, 'ok', 'le verrou est relâché');
  } finally { t.close(); }
});

test('API : verrou, une seule boîte ouverte à la fois (409), relâché ensuite', async () => {
  let release;
  const ext = await tmp('ext');
  const t = await setup({ choose: () => new Promise((r) => { release = () => r(ext); }) });
  try {
    const first = t.post('roms');
    while (!release) await new Promise((r) => setTimeout(r, 5));
    const second = await t.post('bios');
    assert.equal(second.status, 409);
    assert.match(second.json().message, /déjà ouverte/);
    assert.equal((await t.post('bios-default')).status, 409, 'même sans boîte');
    assert.equal(t.calls.choose.length, 1);
    release();
    assert.equal((await first).json().status, 'ok');
    release = null;
    assert.equal((await t.post('bios-default')).status, 200);
  } finally { t.close(); }
});

test('API : clone90.local.json invalide n\'est pas écrasé (statut error)', async () => {
  const ext = await tmp('ext');
  const t = await setup({ choose: async () => ext });
  try {
    await writeFile(join(t.root, 'clone90.local.json'), '{ pas du json');
    const r = (await t.post('roms')).json();
    assert.equal(r.status, 'error');
    assert.match(r.message, /clone90\.local\.json/);
    assert.equal(await readFile(join(t.root, 'clone90.local.json'), 'utf8'), '{ pas du json');
  } finally { t.close(); }
});

test('API : échec de la régénération de games.json signalé (statut error)', async () => {
  const ext = await tmp('ext');
  const t = await setup({ choose: async () => ext, regenerate: async () => ({ exitCode: 1 }) });
  try {
    const r = (await t.post('roms')).json();
    assert.equal(r.status, 'error');
    assert.match(r.message, /liste des jeux/);
  } finally { t.close(); }
});

test('API : avec le vrai générateur, games.json est écrit d\'après le dossier choisi', async () => {
  const ext = await tmp('ext');
  await mkdir(join(ext, 'amiga'));
  await writeFile(join(ext, 'amiga', 'Mon Jeu.adf'), 'ADF');
  const root = await tmp('real');
  await copyFile(join(PROJECT_ROOT, 'systems.json'), join(root, 'systems.json'));
  const api = createSettingsApi({ root, enabled: true, getPort: () => server.address().port, applyFolders: (f) => server.setFolders(f), chooseFolder: async () => ext });
  const server = createStaticServer({ root, api });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const result = await new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port: server.address().port, method: 'POST', path: '/api/settings/choose',
        headers: { 'X-Clone90': '1', 'Content-Type': 'application/json' } }, (res) => {
        let text = ''; res.on('data', (c) => { text += c; }); res.on('end', () => resolve(JSON.parse(text)));
      });
      req.on('error', reject);
      req.end(JSON.stringify({ kind: 'roms' }));
    });
    assert.equal(result.status, 'ok');
    const games = JSON.parse(await readFile(join(root, 'games.json'), 'utf8')).games;
    assert.deepEqual(games.map((g) => g.title), ['Mon Jeu']);
  } finally { server.close(); }
});

// --- Boîte « choisir un dossier » du Mac (osascript factice) ---
const fakeExec = (outcome) => {
  const calls = [];
  const fn = async (file, args) => { calls.push([file, args]); if (outcome instanceof Error) throw outcome; return { stdout: outcome }; };
  fn.calls = calls;
  return fn;
};

test('Mac : le chemin choisi est lu sans « / » final, « / » conservé', async () => {
  assert.equal(await chooseFolderOnMac('roms', { execFile: fakeExec('/Users/moi/Jeux/\n') }), '/Users/moi/Jeux');
  assert.equal(await chooseFolderOnMac('bios', { execFile: fakeExec('/\n') }), '/');
});

test('Mac : la boîte a un texte fixe par type, passé à osascript sans interprétation du navigateur', async () => {
  const exec = fakeExec('/a/\n');
  await chooseFolderOnMac('roms', { execFile: exec });
  await chooseFolderOnMac('bios', { execFile: exec });
  assert.equal(exec.calls[0][0], 'osascript');
  assert.deepEqual(exec.calls[0][1], ['-e', buildAppleScript('roms')]);
  assert.match(exec.calls[0][1][1], /ROMs/);
  assert.match(exec.calls[1][1][1], /BIOS/);
  await assert.rejects(() => chooseFolderOnMac('"; do shell script "x', { execFile: exec }), /inconnu/);
});

test('Mac : annuler la boîte (code -128) renvoie null ; une autre erreur est relancée', async () => {
  const cancel = Object.assign(new Error('x'), { code: 1, stderr: 'execution error: User canceled. (-128)' });
  assert.equal(await chooseFolderOnMac('roms', { execFile: fakeExec(cancel) }), null);
  const autre = Object.assign(new Error('osascript introuvable'), { code: 'ENOENT', stderr: '' });
  await assert.rejects(() => chooseFolderOnMac('roms', { execFile: fakeExec(autre) }), /introuvable/);
});
