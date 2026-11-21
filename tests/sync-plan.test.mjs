// Tests de la synchronisation Mac -> téléphone, côté règles et téléphone (T43) : js/sync-plan.js, js/sync-client.js, rubrique de « Mes fichiers »,
// panneau du Mac (ui/sync-panel.js) et bouton du panneau des dossiers. Sans réseau ni navigateur (fetch, bibliothèque, stockage et document factices).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncTargetPath, normalizeMacAddress, isPairingCode, readManifest, planSync, describeSyncResult, SYNC_PORT } from '../js/sync-plan.js';
import { pairWithMac, syncFromMac, readSyncPairing, saveSyncPairing, forgetSyncPairing, SYNC_STORAGE_KEY } from '../js/sync-client.js';
import { renderSyncSection, SYNC_NAV, describeLastSync } from '../js/ui/sync-section.js';
import { renderLibrary } from '../js/ui/library-screen.js';
import { describeSyncStatus, createSyncPanel, SYNC_BUTTONS, fetchSyncStatus, requestSyncAction } from '../js/ui/sync-panel.js';
import { createFoldersPanel, SYNC_LABEL } from '../js/ui/folders-panel.js';

const IDS = ['amiga', 'neogeo', 'nes'];
const SYSTEMS = IDS.map((id) => ({ id, name: id.toUpperCase(), extensions: ['zip'] }));
const TOKEN = 'a'.repeat(64);

// --- Document factice ---
class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...items) { for (const i of items) this.children.push(i); }
  replaceChildren(...items) { this.children = [...items]; }
  addEventListener(t, f) { this.listeners[t] = f; }
}
function fakeDoc() {
  const d = { activeElement: null, listeners: {}, body: new FakeNode('body') };
  d.addEventListener = (t, f) => { d.listeners[t] = f; };
  d.removeEventListener = (t) => { delete d.listeners[t]; };
  d.createTextNode = (s) => ({ text: s });
  d.createElement = (t) => { const n = new FakeNode(t); n.focus = () => { d.activeElement = n; }; n.remove = () => { n.removed = true; }; return n; };
  return d;
}
const walk = (node, out = []) => { out.push(node); for (const c of node.children ?? []) walk(c, out); return out; };
const textOf = (nodes) => [nodes].flat().flatMap((n) => walk(n)).map((n) => n.textContent || n.text || '').join(' ');
const byNav = (nodes, id) => [nodes].flat().flatMap((n) => walk(n)).find((n) => n.dataset?.navId === id);

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), map: m };
}
function fakeLibrary(initial = {}) {
  const files = new Map(Object.entries(initial));
  return {
    files,
    list: async () => [...files].map(([path, blob]) => ({ path, size: blob.size })),
    put: async (path, blob) => { files.set(path, blob); },
    remove: async (path) => { files.delete(path); },
  };
}
const blobOf = (n) => new Blob([new Uint8Array(n)]);

// --- Règles partagées ---
test('T43 fichiers partagés : jeux d\'une machine connue, un niveau de sous-dossier rangé à plat, logos, BIOS', () => {
  assert.equal(syncTargetPath('roms/nes/Mario.nes', IDS), 'roms/nes/Mario.nes');
  assert.equal(syncTargetPath('roms/amiga/Leander/Leander (Disk 1).adf', IDS), 'roms/amiga/Leander (Disk 1).adf');
  assert.equal(syncTargetPath('roms/nes/Mario.png', IDS), 'roms/nes/Mario.png');
  assert.equal(syncTargetPath('roms/clone90-logos/nes.svg', IDS), 'roms/clone90-logos/nes.svg');
  assert.equal(syncTargetPath('bios/neogeo.zip', IDS), 'bios/neogeo.zip');
});

test('T43 fichiers partagés : jamais de fichier caché, de .., de machine inconnue, de chemin trop profond ou hors roms/ et bios/', () => {
  for (const p of ['roms/nes/.DS_Store', 'roms/../secret', 'roms/nes/../../x', 'roms/psx/jeu.bin', 'roms/nes/a/b/c.nes', 'games.json', '.git/config',
    'bios/sous/x.bin', 'roms/clone90-logos/../x.svg', 'roms/clone90-logos/nes.png', 'roms/nes/a\\b.nes', 'roms/nes/', '', null, 'roms/nes/x\u0000.nes']) {
    assert.equal(syncTargetPath(p, IDS), null, String(p));
  }
});

test('T43 adresse du Mac : IPv4 privée ou nom .local, HTTPS et port 8443 par défaut', () => {
  assert.equal(SYNC_PORT, 8443);
  assert.equal(normalizeMacAddress('192.168.1.20'), 'https://192.168.1.20:8443');
  assert.equal(normalizeMacAddress(' https://192.168.1.20:8443/ '), 'https://192.168.1.20:8443');
  assert.equal(normalizeMacAddress('10.0.0.5:9443'), 'https://10.0.0.5:9443');
  assert.equal(normalizeMacAddress('172.20.1.2'), 'https://172.20.1.2:8443');
  assert.equal(normalizeMacAddress('Mac-de-Hicham.local'), 'https://mac-de-hicham.local:8443');
});

test('T43 adresse du Mac : refus de http, d\'une adresse publique, d\'un chemin, d\'identifiants ou d\'un port invalide', () => {
  for (const a of ['http://192.168.1.20', '8.8.8.8', 'exemple.com', '192.168.1.20/sync', 'user@192.168.1.20', '192.168.1.20:80', '192.168.1.20:70000',
    '172.32.0.1', '192.168.1.300', '', '   ', null, 'javascript:alert(1)']) {
    assert.equal(normalizeMacAddress(a), null, String(a));
  }
});

test('T43 code d\'appairage : exactement 6 chiffres', () => {
  assert.equal(isPairingCode('012345'), true);
  for (const c of ['12345', '1234567', 'abcdef', ' 123456', 123456, null]) assert.equal(isPairingCode(c), false);
});

test('T43 liste du Mac : entrées mal formées ou non partagées ignorées, doublons à plat gardés une fois, forme invalide refusée', () => {
  const files = [
    { path: 'roms/nes/A.nes', size: 10, mtime: 1 }, { path: 'roms/nes/sous/A.nes', size: 11, mtime: 1 }, { path: 'roms/psx/x.bin', size: 1, mtime: 1 },
    { path: 'roms/nes/B.nes', size: -1, mtime: 1 }, { path: 'roms/nes/C.nes', size: 1 }, null, { path: 'bios/neogeo.zip', size: 5, mtime: 2 },
  ];
  assert.deepEqual(readManifest({ files }, IDS).map((e) => e.target), ['roms/nes/A.nes', 'bios/neogeo.zip']);
  for (const b of [null, {}, { files: 'x' }, [], { files: Array(50001).fill(null) }]) assert.equal(readManifest(b, IDS), null);
});

const R = (target, size = 10, mtime = 1) => ({ path: target, target, size, mtime });

test('T43 plan : copie ce qui manque, garde les fichiers mis par la personne, remplace un fichier venu du Mac qui a changé', () => {
  const plan = planSync({
    remote: [R('roms/nes/Neuf.nes'), R('roms/nes/AMoi.nes'), R('roms/nes/Change.nes', 20, 2), R('roms/nes/Pareil.nes')],
    local: [{ path: 'roms/nes/AMoi.nes', size: 3 }, { path: 'roms/nes/Change.nes', size: 10 }, { path: 'roms/nes/Pareil.nes', size: 10 }],
    synced: { 'roms/nes/Change.nes': { size: 10, mtime: 1 }, 'roms/nes/Pareil.nes': { size: 10, mtime: 1 } },
  });
  assert.deepEqual(plan.copy.map((e) => e.target), ['roms/nes/Neuf.nes']);
  assert.deepEqual(plan.replace.map((e) => e.target), ['roms/nes/Change.nes']);
  assert.equal(plan.kept, 1);
  assert.deepEqual(plan.remove, []);
});

test('T43 plan : retire seulement les fichiers venus du Mac et supprimés sur le Mac, jamais un fichier de la personne', () => {
  const plan = planSync({
    remote: [],
    local: [{ path: 'roms/nes/VenuDuMac.nes', size: 1 }, { path: 'roms/nes/AMoi.nes', size: 1 }],
    synced: { 'roms/nes/VenuDuMac.nes': { size: 1, mtime: 1 }, 'roms/nes/DejaEfface.nes': { size: 1, mtime: 1 } },
  });
  assert.deepEqual(plan.remove, ['roms/nes/VenuDuMac.nes']);
});

test('T49 plan : un fichier venu du Mac d\'une machine retirée (Game Boy) n\'est jamais effacé du téléphone', () => {
  const plan = planSync({
    remote: [],
    local: [{ path: 'roms/gameboy/Tetris.gb', size: 1 }, { path: 'roms/gameboy/Tetris.png', size: 1 }, { path: 'roms/nes/Parti.nes', size: 1 }],
    synced: { 'roms/gameboy/Tetris.gb': { size: 1, mtime: 1 }, 'roms/gameboy/Tetris.png': { size: 1, mtime: 1 }, 'roms/nes/Parti.nes': { size: 1, mtime: 1 } },
    systemIds: IDS,
  });
  assert.deepEqual(plan.remove, ['roms/nes/Parti.nes']);
});

test('T49 synchro : syncFromMac garde les jeux d\'une machine retirée venus du Mac', async () => {
  const files = new Map([['roms/gameboy/Tetris.gb', 1], ['roms/nes/Parti.nes', 1]]);
  const library = {
    list: async () => [...files].map(([path, size]) => ({ path, size })),
    put: async () => {},
    remove: async (path) => { files.delete(path); },
  };
  const store = new Map([[SYNC_STORAGE_KEY, JSON.stringify({ url: 'https://192.168.1.20:8443', token: TOKEN, files: { 'roms/gameboy/Tetris.gb': { size: 1, mtime: 1 }, 'roms/nes/Parti.nes': { size: 1, mtime: 1 } } })]]);
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
  const fetchFn = async () => ({ ok: true, status: 200, json: async () => ({ version: 1, files: [] }) });
  await syncFromMac({ library, systems: SYSTEMS, fetchFn, storage });
  assert.deepEqual([...files.keys()], ['roms/gameboy/Tetris.gb']);
});

test('T43 plan : ordre de copie logos, pochettes, BIOS, puis jeux du plus petit au plus gros', () => {
  const plan = planSync({ remote: [R('roms/nes/Gros.nes', 900), R('roms/nes/Petit.nes', 5), R('bios/neogeo.zip', 500), R('roms/nes/Petit.png', 50), R('roms/clone90-logos/nes.svg', 70)], local: [] });
  assert.deepEqual(plan.copy.map((e) => e.target), ['roms/clone90-logos/nes.svg', 'roms/nes/Petit.png', 'bios/neogeo.zip', 'roms/nes/Petit.nes', 'roms/nes/Gros.nes']);
});

test('T43 message : résumé français, rien en mode automatique quand rien n\'a changé', () => {
  assert.equal(describeSyncResult({ quiet: true }), null);
  assert.match(describeSyncResult({}), /déjà tous les fichiers/);
  const text = describeSyncResult({ copied: 3, replaced: 1, removed: 2, noSpace: 1, failed: 1 });
  assert.match(text, /3 fichiers copiés depuis le Mac/);
  assert.match(text, /1 fichier mis à jour/);
  assert.match(text, /2 fichiers retirés/);
  assert.match(text, /plus assez de place/);
  assert.match(text, /1 fichier en échec/);
});

// --- Téléphone : association ---
test('T43 association : adresse et code contrôlés avant tout envoi, rien envoyé sinon', async () => {
  const calls = [];
  const fetchFn = async (...a) => { calls.push(a); throw new Error('ne doit pas être appelé'); };
  assert.match((await pairWithMac({ address: '8.8.8.8', code: '123456', fetchFn, storage: memoryStorage() })).message, /Adresse du Mac invalide/);
  assert.match((await pairWithMac({ address: '192.168.1.2', code: '12ab', fetchFn, storage: memoryStorage() })).message, /6 chiffres/);
  assert.equal(calls.length, 0);
});

test('T43 association : POST du code au Mac en HTTPS, sans cookie ni adresse du site, jeton gardé', async () => {
  const storage = memoryStorage();
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => ({ token: TOKEN }) }; };
  const out = await pairWithMac({ address: '192.168.1.20', code: '123 456', fetchFn, storage });
  assert.deepEqual(out, { ok: true, url: 'https://192.168.1.20:8443' });
  assert.equal(calls[0].url, 'https://192.168.1.20:8443/sync/pair');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  assert.deepEqual(JSON.parse(calls[0].init.body), { code: '123456' });
  assert.equal(readSyncPairing(storage).token, TOKEN);
});

test('T43 association : Mac injoignable (certificat absent, autre Wi-Fi) ou code refusé -> message français, rien gardé', async () => {
  const storage = memoryStorage();
  const down = await pairWithMac({ address: '192.168.1.20', code: '123456', fetchFn: async () => { throw new TypeError('Failed to fetch'); }, storage });
  assert.match(down.message, /Mac injoignable.*certificat/);
  const refused = await pairWithMac({ address: '192.168.1.20', code: '123456', fetchFn: async () => ({ ok: false, status: 403, json: async () => ({ message: 'Code incorrect.' }) }), storage });
  assert.equal(refused.message, 'Code incorrect.');
  assert.equal(readSyncPairing(storage), null);
});

test('T43 association : stockage illisible ou refusé sans erreur ; oublier efface l\'association', () => {
  const broken = { getItem: () => { throw new Error('refusé'); }, setItem: () => { throw new Error('refusé'); }, removeItem: () => { throw new Error('refusé'); } };
  assert.equal(readSyncPairing(broken), null);
  assert.equal(saveSyncPairing({ url: 'https://192.168.1.2:8443', token: TOKEN }, broken), false);
  forgetSyncPairing(broken);
  const storage = memoryStorage();
  storage.setItem(SYNC_STORAGE_KEY, '{pas du json');
  assert.equal(readSyncPairing(storage), null);
  storage.setItem(SYNC_STORAGE_KEY, JSON.stringify({ url: 'http://8.8.8.8', token: TOKEN }));
  assert.equal(readSyncPairing(storage), null, 'adresse non acceptée');
  saveSyncPairing({ url: 'https://192.168.1.2:8443', token: TOKEN, files: {} }, storage);
  forgetSyncPairing(storage);
  assert.equal(readSyncPairing(storage), null);
});

// --- Téléphone : synchronisation ---
function paired(files = {}) {
  const storage = memoryStorage();
  saveSyncPairing({ url: 'https://192.168.1.20:8443', token: TOKEN, files, lastSync: null }, storage);
  return storage;
}
/** Faux Mac : liste et fichiers ; `sizes` : taille annoncée ; `served` : taille réellement servie (fichier incomplet). */
function fakeMac(entries, { status = 200, served = {}, log = [] } = {}) {
  return async (url, init) => {
    log.push({ url, init });
    if (url.endsWith('/sync/manifest')) return { ok: status === 200, status, json: async () => ({ version: 1, files: entries }) };
    const path = decodeURIComponent(new URL(url).searchParams.get('path'));
    const e = entries.find((x) => x.path === path);
    if (!e) return { ok: false, status: 404, blob: async () => blobOf(0) };
    return { ok: true, status: 200, blob: async () => blobOf(served[path] ?? e.size) };
  };
}

test('T43 synchronisation : copie jeux, pochettes, logos et BIOS du Mac dans la bibliothèque, avec le jeton, rangés au même chemin', async () => {
  const storage = paired();
  const library = fakeLibrary();
  const log = [];
  const entries = [{ path: 'roms/nes/Mario.nes', size: 40, mtime: 5 }, { path: 'roms/nes/Mario.png', size: 8, mtime: 5 },
    { path: 'roms/clone90-logos/nes.svg', size: 4, mtime: 5 }, { path: 'bios/neogeo.zip', size: 6, mtime: 5 }, { path: 'roms/amiga/Leander/L1.adf', size: 7, mtime: 5 }];
  const progress = [];
  const out = await syncFromMac({ library, systems: SYSTEMS, fetchFn: fakeMac(entries, { log }), storage, estimate: async () => ({}), onProgress: (p) => progress.push(p) });
  assert.equal(out.status, 'done');
  assert.equal(out.changed, true);
  assert.match(out.text, /5 fichiers copiés depuis le Mac/);
  assert.deepEqual([...library.files.keys()].sort(), ['bios/neogeo.zip', 'roms/amiga/L1.adf', 'roms/clone90-logos/nes.svg', 'roms/nes/Mario.nes', 'roms/nes/Mario.png']);
  assert.ok(log.every((c) => c.init.headers.Authorization === `Bearer ${TOKEN}` && c.init.credentials === 'omit'));
  assert.ok(log.every((c) => c.url.startsWith('https://192.168.1.20:8443/')), 'seulement le Mac associé');
  assert.ok(log.some((c) => c.url.includes(`path=${encodeURIComponent('roms/amiga/Leander/L1.adf')}`)));
  assert.equal(progress.at(-1).done, 5);
  assert.deepEqual(readSyncPairing(storage).files['roms/nes/Mario.nes'], { size: 40, mtime: 5 });
  assert.ok(readSyncPairing(storage).lastSync > 0);
});

test('T43 synchronisation : seconde fois, rien n\'est recopié ; fichier changé sur le Mac remplacé ; fichier supprimé sur le Mac retiré', async () => {
  const storage = paired();
  const library = fakeLibrary({ 'roms/nes/AMoi.nes': blobOf(3) });
  const first = [{ path: 'roms/nes/A.nes', size: 4, mtime: 1 }, { path: 'roms/nes/B.nes', size: 4, mtime: 1 }, { path: 'roms/nes/AMoi.nes', size: 9, mtime: 1 }];
  await syncFromMac({ library, systems: SYSTEMS, fetchFn: fakeMac(first), storage, estimate: async () => ({}) });
  const log = [];
  const again = await syncFromMac({ library, systems: SYSTEMS, fetchFn: fakeMac(first, { log }), storage, estimate: async () => ({}), quiet: true });
  assert.equal(again.text, null, 'automatique sans changement : aucun message');
  assert.equal(log.length, 1, 'seulement la liste');
  const second = [{ path: 'roms/nes/A.nes', size: 6, mtime: 2 }];
  const out = await syncFromMac({ library, systems: SYSTEMS, fetchFn: fakeMac(second), storage, estimate: async () => ({}) });
  assert.match(out.text, /1 fichier mis à jour.*1 fichier retiré/);
  assert.equal(library.files.get('roms/nes/A.nes').size, 6);
  assert.equal(library.files.has('roms/nes/B.nes'), false);
  assert.equal(library.files.get('roms/nes/AMoi.nes').size, 3, 'fichier de la personne jamais remplacé ni retiré');
  assert.deepEqual(Object.keys(readSyncPairing(storage).files), ['roms/nes/A.nes']);
});

test('T43 synchronisation : plus de place -> fichier sauté et signalé ; fichier incomplet ou refusé -> échec compté, rien rangé', async () => {
  const storage = paired();
  const library = fakeLibrary();
  const entries = [{ path: 'roms/nes/Petit.nes', size: 10, mtime: 1 }, { path: 'roms/nes/Coupe.nes', size: 30, mtime: 1 }, { path: 'roms/nes/Enorme.nes', size: 500 * 1024 * 1024, mtime: 1 }];
  const fetchFn = fakeMac(entries, { served: { 'roms/nes/Coupe.nes': 12 } });
  const out = await syncFromMac({ library, systems: SYSTEMS, fetchFn, storage, estimate: async () => ({ quota: 200 * 1024 * 1024, usage: 0 }) });
  assert.match(out.text, /1 fichier non copié : plus assez de place/);
  assert.match(out.text, /1 fichier en échec/);
  assert.deepEqual([...library.files.keys()], ['roms/nes/Petit.nes']);
});

test('T43 synchronisation : sans association rien n\'est fait ; jeton refusé (401) -> à réassocier ; Mac injoignable silencieux en automatique', async () => {
  assert.equal((await syncFromMac({ library: fakeLibrary(), systems: SYSTEMS, storage: memoryStorage(), fetchFn: async () => { throw new Error('x'); } })).status, 'unpaired');
  const unpaired = await syncFromMac({ library: fakeLibrary(), systems: SYSTEMS, storage: paired(), fetchFn: fakeMac([], { status: 401 }) });
  assert.equal(unpaired.status, 'unpaired');
  assert.match(unpaired.text, /associez-le de nouveau/);
  const down = async () => { throw new TypeError('Failed to fetch'); };
  assert.deepEqual(await syncFromMac({ library: fakeLibrary(), systems: SYSTEMS, storage: paired(), fetchFn: down, quiet: true }), { status: 'unreachable', text: null, changed: false });
  assert.match((await syncFromMac({ library: fakeLibrary(), systems: SYSTEMS, storage: paired(), fetchFn: down })).text, /Mac injoignable/);
  const odd = await syncFromMac({ library: fakeLibrary(), systems: SYSTEMS, storage: paired(), fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ nope: 1 }) }) });
  assert.equal(odd.status, 'error');
});

test('T43 synchronisation : une seule à la fois', async () => {
  const storage = paired();
  let release;
  const slow = async () => { await new Promise((r) => { release = r; }); return { ok: true, status: 200, json: async () => ({ files: [] }) }; };
  const first = syncFromMac({ library: fakeLibrary(), systems: SYSTEMS, storage, fetchFn: slow });
  assert.equal((await syncFromMac({ library: fakeLibrary(), systems: SYSTEMS, storage, fetchFn: slow })).status, 'busy');
  await new Promise((r) => setTimeout(r, 0));
  release();
  assert.equal((await first).status, 'done');
});

// --- Écrans ---
test('T43 « Mes fichiers » : rubrique « Synchroniser avec le Mac » avec adresse, code et bouton Associer (navigables)', () => {
  const doc = fakeDoc();
  const asked = [];
  const nodes = renderSyncSection({ pairing: null, onPair: (a, c) => asked.push([a, c]), onSyncNow() {}, onForget() {} }, doc);
  assert.match(textOf(nodes), /Synchroniser avec le Mac/);
  assert.match(textOf(nodes), /certificat/);
  for (const id of [SYNC_NAV.address, SYNC_NAV.code, SYNC_NAV.pair]) assert.ok(byNav(nodes, id), id);
  byNav(nodes, SYNC_NAV.address).value = '192.168.1.20';
  byNav(nodes, SYNC_NAV.code).value = '123456';
  const form = nodes.flatMap((n) => walk(n)).find((n) => n.tag === 'form');
  form.listeners.submit({ preventDefault() {} });
  assert.deepEqual(asked, [['192.168.1.20', '123456']]);
});

test('T43 « Mes fichiers » : associé -> Mac, dernière synchronisation, « Synchroniser maintenant », « Oublier ce Mac », message', () => {
  const doc = fakeDoc();
  const calls = [];
  const nodes = renderSyncSection({ pairing: { url: 'https://192.168.1.20:8443', lastSync: null }, message: 'Synchronisation : 2 fichiers copiés depuis le Mac.',
    onPair() {}, onSyncNow: () => calls.push('now'), onForget: () => calls.push('forget') }, doc);
  const text = textOf(nodes);
  assert.match(text, /https:\/\/192\.168\.1\.20:8443/);
  assert.match(text, /Pas encore synchronisé/);
  assert.match(text, /2 fichiers copiés/);
  byNav(nodes, SYNC_NAV.now).listeners.click();
  byNav(nodes, SYNC_NAV.forget).listeners.click();
  assert.deepEqual(calls, ['now', 'forget']);
  assert.match(describeLastSync(Date.UTC(2026, 10, 15, 10, 30)), /^Dernière synchronisation : 15\/11\/2026 à/);
  const busy = renderSyncSection({ pairing: { url: 'https://192.168.1.20:8443', lastSync: 1 }, disabled: true, onPair() {}, onSyncNow() {}, onForget() {} }, doc);
  assert.equal(byNav(busy, SYNC_NAV.now).attrs.disabled, '');
});

test('T43 « Mes fichiers » : la rubrique n\'apparaît que si l\'hôte la fournit et que le navigateur garde des fichiers', () => {
  const base = { systems: SYSTEMS, entries: [], onAddGames() {}, onAddBios() {}, onRemove() {} };
  const sync = { pairing: null, onPair() {}, onSyncNow() {}, onForget() {} };
  assert.match(textOf(renderLibrary({ ...base, supported: true, sync }, fakeDoc())), /Synchroniser avec le Mac/);
  assert.doesNotMatch(textOf(renderLibrary({ ...base, supported: true }, fakeDoc())), /Synchroniser avec le Mac/);
  assert.doesNotMatch(textOf(renderLibrary({ ...base, supported: false, sync }, fakeDoc())), /Synchroniser avec le Mac/);
});

// --- Mac : panneau ---
const STATUS = { enabled: true, running: true, port: 8443, addresses: ['https://192.168.1.20:8443'], code: { value: '042517', expiresAt: 1000 + 4 * 60000 }, devices: 1, error: null };

test('T43 panneau du Mac : arrêté -> rien d\'ouvert ; actif -> adresse, code, durée, téléphones, étapes du certificat', () => {
  const off = describeSyncStatus({ ...STATUS, running: false, enabled: false, addresses: [], code: null, devices: 0 }, 1000);
  assert.match(off.state, /rien n'est ouvert au réseau/);
  assert.deepEqual(off.steps, []);
  const on = describeSyncStatus(STATUS, 1000);
  assert.equal(on.code, '042517');
  assert.match(on.codeNote, /4 min, pour un seul téléphone/);
  assert.match(on.devices, /1 téléphone associé/);
  assert.match(on.steps.join(' '), /certificat.*Certificat CA/);
  assert.match(describeSyncStatus(null).state, /Impossible de joindre Clone90/);
});

test('T43 panneau du Mac : « Activer le partage » envoie POST api/sync/enable {} avec X-Clone90, puis le bouton devient « Arrêter le partage »', async () => {
  const doc = fakeDoc();
  const calls = [];
  const fetchFn = async (url, init) => { calls.push({ url, init }); return { ok: true, status: 200, json: async () => STATUS }; };
  const panel = createSyncPanel({ fetchFn, initial: { ...STATUS, running: false, enabled: false, addresses: [], code: null, devices: 0 }, now: () => 1000 }, doc);
  panel.open(doc.body);
  assert.deepEqual(panel.buttons.map((b) => b.textContent), [SYNC_BUTTONS.enable, SYNC_BUTTONS.pair, SYNC_BUTTONS.forget, SYNC_BUTTONS.uploadsOn, SYNC_BUTTONS.close]);
  assert.equal(panel.buttons[1].attrs['aria-disabled'], 'true', 'pas de code sans partage');
  panel.handleAction('confirm');
  await new Promise((r) => setTimeout(r, 0));
  assert.equal(calls[0].url, 'api/sync/enable');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['X-Clone90'], '1');
  assert.equal(calls[0].init.body, '{}');
  assert.equal(panel.buttons[0].textContent, SYNC_BUTTONS.disable);
  assert.match(textOf(panel.element), /042517/);
});

test('T43 panneau du Mac : client sans API -> null ; refus -> message', async () => {
  assert.equal(await fetchSyncStatus(async () => ({ ok: false, status: 404, json: async () => ({}) })), null);
  assert.equal(await fetchSyncStatus(async () => { throw new Error('x'); }), null);
  assert.match((await requestSyncAction('pair', async () => ({ ok: false, status: 409, json: async () => ({ message: 'Activez d\'abord le partage.' }) }))).message, /Activez/);
  assert.match((await requestSyncAction('pair', async () => { throw new Error('x'); })).message, /Impossible de joindre/);
});

test('T43 panneau des dossiers : bouton « Partager avec le téléphone » seulement si l\'hôte le demande ; il ferme le panneau puis ouvre le partage', async () => {
  const settings = { romsDir: '/r', biosDir: '/b', romsIsDefault: true, biosIsDefault: true };
  const without = createFoldersPanel({ settings, choose: async () => ({}), onChanged() {} }, fakeDoc());
  assert.equal(without.buttons.some((b) => b.textContent === SYNC_LABEL), false);
  const doc = fakeDoc();
  let opened = 0;
  const panel = createFoldersPanel({ settings, choose: async () => ({}), onChanged() {}, onOpenSync: () => { opened += 1; } }, doc);
  panel.open(doc.body);
  const index = panel.buttons.findIndex((b) => b.textContent === SYNC_LABEL);
  assert.equal(index, panel.buttons.length - 2, 'juste avant « Fermer »');
  panel.buttons[index].listeners.click();
  assert.equal(opened, 1);
  assert.equal(await panel.result, true);
});
