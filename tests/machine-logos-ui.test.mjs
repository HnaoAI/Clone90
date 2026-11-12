// Tests des logos téléchargés (T29) côté navigateur et serveur : games.json (logos), tuiles et repli, client et panneau, API locale, en-tête de sécurité des SVG.
// Aucun réseau : faux fetch, faux document, téléchargement factice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/project-root.mjs';
import { validateGames, loadData, groupGamesBySystem } from '../js/data.js';
import { buildMachineTiles, renderMachineGrid } from '../js/ui/machine-grid.js';
import { machineLogoSources } from '../js/ui/logo.js';
import { requestLogosDownload, fetchLogosStatus } from '../js/folders-client.js';
import { createFoldersPanel, COVERS_LABEL, LOGOS_LABEL, LOGOS_INFO, describeLogosState, FOLDER_CHOICES } from '../js/ui/folders-panel.js';
import { createStaticServer } from '../scripts/serve.mjs';
import { createSettingsApi } from '../scripts/settings-api.mjs';

const systems = JSON.parse(readFileSync(join(PROJECT_ROOT, 'systems.json'), 'utf8')).systems;
const sys = (id, extra = {}) => ({ id, name: id.toUpperCase(), order: 1, extensions: ['zip'], accent: `--m-${id}`, logo: `assets/logos/${id}.svg`, wave: 1, ...extra });

// --- systems.json ---
test('systems.json : chaque machine a un logoTheme (dossier du thème es-theme-carbon, T29), nom sûr pour une adresse', () => {
  for (const s of systems) assert.match(s.logoTheme ?? '', /^[a-z0-9]+(-[a-z0-9]+)*$/, `${s.id} : logoTheme`); // tiret admis depuis T30 (tg-cd)
  assert.equal(systems.find((s) => s.id === 'megacd').logoTheme, 'segacd');
  assert.equal(systems.find((s) => s.id === 'gameboycolor').logoTheme, 'gbc');
});

// --- games.json et chargement ---
test('validateGames : logos gardés seulement pour une machine connue et au chemin exact roms/clone90-logos/<machine>.svg', () => {
  const raw = { version: 1, games: [], logos: {
    amiga: 'roms/clone90-logos/amiga.svg', nes: 'roms/clone90-logos/autre.svg', inconnue: 'roms/clone90-logos/inconnue.svg',
    neogeo: '../../etc/passwd', __proto__: 'x', snes: 42,
  } };
  assert.deepEqual(validateGames(raw, ['amiga', 'nes', 'neogeo', 'snes']).logos, { amiga: 'roms/clone90-logos/amiga.svg' });
  assert.deepEqual(validateGames({ version: 1, games: [] }, ['amiga']).logos, {});
  assert.deepEqual(validateGames({ version: 1, games: [], logos: ['x'] }, ['amiga']).logos, {});
});

test('loadData : le logo téléchargé est ajouté à sa machine (downloadedLogo) ; sans games.json (GitHub Pages) aucune machine n\'en a', async () => {
  const fetchFor = (table) => async (url) => { if (!(url in table)) { const e = new Error('404'); e.status = 404; throw e; } return table[url]; };
  const withLogo = await loadData(fetchFor({ 'systems.json': { version: 1, systems: [sys('amiga'), sys('nes')] }, 'games.json': { version: 1, games: [], logos: { amiga: 'roms/clone90-logos/amiga.svg' } } }));
  assert.equal(withLogo.systems.find((s) => s.id === 'amiga').downloadedLogo, 'roms/clone90-logos/amiga.svg');
  assert.equal(withLogo.systems.find((s) => s.id === 'nes').downloadedLogo, undefined);
  const pages = await loadData(fetchFor({ 'systems.json': { version: 1, systems: [sys('amiga')] } }));
  assert.equal(pages.systems[0].downloadedLogo, undefined);
});

// --- Tuiles et repli ---
class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...items) { this.children.push(...items); }
  replaceChildren(...items) { this.children = [...items]; }
  addEventListener(t, f) { this.listeners[t] = f; }
  walk(fn) { fn(this); this.children.forEach((c) => c.walk?.(fn)); }
}
const doc = { createElement: (t) => new FakeNode(t), createTextNode: (s) => ({ text: s }) };
const find = (root, pred) => { const out = []; root.walk((n) => pred(n) && out.push(n)); return out; };

test('machineLogoSources : logo téléchargé d\'abord, logo maison en repli ; sans téléchargement, logo maison seul', () => {
  assert.deepEqual(machineLogoSources(sys('amiga', { downloadedLogo: 'roms/clone90-logos/amiga.svg' })),
    { logo: 'roms/clone90-logos/amiga.svg', fallbackLogo: 'assets/logos/amiga.svg', downloaded: true });
  assert.deepEqual(machineLogoSources(sys('amiga')), { logo: 'assets/logos/amiga.svg', fallbackLogo: null, downloaded: false });
  assert.deepEqual(machineLogoSources(sys('amiga', { logo: undefined })), { logo: null, fallbackLogo: null, downloaded: false });
});

test('accueil : logo téléchargé affiché ; s\'il ne charge pas, logo maison ; s\'il ne charge pas non plus, nom de la machine (jamais d\'image cassée)', () => {
  const machines = [sys('amiga', { downloadedLogo: 'roms/clone90-logos/amiga.svg' })];
  const tiles = buildMachineTiles(machines, groupGamesBySystem(machines, []));
  const root = renderMachineGrid(tiles, doc);
  const [box] = find(root, (n) => /machine-logo/.test(n.attrs.class ?? ''));
  assert.match(box.attrs.class, /\bis-downloaded\b/);
  const [img] = find(box, (n) => n.tag === 'img');
  assert.equal(img.attrs.src, 'roms/clone90-logos/amiga.svg');
  img.listeners.error();
  const [second] = find(box, (n) => n.tag === 'img');
  assert.equal(second.attrs.src, 'assets/logos/amiga.svg');
  assert.doesNotMatch(box.attrs.class, /is-downloaded/, 'le logo maison garde son fond');
  second.listeners.error();
  assert.equal(find(box, (n) => n.tag === 'img').length, 0);
  assert.equal(find(box, (n) => n.textContent === 'AMIGA').length, 1);
});

test('accueil : sans logo téléchargé, la tuile est inchangée (logo maison, pas de classe is-downloaded)', () => {
  const machines = [sys('amiga')];
  const root = renderMachineGrid(buildMachineTiles(machines, groupGamesBySystem(machines, [])), doc);
  const [box] = find(root, (n) => /machine-logo/.test(n.attrs.class ?? ''));
  assert.doesNotMatch(box.attrs.class, /is-downloaded/);
  assert.equal(find(box, (n) => n.tag === 'img')[0].attrs.src, 'assets/logos/amiga.svg');
});

// --- Client ---
const fakeFetch = (status, body, record) => async (url, init) => {
  record?.push({ url, init });
  if (body instanceof Error) throw body;
  return { ok: status >= 200 && status < 300, status, json: async () => body };
};

test('client logos : requestLogosDownload envoie POST {} vers api/logos/download avec X-Clone90 ; fetchLogosStatus lit api/logos sans cache', async () => {
  const calls = [];
  assert.deepEqual(await requestLogosDownload(fakeFetch(202, { status: 'started' }, calls)), { status: 'started' });
  assert.deepEqual([calls[0].url, calls[0].init.method, calls[0].init.body, calls[0].init.headers['X-Clone90']], ['api/logos/download', 'POST', '{}', '1']);
  const busy = await requestLogosDownload(fakeFetch(409, { status: 'busy', message: 'Occupé.' }));
  assert.deepEqual([busy.status, busy.message], ['busy', 'Occupé.']);
  const refused = await requestLogosDownload(fakeFetch(403, {}));
  assert.equal(refused.status, 'error');
  assert.match(refused.message, /logos/);
  const state = { id: 1, status: 'done', found: 2, lines: ['Logos téléchargés : 2'] };
  const read = [];
  assert.deepEqual(await fetchLogosStatus(fakeFetch(200, state, read)), state);
  assert.deepEqual([read[0].url, read[0].init.cache], ['api/logos', 'no-store']);
  assert.equal(await fetchLogosStatus(fakeFetch(404, {})), null);
});

// --- Panneau ---
class PanelNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...items) { for (const i of items) this.children.push(i); }
  replaceChildren(...items) { this.children = [...items]; }
  addEventListener(t, f) { this.listeners[t] = f; }
}
function panelDoc() {
  const d = { activeElement: null, listeners: {}, body: new PanelNode('body') };
  d.addEventListener = (t, f) => { d.listeners[t] = f; };
  d.removeEventListener = (t) => { delete d.listeners[t]; };
  d.createTextNode = (s) => ({ text: s });
  d.createElement = (t) => { const n = new PanelNode(t); n.focus = () => { d.activeElement = n; }; n.remove = () => { n.removed = true; }; return n; };
  return d;
}
const walk = (node, out = []) => { out.push(node); for (const c of node.children ?? []) walk(c, out); return out; };
const buttonsOf = (node) => walk(node).filter((n) => n.tag === 'button');
const statusOf = (node) => walk(node).find((n) => n.attrs?.role === 'status');
const settle = async () => { for (let i = 0; i < 10; i += 1) await new Promise((r) => setTimeout(r, 0)); };
const SETTINGS = { romsDir: '/Users/moi/ROMs', biosDir: '/projet/bios', romsIsDefault: false, biosIsDefault: true };
const idle = { start: async () => ({ status: 'started' }), status: async () => ({ status: 'idle' }) };

function openLogosPanel({ states = [], start = async () => ({ status: 'started' }), onLogosDone = () => {}, logosRunning = false, covers = idle } = {}) {
  const d = panelDoc();
  const starts = [];
  const logos = { start: async () => { starts.push(1); return start(); }, status: async () => states.shift() ?? { status: 'idle' } };
  const panel = createFoldersPanel({ settings: SETTINGS, choose: async () => ({ status: 'cancelled' }), onChanged: () => {}, covers, logos, logosRunning, onLogosDone, wait: async () => {} }, d);
  panel.open(d.body);
  return { panel, starts };
}
const pressLogos = (panel) => { for (let i = 0; i < 5; i += 1) panel.handleAction('down'); panel.handleAction('confirm'); };

test('panneau logos : bouton « Télécharger les logos des machines » juste après « Télécharger les pochettes », avant Fermer, seulement si l\'API des logos est fournie', () => {
  assert.equal(LOGOS_LABEL, 'Télécharger les logos des machines');
  const { panel } = openLogosPanel();
  assert.deepEqual(buttonsOf(panel.element).map((b) => b.textContent), [...FOLDER_CHOICES.map((c) => c.label), COVERS_LABEL, LOGOS_LABEL, 'Fermer']);
  assert.doesNotMatch(buttonsOf(panel.element)[5].attrs.class, /is-separated/, 'même groupe que les pochettes');
  const d = panelDoc();
  const plain = createFoldersPanel({ settings: SETTINGS, choose: async () => ({ status: 'cancelled' }), onChanged: () => {}, covers: idle }, d);
  assert.ok(!buttonsOf(plain.element).some((b) => b.textContent === LOGOS_LABEL));
});

test('panneau logos : le texte dit que Clone90 contacte github.com uniquement au clic, que GitHub voit l\'adresse IP, qu\'aucun nom de jeu n\'est envoyé et que les logos restent sur ce Mac', () => {
  assert.match(LOGOS_INFO, /github\.com/);
  assert.match(LOGOS_INFO, /uniquement quand vous cliquez/);
  assert.match(LOGOS_INFO, /adresse IP/);
  assert.match(LOGOS_INFO, /aucun nom de jeu/);
  assert.match(LOGOS_INFO, /jamais publiés/);
  const { panel } = openLogosPanel();
  assert.ok(panel.element.attrs['aria-describedby'].split(' ').includes('folders-logos-info'));
  assert.ok(walk(panel.element).some((n) => n.attrs?.id === 'folders-logos-info'));
});

test('panneau logos : clic = lancement, suivi, résumé en lignes, onLogosDone appelé une fois ; l\'API des pochettes n\'est pas appelée', async () => {
  const finished = [];
  let coverStarts = 0;
  const done = { id: 2, status: 'done', found: 12, lines: ['Logos téléchargés : 12'] };
  const { panel, starts } = openLogosPanel({
    states: [{ status: 'running', progress: { phase: 'downloading', done: 3, total: 12 } }, done], onLogosDone: (s) => finished.push(s),
    covers: { start: async () => { coverStarts += 1; return { status: 'started' }; }, status: async () => ({ status: 'idle' }) },
  });
  pressLogos(panel);
  await settle();
  assert.equal(starts.length, 1);
  assert.equal(coverStarts, 0);
  assert.equal(statusOf(panel.element).textContent, 'Logos téléchargés : 12');
  assert.deepEqual(finished, [done]);
});

test('panneau logos : rouvert pendant un téléchargement de logos, le suivi reprend sans en relancer un', async () => {
  const finished = [];
  const { starts } = openLogosPanel({ logosRunning: true, states: [{ id: 4, status: 'done', found: 1, lines: ['Logos téléchargés : 1'] }], onLogosDone: (s) => finished.push(s.id) });
  await settle();
  assert.equal(starts.length, 0);
  assert.deepEqual(finished, [4]);
});

test('logos : describeLogosState couvre terminé, erreur et avancement « n sur total »', () => {
  assert.deepEqual(describeLogosState({ status: 'done', found: 2, lines: ['Logos téléchargés : 2', 'Déjà présents : 1'] }), { text: 'Logos téléchargés : 2\nDéjà présents : 1', tone: 'ok', finished: true });
  assert.equal(describeLogosState({ status: 'done', found: 0, lines: ['Déjà présents : 12'] }).tone, 'info');
  assert.equal(describeLogosState({ status: 'error', message: 'Raté' }).tone, 'error');
  assert.match(describeLogosState({ status: 'running', progress: { phase: 'downloading', done: 3, total: 12 } }).text, /logos : 3 sur 12/);
});

// --- API locale ---
async function apiSetup({ downloadLogos, downloadCovers = async () => ({ exitCode: 0, summary: { found: [] } }) } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'clone90-lapi-'));
  await writeFile(join(root, 'index.html'), '<title>x</title>');
  let server;
  const api = createSettingsApi({
    root, enabled: true, getPort: () => server.address().port, applyFolders: () => {}, chooseFolder: async () => null,
    regenerate: async () => ({ exitCode: 0 }), downloadCovers, downloadLogos,
  });
  server = createStaticServer({ root, api });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const call = (method, path, { headers = { 'X-Clone90': '1' }, json } = {}) => new Promise((resolve, reject) => {
    const h = { ...headers, ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}) };
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path, headers: h }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(json !== undefined ? JSON.stringify(json) : undefined);
  });
  return { call, close: () => server.close() };
}
const until = async (fn) => { for (let i = 0; i < 200; i += 1) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 5)); } throw new Error('délai dépassé'); };
const logosResult = (found) => ({ exitCode: 0, summary: { found: new Array(found).fill('M'), alreadyHave: 1, failed: [], noSource: [] } });

test('API logos : GET /api/logos inactif puis POST 202, état terminé avec le résumé en français', async () => {
  const t = await apiSetup({ downloadLogos: async ({ onProgress }) => { onProgress({ phase: 'downloading', done: 1, total: 12 }); return logosResult(11); } });
  try {
    assert.deepEqual((await t.call('GET', '/api/logos')).json(), { status: 'idle' });
    assert.equal((await t.call('POST', '/api/logos/download', { json: {} })).status, 202);
    const done = await until(async () => { const j = (await t.call('GET', '/api/logos')).json(); return j.status === 'done' && j; });
    assert.equal(done.found, 11);
    assert.deepEqual(done.lines, ['Logos téléchargés : 11', 'Déjà présents : 1']);
    assert.deepEqual((await t.call('GET', '/api/covers')).json(), { status: 'idle' }, 'l\'état des pochettes ne bouge pas');
  } finally { t.close(); }
});

test('API logos : un seul téléchargement à la fois, verrou partagé avec les pochettes (409 dans les deux sens)', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const t = await apiSetup({ downloadLogos: async () => { await gate; return logosResult(1); } });
  try {
    assert.equal((await t.call('POST', '/api/logos/download', { json: {} })).status, 202);
    const again = await t.call('POST', '/api/logos/download', { json: {} });
    assert.equal(again.status, 409);
    assert.match(again.json().message, /logos/);
    assert.equal((await t.call('POST', '/api/covers/download', { json: {} })).status, 409);
    release();
    await until(async () => (await t.call('GET', '/api/logos')).json().status === 'done');
  } finally { t.close(); }
});

test('API logos sécurité : X-Clone90 manquant ou Origin étrangère = 403 ; paramètre dans le corps = 400 ; GET sur download = 405 ; erreur = message clair', async () => {
  let calls = 0;
  const t = await apiSetup({ downloadLogos: async () => { calls += 1; throw new Error('ENOTFOUND raw.githubusercontent.com'); } });
  try {
    assert.equal((await t.call('POST', '/api/logos/download', { headers: {}, json: {} })).status, 403);
    assert.equal((await t.call('POST', '/api/logos/download', { headers: { 'X-Clone90': '1', Origin: 'https://exemple.fr' }, json: {} })).status, 403);
    assert.equal((await t.call('POST', '/api/logos/download', { json: { url: 'https://exemple.fr' } })).status, 400);
    assert.equal((await t.call('GET', '/api/logos/download')).status, 405);
    assert.equal(calls, 0);
    assert.equal((await t.call('POST', '/api/logos/download', { json: {} })).status, 202);
    const failed = await until(async () => { const j = (await t.call('GET', '/api/logos')).json(); return j.status === 'error' && j; });
    assert.match(failed.message, /logos/);
    assert.doesNotMatch(failed.message, /ENOTFOUND/);
  } finally { t.close(); }
});

// --- Serveur : SVG sans script ---
test('serveur : les SVG (logos téléchargés comme logos maison) sont servis avec une politique qui interdit tout script', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clone90-svg-'));
  await mkdir(join(root, 'roms/clone90-logos'), { recursive: true });
  await writeFile(join(root, 'roms/clone90-logos/amiga.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(join(root, 'index.html'), '<title>x</title>');
  const server = createStaticServer({ root });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const head = (path) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: server.address().port, path }, (res) => { res.resume(); resolve(res); }).on('error', reject);
  });
  try {
    const svg = await head('/roms/clone90-logos/amiga.svg');
    assert.equal(svg.statusCode, 200);
    assert.equal(svg.headers['content-type'], 'image/svg+xml');
    assert.match(svg.headers['content-security-policy'] ?? '', /default-src 'none'/);
    assert.doesNotMatch(svg.headers['content-security-policy'], /script-src/);
    const page = await head('/index.html');
    assert.equal(page.headers['content-security-policy'], undefined, 'les pages ne changent pas');
  } finally { server.close(); }
});
