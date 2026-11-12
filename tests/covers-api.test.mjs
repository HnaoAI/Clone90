// Tests de l'API locale des pochettes (T28) : GET /api/covers, POST /api/covers/download. Mêmes contrôles de sécurité que T25 ; téléchargement factice, aucun réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticServer } from '../scripts/serve.mjs';
import { createSettingsApi } from '../scripts/settings-api.mjs';

/** Serveur de test. `downloadCovers` factice : enregistre ses appels ; `gate` permet de la garder en cours. */
async function setup({ enabled = true, downloadCovers, choose = async () => null } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'clone90-capi-'));
  await writeFile(join(root, 'index.html'), '<title>x</title>');
  const calls = { download: 0, choose: 0 };
  let server;
  const api = createSettingsApi({
    root, enabled, getPort: () => server.address().port, applyFolders: () => {},
    chooseFolder: async () => { calls.choose += 1; return choose(); },
    regenerate: async () => ({ exitCode: 0 }),
    downloadCovers: async (options) => { calls.download += 1; return downloadCovers(options); },
  });
  server = createStaticServer({ root, api });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = (method, path, { headers = {}, body, json } = {}) => new Promise((resolve, reject) => {
    const h = { ...headers };
    if (json !== undefined && h['Content-Type'] === undefined) h['Content-Type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(json !== undefined ? JSON.stringify(json) : body);
  });
  const ok = { 'X-Clone90': '1' };
  const start = (headers = ok, json = {}) => call('POST', '/api/covers/download', { headers, json });
  return { port, calls, call, start, ok, close: () => server.close() };
}
const summaryOf = (found = 0) => ({ exitCode: 0, dryRun: false, summary: { found: new Array(found).fill({}), alreadyHave: 1, notFound: [], ambiguous: [], failed: [], listingErrors: [], noRepo: [] } });
const until = async (fn) => { for (let i = 0; i < 200; i += 1) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 5)); } throw new Error('délai dépassé'); };

test('API pochettes : désactivée (réseau local ou autre système que macOS) : 404 en GET comme en POST, rien lancé', async () => {
  const t = await setup({ enabled: false, downloadCovers: async () => summaryOf() });
  try {
    assert.equal((await t.call('GET', '/api/covers')).status, 404);
    assert.equal((await t.start()).status, 404);
    assert.equal(t.calls.download, 0);
  } finally { t.close(); }
});

test('API pochettes : GET /api/covers = inactif au départ ; POST répond 202 tout de suite, puis l\'état passe à terminé avec le résumé en français', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const t = await setup({ downloadCovers: async ({ onProgress }) => { onProgress({ phase: 'downloading', system: 'Amiga', done: 3, total: 10 }); await gate; return summaryOf(2); } });
  try {
    assert.deepEqual((await t.call('GET', '/api/covers')).json(), { status: 'idle' });
    const started = await t.start();
    assert.equal(started.status, 202);
    assert.deepEqual(started.json(), { status: 'started' });
    const running = await until(async () => { const j = (await t.call('GET', '/api/covers')).json(); return j.progress?.done === 3 && j; });
    assert.deepEqual(running, { id: 1, status: 'running', progress: { phase: 'downloading', system: 'Amiga', done: 3, total: 10 } });
    release();
    const done = await until(async () => { const j = (await t.call('GET', '/api/covers')).json(); return j.status === 'done' && j; });
    assert.equal(done.found, 2);
    assert.equal(done.id, 1);
    assert.match(done.lines.join('\n'), /Pochettes téléchargées : 2/);
    assert.match(done.lines.join('\n'), /Déjà présentes : 1/);
  } finally { t.close(); }
});

test('API pochettes : un seul téléchargement à la fois (409), et pas de boîte de choix de dossier pendant ce temps (verrou partagé)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const t = await setup({ downloadCovers: async () => { await gate; return summaryOf(); } });
  try {
    assert.equal((await t.start()).status, 202);
    const second = await t.start();
    assert.equal(second.status, 409);
    assert.match(second.json().message, /pochettes/);
    const choose = await t.call('POST', '/api/settings/choose', { headers: t.ok, json: { kind: 'roms' } });
    assert.equal(choose.status, 409);
    assert.equal(t.calls.choose, 0);
    assert.equal(t.calls.download, 1);
    release();
    await until(async () => (await t.call('GET', '/api/covers')).json().status === 'done');
    assert.equal((await t.start()).status, 202, 'après la fin, un nouveau téléchargement est possible');
  } finally { t.close(); }
});

test('API pochettes : une erreur du téléchargement donne un message clair, sans détail technique, et libère le verrou', async () => {
  const t = await setup({ downloadCovers: async () => { throw new Error('ECONNRESET /Users/hicham/secret'); } });
  try {
    await t.start();
    const state = await until(async () => { const j = (await t.call('GET', '/api/covers')).json(); return j.status === 'error' && j; });
    assert.match(state.message, /connexion/);
    assert.ok(!JSON.stringify(state).includes('hicham'));
    assert.equal((await t.start()).status, 202);
  } finally { t.close(); }
});

test('API pochettes : games.json non régénéré (code de sortie 1) = erreur signalée', async () => {
  const t = await setup({ downloadCovers: async () => ({ ...summaryOf(1), exitCode: 1 }) });
  try {
    await t.start();
    const state = await until(async () => { const j = (await t.call('GET', '/api/covers')).json(); return j.status === 'error' && j; });
    assert.match(state.message, /liste des jeux/);
  } finally { t.close(); }
});

test('API pochettes sécurité : Host étranger, Origin étrangère, X-Clone90 manquant : 403 et rien lancé', async () => {
  const t = await setup({ downloadCovers: async () => summaryOf() });
  try {
    for (const host of ['evil.com', `evil.com:${t.port}`, 'localhost']) {
      assert.equal((await t.call('GET', '/api/covers', { headers: { Host: host } })).status, 403, host);
      assert.equal((await t.call('POST', '/api/covers/download', { headers: { Host: host, ...t.ok }, json: {} })).status, 403, host);
    }
    for (const origin of ['https://evil.com', 'null', `http://evil.com:${t.port}`]) {
      assert.equal((await t.start({ Origin: origin, ...t.ok })).status, 403, origin);
    }
    assert.equal((await t.start({})).status, 403);
    assert.equal((await t.start({ 'Sec-Fetch-Site': 'cross-site', ...t.ok })).status, 403);
    assert.equal(t.calls.download, 0);
    assert.equal((await t.start({ Origin: `http://localhost:${t.port}` })).status, 202);
  } finally { t.close(); }
});

test('API pochettes sécurité : JSON obligatoire (415), corps vide d\'objet seulement (aucun paramètre accepté : 400), corps de plus de 1 Ko (413), mauvaise méthode (405)', async () => {
  const t = await setup({ downloadCovers: async () => summaryOf() });
  try {
    assert.equal((await t.call('POST', '/api/covers/download', { headers: { ...t.ok, 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    for (const body of ['', 'pas du json', '[]', 'null', '{"repo":"x"}', '{"path":"/etc"}', '{"kind":"roms"}']) {
      assert.equal((await t.call('POST', '/api/covers/download', { headers: { ...t.ok, 'Content-Type': 'application/json' }, body })).status, 400, body);
    }
    assert.equal((await t.start(t.ok, { x: 'y'.repeat(2000) })).status, 413);
    assert.equal((await t.call('GET', '/api/covers/download')).status, 405);
    assert.equal((await t.call('POST', '/api/covers', { headers: t.ok, json: {} })).status, 405);
    assert.equal(t.calls.download, 0);
  } finally { t.close(); }
});

test('API pochettes : les réponses portent nosniff et no-store', async () => {
  const t = await setup({ downloadCovers: async () => summaryOf() });
  try {
    for (const r of [await t.call('GET', '/api/covers'), await t.start(), await t.call('PUT', '/api/covers')]) {
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.equal(r.headers['cache-control'], 'no-store');
    }
  } finally { t.close(); }
});
