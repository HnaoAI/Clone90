// Tests de T27 (jouer sur téléphone sans le Mac) : bibliothèque locale (noms, chemins, BIOS, IndexedDB factice), jeux locaux,
// fusion avec games.json, route « Mes fichiers », service worker (réponse locale, jamais de cache) et écran « Mes fichiers ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/serve.mjs';
import { LOCAL_DB, sanitizeFileName, romStoragePath, biosStoragePath, describeBiosStatus, openLocalLibrary, canUseLocalLibrary } from '../js/local-library.js';
import { buildLocalGames, loadLocalGames, textPaths } from '../js/local-games.js';
import { loadData } from '../js/data.js';
import { parseHash, buildHash, LIBRARY_SEGMENT } from '../js/router.js';
import { resolveRoute } from '../js/screens.js';
import { formatSize, groupLibraryEntries, describeImport, renderLibrary, addGamesNavId } from '../js/ui/library-screen.js';
import { renderHome, LIBRARY_NAV_ID } from '../js/ui/machine-grid.js';
import { renderGameGrid, ADD_LOCAL_NAV_ID } from '../js/ui/game-grid.js';
import { buildLaunchPlan, describeMissing } from '../js/player/launcher.js';

const SYSTEMS = JSON.parse(readFileSync(join(PROJECT_ROOT, 'systems.json'), 'utf8')).systems;
const amiga = SYSTEMS.find((s) => s.id === 'amiga');
const neogeo = SYSTEMS.find((s) => s.id === 'neogeo');

// --- Noms et chemins ---
test('T27 noms : le nom choisi sur le téléphone ne crée jamais de dossier ni de fichier caché', () => {
  assert.equal(sanitizeFileName('Leander (Disk 1 of 3).adf'), 'Leander (Disk 1 of 3).adf');
  assert.equal(sanitizeFileName('../../etc/passwd'), 'passwd');
  assert.equal(sanitizeFileName('C:\\Jeux\\mslug.zip'), 'mslug.zip');
  assert.equal(sanitizeFileName('.cache.adf'), 'cache.adf');
  assert.equal(sanitizeFileName('a\u0000b\nc.nes'), 'abc.nes');
  assert.equal(sanitizeFileName('..'), null);
  assert.equal(sanitizeFileName(''), null);
  assert.equal(sanitizeFileName('dossier/'), null);
  assert.equal(sanitizeFileName(undefined), null);
  assert.equal(sanitizeFileName('Été à Paris #1 ?.sfc'), 'Été à Paris #1 ?.sfc');
});

test('T27 chemins : un jeu est rangé sous roms/<machine>/, comme sur le Mac', () => {
  assert.equal(romStoragePath('amiga', 'Gods.adf'), 'roms/amiga/Gods.adf');
  assert.equal(romStoragePath('amiga', '../x.adf'), 'roms/amiga/x.adf');
  assert.equal(romStoragePath('Amiga/..', 'x.adf'), null, 'id de machine invalide');
  assert.equal(romStoragePath('amiga', ''), null);
});

test('T27 BIOS : nom exact déclaré dans systems.json retrouvé sans tenir compte de la casse, sinon gardé tel quel et signalé', () => {
  assert.deepEqual(biosStoragePath('KICK40068.a1200', SYSTEMS), { path: 'bios/kick40068.A1200', known: true });
  assert.deepEqual(biosStoragePath('NeoGeo.ZIP', SYSTEMS), { path: 'bios/neogeo.zip', known: true });
  assert.deepEqual(biosStoragePath('Kickstart 3.1.rom', SYSTEMS), { path: 'bios/Kickstart 3.1.rom', known: false });
  assert.equal(biosStoragePath('', SYSTEMS), null);
});

test('T27 BIOS attendus : requis ou par défaut, présence lue dans la bibliothèque', () => {
  const status = describeBiosStatus(SYSTEMS, ['bios/kick40068.A1200']);
  const kick = status.find((b) => b.systemId === 'amiga');
  assert.deepEqual(kick, { systemId: 'amiga', systemName: 'Amiga', file: 'kick40068.A1200', required: true, present: true });
  assert.equal(status.find((b) => b.systemId === 'neogeo').present, false);
  assert.ok(status.every((b) => b.required || SYSTEMS.find((s) => s.id === b.systemId).bios.find((x) => x.file === b.file).role === 'default'));
  assert.deepEqual(describeBiosStatus([{ id: 'snes', name: 'SNES' }], []), []);
});

// --- IndexedDB factice (ce que le module utilise seulement) ---
function fakeIndexedDB() {
  const stores = new Map();
  const request = (fn) => { const r = {}; queueMicrotask(() => { try { r.result = fn(); r.onsuccess?.(); } catch (e) { r.error = e; r.onerror?.(); } }); return r; };
  const db = {
    objectStoreNames: { contains: (n) => stores.has(n) },
    createObjectStore: (n) => { stores.set(n, new Map()); },
    transaction: (n) => ({ objectStore: () => {
      const s = stores.get(n);
      return {
        put: (rec) => request(() => { s.set(rec.path, rec); }),
        get: (k) => request(() => s.get(k)),
        getAll: () => request(() => [...s.values()]),
        delete: (k) => request(() => { s.delete(k); }),
      };
    } }),
  };
  return {
    stores,
    open: (name, version) => {
      const r = {};
      queueMicrotask(() => { r.result = db; r.onupgradeneeded?.(); r.onsuccess?.(); });
      r.args = { name, version };
      return r;
    },
  };
}

test('T27 bibliothèque : ajouter, lister (sans les octets), lire un texte, supprimer', async () => {
  const idb = fakeIndexedDB();
  const lib = await openLocalLibrary(idb);
  await lib.put('roms/amiga/Gods.m3u', new Blob(['disk1.adf\n']));
  await lib.put('roms/amiga/big.adf', new Blob([new Uint8Array(901120)]));
  const list = await lib.list();
  assert.deepEqual(list.map((e) => [e.path, e.size]).sort(), [['roms/amiga/Gods.m3u', 10], ['roms/amiga/big.adf', 901120]]);
  assert.ok(list.every((e) => !('blob' in e)));
  assert.equal(await lib.readText('roms/amiga/Gods.m3u'), 'disk1.adf\n');
  assert.equal(await lib.readText('roms/amiga/big.adf'), '', 'un gros fichier n\'est jamais lu comme texte');
  assert.equal(await lib.readText('absent'), '');
  await lib.remove('roms/amiga/big.adf');
  assert.equal((await lib.list()).length, 1);
  assert.equal(await lib.get('roms/amiga/big.adf'), null);
  assert.ok(idb.stores.has(LOCAL_DB.store));
});

test('T27 bibliothèque : sans IndexedDB, erreur claire ; canUseLocalLibrary exige IndexedDB, HTTPS et service worker', async () => {
  await assert.rejects(openLocalLibrary(null), /ne permet pas/);
  assert.equal(canUseLocalLibrary({ indexedDB: {}, isSecureContext: true, navigator: { serviceWorker: {} } }), true);
  assert.equal(canUseLocalLibrary({ indexedDB: {}, isSecureContext: false, navigator: { serviceWorker: {} } }), false);
  assert.equal(canUseLocalLibrary({ indexedDB: {}, isSecureContext: true, navigator: {} }), false);
  assert.equal(canUseLocalLibrary({ isSecureContext: true, navigator: { serviceWorker: {} } }), false);
});

// --- Jeux locaux ---
test('T27 jeux locaux : mêmes règles que le générateur (disquettes Amiga regroupées, titres arcade), chemins roms/<machine>/', () => {
  const paths = [
    'roms/amiga/Leander (Disk 1 of 3).adf', 'roms/amiga/Leander (Disk 2 of 3).adf', 'roms/amiga/Leander (Disk 3 of 3).adf',
    'roms/neogeo/mslug.zip', 'bios/neogeo.zip', 'roms/inconnue/x.zip', 'roms/amiga/sous/dossier.adf',
  ];
  const games = buildLocalGames({ systems: SYSTEMS, paths, titles: { mslug: 'Metal Slug' } });
  const leander = games.find((g) => g.system === 'amiga');
  assert.equal(games.length, 2);
  assert.equal(leander.title, 'Leander');
  assert.deepEqual(leander.disks, ['roms/amiga/Leander (Disk 1 of 3).adf', 'roms/amiga/Leander (Disk 2 of 3).adf', 'roms/amiga/Leander (Disk 3 of 3).adf']);
  assert.equal(leander.local, true);
  const mslug = games.find((g) => g.system === 'neogeo');
  assert.deepEqual([mslug.id, mslug.title, mslug.file], ['neogeo/mslug', 'Metal Slug', 'roms/neogeo/mslug.zip']);
});

test('T27 jeux locaux : .cue Mega-CD avec ses .bin, .m3u et .bios lus par chemin complet', () => {
  const paths = ['roms/megacd/Sonic CD.cue', 'roms/megacd/Sonic CD.bin', 'roms/amiga/Old.adf', 'roms/amiga/Old.bios'];
  const texts = { 'roms/megacd/Sonic CD.cue': 'FILE "Sonic CD.bin" BINARY\n', 'roms/amiga/Old.bios': 'kick34005.A500\n' };
  const games = buildLocalGames({ systems: SYSTEMS, paths, texts });
  assert.deepEqual(games.find((g) => g.system === 'megacd').extraFiles, [{ file: 'roms/megacd/Sonic CD.bin', as: 'Sonic CD.bin' }]);
  assert.equal(games.find((g) => g.system === 'amiga').bios, 'kick34005.A500');
  assert.deepEqual(textPaths(paths), ['roms/megacd/Sonic CD.cue', 'roms/amiga/Old.bios']);
  assert.deepEqual(buildLocalGames({ systems: SYSTEMS, paths: [] }), []);
});

test('T27 loadLocalGames : lit la bibliothèque, ne lève jamais (base refusée = aucun jeu)', async () => {
  const library = { list: async () => [{ path: 'roms/neogeo/mslug.zip', size: 1 }], readText: async () => '' };
  const games = await loadLocalGames(SYSTEMS, { openLibrary: async () => library, fetchJson: async () => ({ mslug: 'Metal Slug' }) });
  assert.deepEqual(games.map((g) => g.title), ['Metal Slug']);
  const noTitles = await loadLocalGames(SYSTEMS, { openLibrary: async () => library, fetchJson: async () => { throw new Error('404'); } });
  assert.deepEqual(noTitles.map((g) => g.title), ['mslug']);
  assert.deepEqual(await loadLocalGames(SYSTEMS, { openLibrary: async () => { throw new Error('refus'); } }), []);
  assert.deepEqual(await loadLocalGames(SYSTEMS, { openLibrary: async () => ({ list: async () => [{ path: 'bios/neogeo.zip' }] }) }), []);
});

// --- Fusion avec games.json ---
const fakeFetch = (files) => async (url) => {
  if (!(url in files)) { const e = new Error('404'); e.status = 404; throw e; }
  return files[url];
};
const sysJson = { version: 1, systems: [amiga, neogeo] };

test('T27 loadData : sur GitHub Pages (games.json absent), les jeux du téléphone suffisent, statut ok', async () => {
  const data = await loadData(fakeFetch({ 'systems.json': sysJson }), async () => [{ id: 'neogeo/mslug', system: 'neogeo', title: 'Metal Slug', file: 'roms/neogeo/mslug.zip', cover: null }]);
  assert.equal(data.gamesStatus, 'ok');
  assert.equal(data.localCount, 1);
  assert.equal(data.games[0].local, true);
});

test('T27 loadData : un jeu de games.json garde la priorité sur un jeu local de même id ; jeu local invalide écarté', async () => {
  const server = { id: 'neogeo/mslug', system: 'neogeo', title: 'Serveur', file: 'roms/neogeo/mslug.zip', cover: null };
  const data = await loadData(fakeFetch({ 'systems.json': sysJson, 'games.json': { version: 1, games: [server] } }), async () => [
    { ...server, title: 'Local' }, { id: 'amiga/x', system: 'amiga', title: 'X', file: '../x.adf', cover: null },
  ]);
  assert.deepEqual(data.games.map((g) => g.title), ['Serveur']);
  assert.equal(data.localCount, 0);
});

test('T27 loadData : sans bibliothèque (Mac) ou bibliothèque en erreur, rien ne change', async () => {
  const files = { 'systems.json': sysJson };
  assert.equal((await loadData(fakeFetch(files))).gamesStatus, 'absent');
  const failing = await loadData(fakeFetch(files), async () => { throw new Error('IndexedDB'); });
  assert.equal(failing.gamesStatus, 'absent');
  assert.deepEqual(failing.games, []);
});

// --- Route ---
test('T27 route : #/fichiers et #/fichiers?machine=<id> (aller-retour), machine inconnue ignorée', () => {
  assert.deepEqual(parseHash('#/fichiers'), { name: 'library', machine: null });
  assert.deepEqual(parseHash('#/fichiers?machine=amiga'), { name: 'library', machine: 'amiga' });
  assert.deepEqual(parseHash('#/fichiers?machine=..%2Fx'), { name: 'library', machine: null });
  assert.equal(buildHash({ name: 'library' }), '#/fichiers');
  assert.equal(buildHash({ name: 'library', machine: 'neogeo' }), '#/fichiers?machine=neogeo');
  assert.deepEqual(resolveRoute({ name: 'library', machine: 'amiga' }, [amiga]), { name: 'library', machine: 'amiga' });
  assert.deepEqual(resolveRoute({ name: 'library', machine: 'nes' }, [amiga]), { name: 'library', machine: null });
  assert.ok(!SYSTEMS.some((s) => s.id === LIBRARY_SEGMENT), 'aucune machine ne doit s\'appeler comme l\'écran Mes fichiers');
});

// --- Service worker ---
const swSandbox = { URL, decodeURIComponent, self: { addEventListener: () => {} } };
vm.runInNewContext(readFileSync(join(PROJECT_ROOT, 'sw.js'), 'utf8'), swSandbox);
const sw = swSandbox.self.Clone90SW;
const PAGES = 'https://hnaoai.github.io/Clone90/';

test('T27 service worker : même base IndexedDB que la page', () => {
  assert.deepEqual({ ...sw.LOCAL_DB }, { ...LOCAL_DB });
});

test('T27 service worker : GET et HEAD vers roms/ et bios/ cherchés dans la bibliothèque locale, rien d\'autre', () => {
  assert.equal(sw.localLibraryPath('GET', `${PAGES}roms/amiga/Leander%20(Disk%201%20of%203).adf`, PAGES), 'roms/amiga/Leander (Disk 1 of 3).adf');
  assert.equal(sw.localLibraryPath('HEAD', `${PAGES}bios/kick40068.A1200`, PAGES), 'bios/kick40068.A1200');
  assert.equal(sw.localLibraryPath('POST', `${PAGES}roms/amiga/x.adf`, PAGES), null);
  assert.equal(sw.localLibraryPath('GET', `${PAGES}games.json`, PAGES), null);
  assert.equal(sw.localLibraryPath('GET', `${PAGES}js/app.js`, PAGES), null);
  assert.equal(sw.localLibraryPath('GET', 'https://cdn.emulatorjs.org/4.2.3/data/loader.js', PAGES), null);
  assert.equal(sw.localLibraryPath('GET', `${PAGES}roms/%2E%2E/x`, PAGES), null);
  assert.equal(sw.localLibraryPath('GET', `${PAGES}roms/%E0%A4%A`, PAGES), null, 'encodage invalide : réseau');
});

test('T27 service worker : la réponse locale n\'est jamais mise en cache (no-store) et donne la taille', () => {
  const init = sw.localResponseInit({ size: 901120, blob: { type: '', size: 901120 } });
  assert.equal(init.status, 200);
  assert.equal(init.headers['Content-Length'], '901120');
  assert.equal(init.headers['Cache-Control'], 'no-store');
  assert.equal(init.headers['Content-Type'], 'application/octet-stream');
  const source = readFileSync(join(PROJECT_ROOT, 'sw.js'), 'utf8');
  const localBlock = source.slice(source.indexOf('const localPath = localLibraryPath'), source.indexOf('if (!shouldHandle('));
  assert.ok(localBlock.length > 0 && !/cache\.put|caches\.open/.test(localBlock), 'aucun cache dans la branche locale');
  assert.equal(sw.isShellPath('roms/amiga/x.adf'), false);
});

// --- Lanceur : mêmes adresses que sur le Mac ---
test('T27 lanceur : un jeu local se lance avec les mêmes adresses roms/ et bios/ que sur le Mac (servies par le service worker)', () => {
  const [game] = buildLocalGames({ systems: SYSTEMS, paths: ['roms/amiga/Gods.adf'] });
  const plan = buildLaunchPlan({ system: amiga, game, cdnUrl: 'https://cdn.example/' });
  assert.equal(plan.globals.EJS_gameUrl, 'roms/amiga/Gods.adf');
  assert.equal(plan.globals.EJS_biosUrl, 'bios/kick40068.A1200');
});

test('T27 messages : BIOS manquant propose « Mes fichiers » ; jeu local manquant ne parle pas de generate-games', () => {
  const [bios] = describeMissing([{ kind: 'bios', path: 'bios/kick40068.A1200' }]);
  assert.match(bios.detail, /kick40068\.A1200/);
  assert.match(bios.detail, /Mes fichiers/);
  const [local] = describeMissing([{ kind: 'game', path: 'roms/amiga/Gods.adf' }], { local: true });
  assert.match(local.detail, /Gods\.adf/);
  assert.match(local.detail, /Mes fichiers/);
  assert.doesNotMatch(local.detail, /generate-games/);
  assert.match(describeMissing([{ kind: 'game', path: 'roms/amiga/Gods.adf' }])[0].detail, /generate-games/, 'Mac inchangé');
});

// --- Écran « Mes fichiers » ---
test('T27 formatSize : o, Ko, Mo, Go en français', () => {
  assert.equal(formatSize(0), '0 o');
  assert.equal(formatSize(880), '880 o');
  assert.equal(formatSize(901120), '880 Ko');
  assert.equal(formatSize(1.4 * 1024 ** 2), '1,4 Mo');
  assert.equal(formatSize(2.1 * 1024 ** 3), '2,1 Go');
  assert.equal(formatSize(-5), '0 o');
  assert.equal(formatSize(NaN), '0 o');
});

test('T27 groupLibraryEntries : une rubrique par machine (ordre de systems.json), puis BIOS, puis autres', () => {
  const groups = groupLibraryEntries([
    { path: 'bios/neogeo.zip', size: 1 }, { path: 'roms/neogeo/mslug.zip', size: 2 }, { path: 'roms/amiga/Gods.adf', size: 3 }, { path: 'roms/vieille/x.bin', size: 4 },
  ], [amiga, neogeo]);
  assert.deepEqual(groups.map((g) => [g.title, g.files.map((f) => f.name)]), [['Amiga', ['Gods.adf']], ['Neo Geo', ['mslug.zip']], ['BIOS', ['neogeo.zip']], ['Autres fichiers', ['x.bin']]]);
  assert.deepEqual(groupLibraryEntries([], [amiga]), []);
});

test('T27 describeImport : nombre ajouté, noms illisibles, BIOS au nom inattendu', () => {
  assert.equal(describeImport({ added: 1 }), '1 fichier ajouté');
  assert.equal(describeImport({ added: 3 }), '3 fichiers ajoutés');
  assert.equal(describeImport({ added: 0, rejected: 2 }), 'Aucun fichier ajouté ; 2 noms illisibles');
  assert.match(describeImport({ added: 1, unknownBios: ['kick.rom'] }), /kick\.rom.*nom exact/);
});

class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...items) { this.children.push(...items); }
  addEventListener(t, f) { this.listeners[t] = f; }
  walk(fn) { fn(this); this.children.forEach((c) => c.walk?.(fn)); }
}
const doc = { createElement: (t) => new FakeNode(t), createTextNode: (s) => ({ text: s }) };
const find = (root, pred) => { const out = []; root.walk((n) => pred(n) && out.push(n)); return out; };

test('T27 renderLibrary : un bouton navigable par machine, bouton BIOS, suppression par fichier, actions transmises', () => {
  const calls = [];
  const root = renderLibrary({
    systems: [amiga, neogeo], entries: [{ path: 'roms/amiga/Gods.adf', size: 901120 }], supported: true, machine: 'amiga',
    onAddGames: (id) => calls.push(['games', id]), onAddBios: () => calls.push(['bios']), onRemove: (p) => calls.push(['remove', p]),
  }, doc);
  const buttons = find(root, (n) => n.tag === 'button');
  const byNav = (id) => buttons.find((b) => b.dataset.navId === id);
  assert.ok(buttons.every((b) => b.dataset.nav === ''));
  byNav(addGamesNavId('neogeo')).listeners.click();
  byNav('add-bios').listeners.click();
  byNav('del-roms/amiga/Gods.adf').listeners.click();
  assert.deepEqual(calls, [['games', 'neogeo'], ['bios'], ['remove', 'roms/amiga/Gods.adf']]);
  assert.match(byNav(addGamesNavId('amiga')).attrs.class, /is-selected/);
  const texts = find(root, (n) => n.textContent).map((n) => n.textContent);
  assert.ok(texts.some((t) => /\.adf/.test(t) && /Amiga/.test(t)), 'formats de la machine mise en avant');
  assert.ok(texts.includes('880 Ko'));
  assert.ok(texts.some((t) => /rien n'est envoyé/.test(t)));
});

test('T27 renderLibrary : navigateur incompatible ou copie en cours = boutons désactivés et message', () => {
  for (const model of [{ supported: false }, { supported: true, busy: true }]) {
    const root = renderLibrary({ systems: [amiga], entries: [], onAddGames() {}, onAddBios() {}, onRemove() {}, ...model }, doc);
    assert.ok(find(root, (n) => n.tag === 'button').every((b) => 'disabled' in b.attrs));
    assert.ok(find(root, (n) => /banner/.test(n.attrs.class ?? '')).length === 1);
  }
});

test('T27 accueil et grille : bouton « Mes fichiers » et « Ajouter des jeux » seulement si le navigateur le permet', () => {
  const linkTo = (root, navId) => find(root, (n) => n.dataset?.navId === navId)[0];
  assert.equal(linkTo(renderHome({ tiles: [], gamesStatus: 'absent', localSupported: true }, doc), LIBRARY_NAV_ID).attrs.href, '#/fichiers');
  assert.equal(linkTo(renderHome({ tiles: [], gamesStatus: 'absent' }, doc), LIBRARY_NAV_ID), undefined);
  assert.equal(linkTo(renderGameGrid({ machine: amiga, games: [], localSupported: true }, doc), ADD_LOCAL_NAV_ID).attrs.href, '#/fichiers?machine=amiga');
  assert.equal(linkTo(renderGameGrid({ machine: amiga, games: [] }, doc), ADD_LOCAL_NAV_ID), undefined);
  const [game] = buildLocalGames({ systems: SYSTEMS, paths: ['roms/amiga/Gods.adf'] });
  const ids = find(renderGameGrid({ machine: amiga, games: [game], localSupported: true }, doc), (n) => n.dataset?.navId === ADD_LOCAL_NAV_ID);
  assert.equal(ids.length, 1, 'un seul bouton d\'ajout, dans l\'en-tête quand la grille a des jeux');
});
