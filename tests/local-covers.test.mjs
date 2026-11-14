// Tests de T40 : pochettes des jeux de « Mes fichiers » (navigateur, téléphone). AUCUN réseau : faux GitHub, fausse bibliothèque, faux IndexedDB.
// Couvre js/local-covers.js (recherche, téléchargement, rangement, cache des listes, textes) et le bouton de l'écran « Mes fichiers ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/project-root.mjs';
import {
  findLocalCovers, describeCoversResult, openListingsCache, browserFetchJson, browserFetchBytes, localCoverPath, COVERS_DB,
} from '../js/local-covers.js';
import { MAX_COVER_BYTES, chooseCover } from '../js/cover-match.js';
import * as macCovers from '../scripts/covers.mjs';
import { buildLocalGames } from '../js/local-games.js';
import { renderLibrary, FIND_COVERS_NAV_ID, COVERS_LIBRARY_INFO } from '../js/ui/library-screen.js';

const NOW = new Date('2026-11-14T10:00:00.000Z');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
let shaCounter = 0;
const file = (name, extra = {}) => ({ name, sha: `sha${shaCounter += 1}`, size: 1000, ...extra });

const SYSTEMS = [
  { id: 'amiga', name: 'Amiga', extensions: ['adf', 'm3u', 'zip'], diskSets: true, thumbnailsRepo: 'Fake_Amiga', bios: [] },
  { id: 'neogeo', name: 'Neo Geo', extensions: ['zip'], thumbnailsRepo: 'Fake_NeoGeo', bios: [] },
  { id: 'nes', name: 'NES', extensions: ['nes'], bios: [] },
];

/** Faux GitHub (mêmes réponses que l'API des arbres et raw.githubusercontent.com). Enregistre les adresses demandées. */
function fakeGithub(repos, { bytes = () => PNG, failJson = null } = {}) {
  const calls = { json: [], bytes: [] };
  const fetchJson = async (url) => {
    calls.json.push(url);
    if (failJson) throw new Error(failJson);
    const m = /^https:\/\/api\.github\.com\/repos\/libretro-thumbnails\/([^/]+)\/git\/trees\/(.+)$/.exec(url);
    if (!m || !repos[m[1]]) throw new Error('GitHub a répondu 404');
    if (m[2] === 'HEAD') return { tree: [{ path: 'Named_Boxarts', type: 'tree', sha: `B-${m[1]}` }] };
    return { truncated: false, tree: repos[m[1]].map((f) => ({ path: f.name, type: 'blob', sha: f.sha, size: f.size })) };
  };
  const fetchBytes = async (url, options) => {
    calls.bytes.push(url);
    assert.equal(options.maxBytes, MAX_COVER_BYTES);
    return bytes(url);
  };
  return { net: { fetchJson, fetchBytes }, calls };
}

/** Fausse bibliothèque (interface de local-library.js utilisée ici : list, put). */
function fakeLibrary(paths = []) {
  const files = new Map(paths.map((p) => [p, new Blob(['x'])]));
  return {
    files,
    list: async () => [...files.keys()].map((path) => ({ path, size: files.get(path).size, addedAt: 0 })),
    put: async (path, blob) => { files.set(path, blob); },
  };
}

/** Jeux de la bibliothèque, construits exactement comme le fait l'application (local-games.js). */
const gamesOf = (library) => buildLocalGames({ systems: SYSTEMS, paths: [...library.files.keys()] });

/** Cache des listes en mémoire (même interface que openListingsCache). */
function memoryListings(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, get: async (repo) => map.get(repo) ?? null, set: async (repo, entry) => { map.set(repo, entry); } };
}

const run = (library, net, extra = {}) => findLocalCovers({ systems: SYSTEMS, games: gamesOf(library), library, net, listings: memoryListings(), now: NOW, ...extra });

// ---- Partage avec le Mac ----

test('T40 commun : le Mac et le navigateur utilisent la même recherche de pochette (js/cover-match.js)', () => {
  assert.equal(macCovers.chooseCover, chooseCover);
  assert.equal(macCovers.MAX_COVER_BYTES, MAX_COVER_BYTES);
});

test('T40 chemin : la pochette est rangée à côté du jeu dans « Mes fichiers », sous le nom que la liste des jeux reconnaît', () => {
  assert.equal(localCoverPath({ file: 'roms/amiga/Gods.adf' }), 'roms/amiga/Gods.png');
  assert.equal(localCoverPath({ file: 'roms/amiga/Leander (Disk 1 of 3).adf' }), 'roms/amiga/Leander (Disk 1 of 3).png');
  assert.equal(localCoverPath({ file: 'roms/neogeo/viewpoin.zip' }), 'roms/neogeo/viewpoin.png');
});

// ---- Import : pochette trouvée et gardée ----

test('T40 import : la pochette d\'un jeu importé est téléchargée une fois et gardée dans « Mes fichiers », à côté du jeu', async () => {
  const library = fakeLibrary(['roms/amiga/Gods.adf']);
  const { net, calls } = fakeGithub({ Fake_Amiga: [file('Gods (USA).png'), file('Gods (Europe).png')] });
  const summary = await run(library, net);
  assert.deepEqual(summary.found.map((f) => f.path), ['roms/amiga/Gods.png']);
  const blob = library.files.get('roms/amiga/Gods.png');
  assert.equal(blob.type, 'image/png');
  assert.deepEqual(new Uint8Array(await blob.arrayBuffer()), PNG);
  assert.deepEqual(calls.bytes, ['https://raw.githubusercontent.com/libretro-thumbnails/Fake_Amiga/HEAD/Named_Boxarts/Gods%20(Europe).png']);
  // La liste des jeux voit désormais la pochette (même règle que le générateur du Mac).
  assert.equal(gamesOf(library).find((g) => g.title === 'Gods').cover, 'roms/amiga/Gods.png');
});

test('T40 import : un jeu à plusieurs disquettes reçoit une seule pochette, reconnue par sa tuile', async () => {
  const library = fakeLibrary(['roms/amiga/Leander (Disk 1 of 3).adf', 'roms/amiga/Leander (Disk 2 of 3).adf', 'roms/amiga/Leander (Disk 3 of 3).adf']);
  const { net } = fakeGithub({ Fake_Amiga: [file('Leander (Europe).png')] });
  const summary = await run(library, net);
  assert.equal(summary.found.length, 1);
  const [game] = gamesOf(library);
  assert.equal(game.title, 'Leander');
  assert.ok(game.cover, 'la tuile de Leander a sa pochette');
});

test('T40 import : une relance ne retélécharge rien (« Déjà présentes »), et une image déjà là n\'est jamais remplacée', async () => {
  const library = fakeLibrary(['roms/amiga/Gods.adf']);
  const { net, calls } = fakeGithub({ Fake_Amiga: [file('Gods.png')] });
  await run(library, net);
  const second = await run(library, net);
  assert.equal(second.found.length, 0);
  assert.equal(second.alreadyHave, 1);
  assert.equal(calls.bytes.length, 1);
});

test('T40 import : un fichier du même nom présent dans la bibliothèque (autre extension que .png comprise) n\'est pas écrasé', async () => {
  const library = fakeLibrary(['roms/amiga/Gods.adf']);
  const original = new Blob(['MON IMAGE']);
  const { net } = fakeGithub({ Fake_Amiga: [file('Gods.png')] });
  // Une image apparue entre la liste des jeux et l'écriture (autre onglet) : on n'y touche pas.
  const games = gamesOf(library);
  library.files.set('roms/amiga/Gods.png', original);
  const summary = await findLocalCovers({ systems: SYSTEMS, games, library, net, listings: memoryListings(), now: NOW });
  assert.equal(library.files.get('roms/amiga/Gods.png'), original);
  assert.equal(summary.found.length, 0);
  assert.equal(summary.alreadyHave, 1);
});

// ---- Jeu sans pochette et erreurs : jamais d'échec de l'import ----

test('T40 sans pochette : un jeu absent de la base ne fait pas échouer la recherche, rien n\'est écrit', async () => {
  const library = fakeLibrary(['roms/amiga/Mon jeu maison.adf', 'roms/amiga/Gods.adf']);
  const { net } = fakeGithub({ Fake_Amiga: [file('Gods.png')] });
  const summary = await run(library, net);
  assert.deepEqual(summary.notFound, ['Mon jeu maison']);
  assert.equal(summary.found.length, 1);
  assert.equal(library.files.has('roms/amiga/Mon jeu maison.png'), false);
  assert.equal(gamesOf(library).find((g) => g.title === 'Mon jeu maison').cover, null, 'la tuile garde son nom');
});

test('T40 sans pochette : plusieurs images possibles = rien de téléchargé (on ne devine pas)', async () => {
  const library = fakeLibrary(['roms/neogeo/Metal Slug 3.zip']);
  const { net, calls } = fakeGithub({ Fake_NeoGeo: [file('Metal Slug 3 (NGH-2560).png'), file('Metal Slug 3 (NGM-2560).png')] });
  const summary = await run(library, net);
  assert.equal(summary.ambiguous.length, 1);
  assert.equal(calls.bytes.length, 0);
});

test('T40 sans réseau : GitHub injoignable ou limite atteinte = résumé d\'erreur, aucune exception, rien d\'écrit', async () => {
  const library = fakeLibrary(['roms/amiga/Gods.adf']);
  const { net } = fakeGithub({}, { failJson: 'limite de requêtes de GitHub atteinte, réessayez dans une heure' });
  const summary = await run(library, net);
  assert.equal(summary.listingErrors.length, 1);
  assert.equal(library.files.size, 1);
  assert.match(describeCoversResult(summary), /limite de requêtes/);
});

test('T40 erreurs : une image refusée (pas un PNG, trop grande, téléchargement coupé) n\'empêche pas les autres', async () => {
  const library = fakeLibrary(['roms/amiga/Gods.adf', 'roms/amiga/Zool.adf', 'roms/amiga/Lotus.adf', 'roms/amiga/Rick.adf']);
  const repo = { Fake_Amiga: [file('Gods.png'), file('Zool.png'), file('Lotus.png', { size: MAX_COVER_BYTES + 1 }), file('Rick.png')] };
  const { net } = fakeGithub(repo, {
    bytes: (url) => {
      if (url.includes('Zool')) return new Uint8Array([60, 104, 116, 109, 108, 62, 0, 0, 0]);
      if (url.includes('Rick')) throw new Error('image trop volumineuse');
      return PNG;
    },
  });
  const summary = await run(library, net);
  assert.deepEqual(summary.found.map((f) => f.title), ['Gods']);
  assert.deepEqual(summary.failed.map((f) => f.title).sort(), ['Lotus', 'Rick', 'Zool']);
  assert.equal(library.files.has('roms/amiga/Zool.png'), false);
  assert.equal(library.files.has('roms/amiga/Lotus.png'), false);
});

test('T40 erreurs : une bibliothèque qui refuse l\'écriture (plus de place) compte un échec sans exception', async () => {
  const library = fakeLibrary(['roms/amiga/Gods.adf']);
  library.put = async () => { throw new Error('QuotaExceededError'); };
  const { net } = fakeGithub({ Fake_Amiga: [file('Gods.png')] });
  const summary = await run(library, net);
  assert.equal(summary.failed.length, 1);
});

// ---- Périmètre : seulement des images, seulement les jeux de « Mes fichiers » sans pochette ----

test('T40 périmètre : seuls les jeux de « Mes fichiers » sans pochette sont cherchés ; machine sans base signalée', async () => {
  const library = fakeLibrary(['roms/amiga/Gods.adf', 'roms/amiga/Zool.adf', 'roms/amiga/Zool.jpg', 'roms/nes/homebrew.nes']);
  const macGame = { id: 'amiga-lotus', system: 'amiga', title: 'Lotus', file: 'roms/amiga/Lotus.adf', cover: null };
  const { net, calls } = fakeGithub({ Fake_Amiga: [file('Gods.png'), file('Zool.png'), file('Lotus.png')] });
  const summary = await findLocalCovers({ systems: SYSTEMS, games: [...gamesOf(library), macGame], library, net, listings: memoryListings(), now: NOW });
  assert.deepEqual(summary.found.map((f) => f.title), ['Gods']);
  assert.equal(summary.alreadyHave, 1, 'Zool a déjà sa jaquette');
  assert.deepEqual(summary.noRepo, ['NES']);
  assert.ok(calls.bytes.every((u) => !u.includes('Lotus')), 'un jeu du disque du Mac n\'est pas concerné');
});

test('T40 périmètre : seules des lectures d\'images sur GitHub (libretro-thumbnails), aucun jeu téléchargé', async () => {
  const library = fakeLibrary(['roms/amiga/Gods.adf', 'roms/neogeo/Viewpoint.zip']);
  const { net, calls } = fakeGithub({ Fake_Amiga: [file('Gods.png')], Fake_NeoGeo: [file('Viewpoint.png')] });
  await run(library, net);
  for (const url of calls.json) assert.match(url, /^https:\/\/api\.github\.com\/repos\/libretro-thumbnails\/Fake_(Amiga|NeoGeo)\/git\/trees\//);
  for (const url of calls.bytes) assert.match(url, /^https:\/\/raw\.githubusercontent\.com\/libretro-thumbnails\/Fake_(Amiga|NeoGeo)\/HEAD\/Named_Boxarts\/[^/]+\.png$/);
  assert.ok([...library.files.keys()].filter((p) => p.endsWith('.png')).length === 2);
});

test('T40 aucun jeu : rien à chercher, aucun appel réseau, texte null', async () => {
  const { net, calls } = fakeGithub({});
  const summary = await run(fakeLibrary([]), net);
  assert.equal(calls.json.length + calls.bytes.length, 0);
  assert.equal(describeCoversResult(summary), null);
});

test('T40 avancement : lecture de la liste par machine puis un pas par jeu', async () => {
  const library = fakeLibrary(['roms/amiga/Gods.adf', 'roms/amiga/Zool.adf']);
  const { net } = fakeGithub({ Fake_Amiga: [file('Gods.png'), file('Zool.png')] });
  const events = [];
  await run(library, net, { onProgress: (e) => events.push(e) });
  assert.deepEqual(events[0], { phase: 'listing', system: 'Amiga', done: 0, total: 2 });
  assert.deepEqual(events.at(-1), { phase: 'downloading', done: 2, total: 2 });
});

// ---- Cache des listes (limite de 60 requêtes par heure de GitHub) ----

test('T40 cache : la liste d\'une machine est relue au plus une fois par semaine', async () => {
  const listings = memoryListings();
  const { net, calls } = fakeGithub({ Fake_Amiga: [file('Gods.png'), file('Zool.png')] });
  const lib1 = fakeLibrary(['roms/amiga/Gods.adf']);
  await findLocalCovers({ systems: SYSTEMS, games: gamesOf(lib1), library: lib1, net, listings, now: NOW });
  assert.equal(calls.json.length, 2);
  const lib2 = fakeLibrary(['roms/amiga/Zool.adf']);
  await findLocalCovers({ systems: SYSTEMS, games: gamesOf(lib2), library: lib2, net, listings, now: new Date(NOW.getTime() + 6 * 24 * 3600 * 1000) });
  assert.equal(calls.json.length, 2, 'liste en cache');
  assert.ok(lib2.files.has('roms/amiga/Zool.png'));
  const lib3 = fakeLibrary(['roms/amiga/Gods.adf']);
  await findLocalCovers({ systems: SYSTEMS, games: gamesOf(lib3), library: lib3, net, listings, now: new Date(NOW.getTime() + 8 * 24 * 3600 * 1000) });
  assert.equal(calls.json.length, 4, 'liste périmée relue');
});

test('T40 cache : un cache illisible ou qui refuse l\'écriture ne bloque rien', async () => {
  const listings = { get: async () => { throw new Error('IDB'); }, set: async () => { throw new Error('IDB'); } };
  const library = fakeLibrary(['roms/amiga/Gods.adf']);
  const { net } = fakeGithub({ Fake_Amiga: [file('Gods.png')] });
  const summary = await findLocalCovers({ systems: SYSTEMS, games: gamesOf(library), library, net, listings, now: NOW });
  assert.equal(summary.found.length, 1);
});

function fakeIndexedDB() {
  const stores = new Map();
  const request = (fn) => { const r = {}; queueMicrotask(() => { try { r.result = fn(); r.onsuccess?.(); } catch (e) { r.error = e; r.onerror?.(); } }); return r; };
  const db = {
    objectStoreNames: { contains: (n) => stores.has(n) },
    createObjectStore: (n) => { stores.set(n, new Map()); },
    transaction: (n) => ({ objectStore: () => {
      const s = stores.get(n);
      return { put: (rec) => request(() => { s.set(rec.repo, rec); }), get: (k) => request(() => s.get(k)) };
    } }),
  };
  const opened = [];
  return { stores, opened, open: (name, version) => { opened.push({ name, version }); const r = {}; queueMicrotask(() => { r.result = db; r.onupgradeneeded?.(); r.onsuccess?.(); }); return r; } };
}

test('T40 cache : base IndexedDB à part (clone90-covers), jamais la bibliothèque des jeux (partagée avec sw.js)', async () => {
  const idb = fakeIndexedDB();
  const cache = await openListingsCache(idb);
  assert.equal(await cache.get('Fake_Amiga'), null);
  await cache.set('Fake_Amiga', { fetchedAt: NOW.toISOString(), files: [file('Gods.png')] });
  assert.equal((await cache.get('Fake_Amiga')).files[0].name, 'Gods.png');
  assert.deepEqual(idb.opened, [{ name: COVERS_DB.name, version: COVERS_DB.version }]);
  assert.notEqual(COVERS_DB.name, 'clone90-local');
  const none = await openListingsCache(null);
  assert.equal(await none.get('x'), null, 'sans IndexedDB : pas de cache, pas d\'erreur');
  await none.set('x', {});
});

// ---- Accès réseau du navigateur ----

test('T40 navigateur : lecture sans cookie ni adresse du site (referrer), refus d\'une redirection ; limite de GitHub en français', async () => {
  const seen = [];
  const ok = async (url, init) => { seen.push(init); return new Response(JSON.stringify({ tree: [] }), { status: 200 }); };
  assert.deepEqual(await browserFetchJson('https://api.github.com/x', ok), { tree: [] });
  assert.equal(seen[0].credentials, 'omit');
  assert.equal(seen[0].referrerPolicy, 'no-referrer');
  assert.equal(seen[0].redirect, 'error');
  assert.equal(seen[0].headers, undefined, 'aucun en-tête ajouté (pas de requête préalable CORS)');
  await assert.rejects(browserFetchJson('u', async () => new Response('', { status: 403 })), /limite de requêtes de GitHub/);
  await assert.rejects(browserFetchJson('u', async () => new Response('', { status: 500 })), /GitHub a répondu 500/);
  await assert.rejects(browserFetchJson('u', async () => { throw new TypeError('Failed to fetch'); }), /^Error: GitHub injoignable \(pas de connexion à Internet \?\)$/);
  await assert.rejects(browserFetchBytes('u', { maxBytes: 5, fetchFn: async () => { throw new TypeError('Failed to fetch'); } }), /GitHub injoignable/);
});

test('T40 navigateur : image de plus de 2 Mo refusée, d\'après Content-Length puis pendant la lecture', async () => {
  const bytes = await browserFetchBytes('u', { maxBytes: 100, fetchFn: async () => new Response(PNG) });
  assert.deepEqual(bytes, PNG);
  await assert.rejects(browserFetchBytes('u', { maxBytes: 100, fetchFn: async () => new Response(new Uint8Array(10), { headers: { 'content-length': '500' } }) }), /trop volumineuse/);
  await assert.rejects(browserFetchBytes('u', { maxBytes: 5, fetchFn: async () => new Response(new Uint8Array(10)) }), /trop volumineuse/);
  await assert.rejects(browserFetchBytes('u', { maxBytes: 5, fetchFn: async () => new Response('', { status: 404 }) }), /404/);
});

// ---- Textes ----

test('T40 texte : résumé court en français, zéros omis', () => {
  const base = { found: [], alreadyHave: 0, notFound: [], ambiguous: [], failed: [], listingErrors: [], noRepo: [] };
  assert.equal(describeCoversResult({ ...base, found: [{}, {}], notFound: ['a'] }), 'Pochettes : 2 ajoutées, 1 introuvable');
  assert.equal(describeCoversResult({ ...base, found: [{}], ambiguous: [{}, {}], failed: [{}] }), 'Pochettes : 1 ajoutée, 2 avec plusieurs choix possibles, 1 échec');
  assert.equal(describeCoversResult({ ...base, alreadyHave: 3 }), 'Pochettes : toutes déjà présentes');
  assert.equal(describeCoversResult({ ...base, notFound: ['a', 'b'] }), 'Pochettes : 2 introuvables');
  assert.equal(describeCoversResult({ ...base, listingErrors: [{ system: 'Amiga', reason: 'GitHub a répondu 500' }] }), 'Pochettes indisponibles pour Amiga : GitHub a répondu 500');
  assert.equal(describeCoversResult({ ...base, noRepo: ['NES'] }), null, 'machine sans base seulement : rien à dire');
});

// ---- Écran « Mes fichiers » ----

class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...items) { this.children.push(...items); }
  addEventListener(t, f) { this.listeners[t] = f; }
  walk(fn) { fn(this); this.children.forEach((c) => c.walk?.(fn)); }
}
const doc = { createElement: (t) => new FakeNode(t), createTextNode: (s) => ({ text: s }) };
const find = (root, pred) => { const out = []; root.walk((n) => pred(n) && out.push(n)); return out; };
const SYSTEMS_JSON = JSON.parse(readFileSync(join(PROJECT_ROOT, 'systems.json'), 'utf8')).systems;
const noop = () => {};
const screen = (extra = {}) => renderLibrary({ systems: SYSTEMS_JSON, entries: [], supported: true, onAddGames: noop, onAddBios: noop, onRemove: noop, ...extra }, doc);
const texts = (root) => find(root, (n) => n.textContent).map((n) => n.textContent);

test('T40 écran : bouton « Chercher les pochettes manquantes », navigable, avec la phrase sur la connexion à GitHub', () => {
  let clicked = 0;
  const root = screen({ onFindCovers: () => { clicked += 1; } });
  const [button] = find(root, (n) => n.tag === 'button' && n.dataset.navId === FIND_COVERS_NAV_ID);
  assert.ok(button, 'bouton présent');
  assert.equal(button.textContent, 'Chercher les pochettes manquantes');
  assert.equal(button.dataset.nav, '');
  button.listeners.click();
  assert.equal(clicked, 1);
  assert.ok(texts(root).includes(COVERS_LIBRARY_INFO));
  assert.match(COVERS_LIBRARY_INFO, /github\.com/);
  assert.match(COVERS_LIBRARY_INFO, /adresse IP/);
  assert.match(COVERS_LIBRARY_INFO, /noms des jeux/);
  assert.match(COVERS_LIBRARY_INFO, /images/);
});

test('T40 écran : pendant la recherche, boutons désactivés et avancement affiché', () => {
  const root = screen({ busy: true, busyText: 'Recherche des pochettes : 1 sur 3…' });
  const [button] = find(root, (n) => n.tag === 'button' && n.dataset.navId === FIND_COVERS_NAV_ID);
  assert.ok('disabled' in button.attrs);
  assert.ok(texts(root).includes('Recherche des pochettes : 1 sur 3…'));
  assert.ok(texts(screen({ busy: true })).includes('Copie des fichiers en cours…'), 'texte par défaut inchangé');
});

test('T40 écran : navigateur incompatible = pas de recherche possible', () => {
  const root = screen({ supported: false });
  const [button] = find(root, (n) => n.tag === 'button' && n.dataset.navId === FIND_COVERS_NAV_ID);
  assert.ok('disabled' in button.attrs);
});
