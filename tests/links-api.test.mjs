// Tests de l'API locale des liens (T34) : POST /api/links/scan, POST /api/links/download, GET /api/links. Mêmes contrôles de sécurité que T25,
// verrou partagé avec les pochettes, corps validé ; analyse et téléchargement factices, aucun réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticServer } from '../scripts/serve.mjs';
import { createSettingsApi, parseLinkItems } from '../scripts/settings-api.mjs';
import { RelayError } from '../scripts/link-relay.mjs';
import { PROJECT_ROOT } from '../scripts/project-root.mjs';

async function setup({ enabled = true, scanLinks = async () => ({ url: 'u', files: [], truncated: false }), fetchLinks, downloadCovers } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'clone90-lapi-'));
  await writeFile(join(root, 'index.html'), '<title>x</title>');
  await copyFile(join(PROJECT_ROOT, 'systems.json'), join(root, 'systems.json'));
  const calls = { scan: [], fetch: [], regenerate: 0 };
  let server;
  const api = createSettingsApi({
    root, enabled, getPort: () => server.address().port, applyFolders: () => {}, chooseFolder: async () => null,
    regenerate: async () => { calls.regenerate += 1; return { exitCode: 0 }; },
    downloadCovers: downloadCovers ?? (async () => ({ exitCode: 0, summary: { found: [] } })),
    scanLinks: async (url, systems, options) => { calls.scan.push({ url, systems: systems.length }); return scanLinks(url, options); },
    fetchLinks: async (items, options) => { calls.fetch.push({ items, options }); return fetchLinks(items, options); },
  });
  server = createStaticServer({ root, api });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const call = (method, path, { headers = {}, body, json } = {}) => new Promise((resolve, reject) => {
    const h = { 'X-Clone90': '1', ...headers };
    if (json !== undefined && h['Content-Type'] === undefined) h['Content-Type'] = 'application/json';
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, text, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(json !== undefined ? JSON.stringify(json) : body);
  });
  return { root, port, calls, call, close: () => server.close() };
}
const until = async (fn) => { for (let i = 0; i < 400; i += 1) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 5)); } throw new Error('délai dépassé'); };
const ITEM = { url: 'https://exemple.org/jeu.adf', target: 'amiga' };

test('T34 API liens : désactivée (réseau local, téléphone, autre système) : 404, rien lancé', async () => {
  const t = await setup({ enabled: false });
  try {
    assert.equal((await t.call('POST', '/api/links/scan', { json: { url: 'https://exemple.org/' } })).status, 404);
    assert.equal((await t.call('POST', '/api/links/download', { json: { items: [ITEM] } })).status, 404);
    assert.equal((await t.call('GET', '/api/links')).status, 404);
    assert.equal(t.calls.scan.length + t.calls.fetch.length, 0);
  } finally { t.close(); }
});

test('T34 API liens : mêmes refus que les dossiers (hôte, origine, en-tête X-Clone90, type de contenu)', async () => {
  const t = await setup();
  try {
    const json = { url: 'https://exemple.org/' };
    assert.equal((await t.call('POST', '/api/links/scan', { json, headers: { Host: 'piege.test' } })).status, 403);
    assert.equal((await t.call('POST', '/api/links/scan', { json, headers: { Origin: 'https://piege.test' } })).status, 403);
    assert.equal((await t.call('POST', '/api/links/scan', { json, headers: { 'X-Clone90': '0' } })).status, 403);
    assert.equal((await t.call('POST', '/api/links/scan', { body: JSON.stringify(json), headers: { 'Content-Type': 'text/plain' } })).status, 415);
    assert.equal((await t.call('GET', '/api/links/scan')).status, 405);
    assert.equal(t.calls.scan.length, 0);
  } finally { t.close(); }
});

test('T34/T36 API analyse : lancée en arrière-plan, état lu par GET /api/links/scan/state, erreur du relais rendue en message français', async () => {
  let fail = false;
  const t = await setup({
    scanLinks: async (url) => {
      if (fail) throw new RelayError('blocked-address', 'Cette adresse mène à un appareil local ou privé : Clone90 ne la contacte pas.');
      return { url, files: [{ url: `${url}a.adf`, name: 'a.adf', kind: 'rom', target: 'amiga', candidates: ['amiga'] }], truncated: false, stopped: false, stats: { pages: 1, links: 1 } };
    },
  });
  try {
    assert.equal((await t.call('POST', '/api/links/scan', { json: { url: 'https://exemple.org/' } })).status, 202);
    const done = await until(async () => { const s = (await t.call('GET', '/api/links/scan/state')).json(); return s.status === 'done' && s; });
    assert.equal(done.files[0].name, 'a.adf');
    assert.equal(t.calls.scan[0].systems, 14, 'machines lues dans systems.json');
    fail = true;
    assert.equal((await t.call('POST', '/api/links/scan', { json: { url: 'http://192.168.1.1/' } })).status, 202);
    const refused = await until(async () => { const s = (await t.call('GET', '/api/links/scan/state')).json(); return s.status === 'error' && s; });
    assert.equal(refused.message, 'Cette adresse mène à un appareil local ou privé : Clone90 ne la contacte pas.');
    assert.equal((await t.call('POST', '/api/links/scan', { json: { url: 'x', autre: 1 } })).status, 400);
    assert.equal((await t.call('POST', '/api/links/scan', { json: { url: 3 } })).status, 400);
    assert.equal((await t.call('POST', '/api/links/scan', { json: { url: 'x', depth: 3 } })).status, 400);
    assert.equal((await t.call('POST', '/api/links/scan', { json: { url: 'x', depth: 1.5 } })).status, 400);
    assert.equal((await t.call('POST', '/api/links/scan', { json: { url: 'x'.repeat(5000) } })).status, 413);
  } finally { t.close(); }
});

test('T36 API analyse : profondeur transmise, une analyse à la fois, « Arrêter » interrompt et rend ce qui est trouvé', async () => {
  let seen;
  const t = await setup({
    scanLinks: async (url, options) => {
      seen = options;
      await new Promise((r) => { options.signal.addEventListener('abort', r); });
      return { url, files: [], truncated: false, stopped: true, stats: { pages: 3, links: 9 } };
    },
  });
  try {
    assert.equal((await t.call('POST', '/api/links/scan', { json: { url: 'https://exemple.org/', depth: 2 } })).status, 202);
    await until(async () => seen);
    assert.equal(seen.depth, 2);
    assert.equal((await t.call('POST', '/api/links/scan', { json: { url: 'https://exemple.org/' } })).status, 409);
    assert.equal((await t.call('POST', '/api/links/scan/stop', { json: {} })).json().status, 'stopping');
    const done = await until(async () => { const s = (await t.call('GET', '/api/links/scan/state')).json(); return s.status === 'done' && s; });
    assert.equal(done.stopped, true);
    assert.equal((await t.call('POST', '/api/links/scan/stop', { json: { x: 1 } })).status, 400);
  } finally { t.close(); }
});

test('T34 API téléchargement : corps limité à {items: [{url, target}]}, 1 à 200 choix, rien d\'autre', () => {
  assert.deepEqual(parseLinkItems({ items: [ITEM] }), { items: [ITEM] });
  assert.deepEqual(parseLinkItems({ items: [{ ...ITEM, name: 'jeu.adf' }] }), { items: [{ ...ITEM, name: 'jeu.adf' }] }, 'T36 : nom facultatif');
  for (const bad of [{}, { items: [] }, { items: 'x' }, { items: [ITEM], path: '/tmp' }, { items: [{ ...ITEM, dir: '/etc' }] },
    { items: [{ url: 1, target: 'amiga' }] }, { items: [null] }, { items: Array(201).fill(ITEM) }, { items: [{ url: 'x'.repeat(3000), target: 'amiga' }] }, { items: [{ ...ITEM, name: 3 }] }, { items: [{ ...ITEM, name: 'n'.repeat(300) }] }]) {
    assert.equal(parseLinkItems(bad), null, JSON.stringify(bad).slice(0, 80));
  }
});

test('T34 API téléchargement : lancé en arrière-plan, suivi par GET /api/links, dossiers du serveur utilisés, games.json régénéré', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const t = await setup({
    fetchLinks: async (items, { onProgress }) => {
      onProgress({ phase: 'downloading', done: 0, total: 1, name: 'amiga/jeu.adf' });
      await gate;
      return { downloaded: ['amiga/jeu.adf'], present: [], failed: [] };
    },
  });
  try {
    assert.equal((await t.call('POST', '/api/links/download', { json: { items: [ITEM, { url: 'x', target: 'y', z: 1 }] } })).status, 400);
    const started = await t.call('POST', '/api/links/download', { json: { items: [ITEM] } });
    assert.equal(started.status, 202);
    const running = await until(async () => { const s = (await t.call('GET', '/api/links')).json(); return s.progress?.total === 1 && s; });
    assert.equal(running.status, 'running');
    assert.equal(t.calls.fetch[0].options.romsDir, join(t.root, 'roms'));
    assert.equal(t.calls.fetch[0].options.biosDir, join(t.root, 'bios'));
    const busy = await t.call('POST', '/api/covers/download', { json: {} });
    assert.equal(busy.status, 409, 'verrou partagé avec les pochettes');
    assert.match(busy.json().message, /fichiers est en cours/);
    release();
    const done = await until(async () => { const s = (await t.call('GET', '/api/links')).json(); return s.status === 'done' && s; });
    assert.equal(done.found, 1);
    assert.deepEqual(done.lines, ['Fichiers téléchargés : 1']);
    assert.equal(t.calls.regenerate, 1);
  } finally { t.close(); }
});

test('T34 API téléchargement : échec inattendu du relais : état « error » avec un message, verrou libéré', async () => {
  const t = await setup({ fetchLinks: async () => { throw new Error('boum'); } });
  try {
    assert.equal((await t.call('POST', '/api/links/download', { json: { items: [ITEM] } })).status, 202);
    const state = await until(async () => { const s = (await t.call('GET', '/api/links')).json(); return s.status === 'error' && s; });
    assert.match(state.message, /a échoué/);
    assert.equal((await t.call('POST', '/api/links/download', { json: { items: [ITEM] } })).status, 202);
  } finally { t.close(); }
});
