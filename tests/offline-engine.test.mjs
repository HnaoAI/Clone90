// Tests T46 « jouer hors ligne » : fichiers d'EmulatorJS à garder (js/player/ejs-files.js, via launcher.js) et préparation
// du cache du moteur depuis « Mes fichiers » (js/offline-engine.js). Faux Cache Storage et faux fetch, aucun réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/serve.mjs';
import { EJS_CDN_VERSION } from '../js/config.js';
import { ejsCoreFor, engineReportUrl, engineFiles, engineVersionOf, ENGINE_BASE_FILES } from '../js/player/launcher.js';
import {
  ENGINE_CACHE_PREFIX, engineCacheName, machinesWithGames, prepareOfflineEngine, describeOfflineResult, offlineEngineSupported,
} from '../js/offline-engine.js';

const systems = JSON.parse(readFileSync(join(PROJECT_ROOT, 'systems.json'), 'utf8')).systems;
const byId = (id) => systems.find((s) => s.id === id);
const nes = byId('nes');
const amiga = byId('amiga');
const CDN = `https://cdn.emulatorjs.org/${EJS_CDN_VERSION}/data/`;

test('T46 cœur EmulatorJS : chaque machine de systems.json a un vrai nom de cœur (celui que télécharge EmulatorJS 4.2.3)', () => {
  const expected = { amiga: 'puae', neogeo: 'fbneo', arcade: 'fbneo', mastersystem: 'smsplus', megadrive: 'genesis_plus_gx', gamegear: 'genesis_plus_gx',
    megacd: 'genesis_plus_gx', '32x': 'picodrive', nes: 'fceumm', snes: 'snes9x', gameboycolor: 'gambatte', pcengine: 'mednafen_pce', pcenginecd: 'mednafen_pce', gba: 'mgba' };
  for (const s of systems) assert.equal(ejsCoreFor(s.emulatorjsCore), expected[s.id], `${s.id} : nouvelle machine, ajouter son cœur ici`);
  assert.equal(ejsCoreFor('fceumm'), 'fceumm', 'un nom de cœur précis reste tel quel');
});

test('T49 jeu hors ligne : gambatte reste dans la liste des cœurs (utilisé par la Game Boy Color)', () => {
  assert.equal(ejsCoreFor(systems.find((s) => s.id === 'gameboycolor').emulatorjsCore), 'gambatte');
});

test('T46 version du moteur : celle de la machine (Amiga 4.2.1, T21), sinon la version par défaut', () => {
  assert.equal(engineVersionOf(nes), EJS_CDN_VERSION);
  assert.equal(engineVersionOf(amiga), amiga.ejsVersion ?? EJS_CDN_VERSION);
  assert.equal(engineReportUrl(nes), `${CDN}cores/reports/fceumm.json`);
  assert.ok(engineReportUrl(amiga).startsWith(`https://cdn.emulatorjs.org/${engineVersionOf(amiga)}/data/cores/reports/puae.json`));
});

test('T46 fichiers du moteur : loader, emulator.min, décompression, rapport et le cœur « legacy » quand le rapport ne demande pas WebGL 2', () => {
  const files = engineFiles({ system: nes, report: { buildStart: 1, options: { defaultWebGL2: false } }, webgl2: true, locale: 'en-US' });
  const urls = files.map((f) => f.url);
  for (const f of ['loader.js', 'emulator.min.js', 'emulator.min.css', 'compression/extract7z.js', 'compression/extractzip.js']) assert.ok(urls.includes(`${CDN}${f}`), f);
  assert.ok(urls.includes(`${CDN}cores/fceumm-legacy-wasm.data`));
  assert.ok(!urls.includes(`${CDN}cores/fceumm-wasm.data`));
  assert.equal(files.find((f) => f.url.endsWith('reports/fceumm.json')).optional, true);
  assert.equal(files.find((f) => f.url.endsWith('-wasm.data')).optional, false);
  assert.equal(new Set(urls).size, urls.length, 'pas de doublon');
  assert.ok(ENGINE_BASE_FILES.every((f) => !f.startsWith('/') && !f.includes('..')));
});

test('T46 fichiers du moteur : cœur WebGL 2 si le rapport le demande et que l\'appareil le sait, sinon « legacy »', () => {
  const report = { buildStart: 1, options: { defaultWebGL2: true } };
  assert.ok(engineFiles({ system: nes, report, webgl2: true }).some((f) => f.url === `${CDN}cores/fceumm-wasm.data`));
  assert.ok(engineFiles({ system: nes, report, webgl2: false }).some((f) => f.url === `${CDN}cores/fceumm-legacy-wasm.data`));
  assert.ok(engineFiles({ system: nes, report: null, webgl2: true }).some((f) => f.url === `${CDN}cores/fceumm-legacy-wasm.data`), 'rapport illisible : legacy (comme EmulatorJS)');
  assert.ok(engineFiles({ system: nes, report: 'pas un objet', webgl2: true }).some((f) => f.url.endsWith('fceumm-legacy-wasm.data')));
});

test('T46 fichiers du moteur : traduction de la langue de l\'appareil, facultative, et jamais un nom de langue douteux', () => {
  const withLocale = (locale) => engineFiles({ system: nes, report: null, webgl2: false, locale }).filter((f) => f.url.includes('/localization/'));
  assert.deepEqual(withLocale('fr-FR').map((f) => [f.url, f.optional]), [[`${CDN}localization/fr-FR.json`, true]]);
  assert.deepEqual(withLocale('../../x'), []);
  assert.deepEqual(withLocale(''), []);
  assert.deepEqual(withLocale(undefined), []);
  assert.deepEqual(withLocale('a'.repeat(80)), []);
});

test('T46 fichiers du moteur : l\'Amiga prend ses fichiers dans sa propre version', () => {
  const v = engineVersionOf(amiga);
  for (const f of engineFiles({ system: amiga, report: null, webgl2: false })) assert.ok(f.url.startsWith(`https://cdn.emulatorjs.org/${v}/data/`), f.url);
});

test('T46 nom du cache : clone90-ejs-<version>, distinct de la coquille', () => {
  assert.equal(engineCacheName('4.2.3'), 'clone90-ejs-4.2.3');
  assert.equal(ENGINE_CACHE_PREFIX, 'clone90-ejs-');
  assert.ok(!engineCacheName('4.2.3').startsWith('clone90-shell-'));
  assert.throws(() => engineCacheName('stable'));
  assert.throws(() => engineCacheName('../x'));
});

test('T46 machines à préparer : celles qui ont des jeux, dans l\'ordre de systems.json', () => {
  const games = [{ system: 'snes', id: 'snes/a' }, { system: 'nes', id: 'nes/b' }, { system: 'nes', id: 'nes/c' }, { system: 'inconnue', id: 'x' }];
  assert.deepEqual(machinesWithGames(systems, games).map((s) => s.id), systems.filter((s) => ['nes', 'snes'].includes(s.id)).map((s) => s.id));
  assert.deepEqual(machinesWithGames(systems, []), []);
  assert.deepEqual(machinesWithGames(systems, null), []);
});

/** Faux Cache Storage : Map de caches, chaque cache une Map url -> Response. */
function fakeCaches(initial = {}) {
  const store = new Map(Object.entries(initial).map(([name, urls]) => [name, new Map(urls.map((u) => [u, new Response('déjà')]))]));
  const open = async (name) => {
    if (!store.has(name)) store.set(name, new Map());
    const c = store.get(name);
    return { match: async (url) => c.get(String(url))?.clone(), put: async (url, res) => { c.set(String(url), res); } };
  };
  return { store, api: { open, keys: async () => [...store.keys()], delete: async (name) => store.delete(name) } };
}

/** Faux réseau : `files` url -> contenu (200), sinon 404 ; `offline` : tout lève comme sans réseau. */
function fakeFetch(files, { offline = false } = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (offline) throw new TypeError('Failed to fetch');
    return url in files ? new Response(files[url], { status: 200 }) : new Response('absent', { status: 404 });
  };
  return { fn, calls };
}

const nesGames = [{ system: 'nes', id: 'nes/test' }];
const nesFiles = (report = JSON.stringify({ buildStart: 7, options: { defaultWebGL2: false } })) => ({
  ...Object.fromEntries(ENGINE_BASE_FILES.map((f) => [`${CDN}${f}`, 'x'.repeat(10)])),
  [`${CDN}cores/reports/fceumm.json`]: report,
  [`${CDN}cores/fceumm-legacy-wasm.data`]: 'c'.repeat(1000),
});

test('T46 critère 4 : le bouton télécharge le moteur et le cœur dans clone90-ejs-<version>, sans cookies, et dit ce qui est prêt', async () => {
  const caches = fakeCaches();
  const net = fakeFetch(nesFiles());
  const progress = [];
  const result = await prepareOfflineEngine({ systems, games: nesGames, cacheStorage: caches.api, fetchFn: net.fn, webgl2: true, locale: 'fr-FR', onProgress: (p) => progress.push(p) });
  const cache = caches.store.get(`clone90-ejs-${EJS_CDN_VERSION}`);
  assert.ok(cache.has(`${CDN}loader.js`) && cache.has(`${CDN}cores/fceumm-legacy-wasm.data`) && cache.has(`${CDN}cores/reports/fceumm.json`));
  assert.ok(!cache.has(`${CDN}localization/fr-FR.json`), 'langue absente du CDN (404) : rien de gardé, pas d\'échec');
  assert.deepEqual(result.ready, [nes.name]);
  assert.deepEqual(result.failed, []);
  assert.equal(result.downloaded, 10 * ENGINE_BASE_FILES.length + 1000 + nesFiles()[`${CDN}cores/reports/fceumm.json`].length);
  assert.ok(net.calls.every((c) => c.init?.mode === 'cors' && c.init?.credentials === 'omit'));
  assert.ok(progress.length > 0 && progress.at(-1).done === progress.at(-1).total);
  assert.match(describeOfflineResult(result), /^Jeu hors ligne prêt pour NES/);
});

test('T46 critère 4 : seulement ce qui manque (deuxième appui : rien de téléchargé)', async () => {
  const caches = fakeCaches();
  await prepareOfflineEngine({ systems, games: nesGames, cacheStorage: caches.api, fetchFn: fakeFetch(nesFiles()).fn, webgl2: false });
  const net = fakeFetch(nesFiles());
  const result = await prepareOfflineEngine({ systems, games: nesGames, cacheStorage: caches.api, fetchFn: net.fn, webgl2: false });
  assert.deepEqual(net.calls.map((c) => c.url).filter((u) => !u.includes('/localization/')), []);
  assert.equal(result.downloaded, 0);
  assert.deepEqual(result.ready, [nes.name]);
  assert.match(describeOfflineResult(result), /déjà/);
});

test('T46 critère 2 : une réponse en erreur n\'est jamais gardée, et le fichier manquant est signalé', async () => {
  const caches = fakeCaches();
  const files = nesFiles();
  delete files[`${CDN}cores/fceumm-legacy-wasm.data`];
  const result = await prepareOfflineEngine({ systems, games: nesGames, cacheStorage: caches.api, fetchFn: fakeFetch(files).fn, webgl2: false });
  assert.ok(!caches.store.get(`clone90-ejs-${EJS_CDN_VERSION}`).has(`${CDN}cores/fceumm-legacy-wasm.data`));
  assert.deepEqual(result.ready, []);
  assert.deepEqual(result.failed, [`${CDN}cores/fceumm-legacy-wasm.data`]);
  assert.match(describeOfflineResult(result), /incomplète/);
});

test('T46 sans réseau : rien n\'est gardé, message clair, ne lève pas', async () => {
  const caches = fakeCaches();
  const result = await prepareOfflineEngine({ systems, games: nesGames, cacheStorage: caches.api, fetchFn: fakeFetch({}, { offline: true }).fn, webgl2: false });
  assert.deepEqual(result.ready, []);
  assert.ok(result.failed.length >= ENGINE_BASE_FILES.length);
  assert.match(describeOfflineResult(result), /réseau/);
});

test('T46 rapport illisible (JSON abîmé) : cœur legacy quand même, préparation réussie', async () => {
  const caches = fakeCaches();
  const result = await prepareOfflineEngine({ systems, games: nesGames, cacheStorage: caches.api, fetchFn: fakeFetch(nesFiles('{pas du json')).fn, webgl2: true });
  assert.deepEqual(result.ready, [nes.name]);
});

test('T46 critère 3 : préparer efface les caches d\'une ancienne version du moteur, jamais la coquille ni ceux d\'autres applications', async () => {
  const caches = fakeCaches({ 'clone90-ejs-4.1.0': ['https://cdn.emulatorjs.org/4.1.0/data/loader.js'], 'clone90-shell-v0.45.0': ['x'], 'autre-app': ['y'] });
  await prepareOfflineEngine({ systems, games: nesGames, cacheStorage: caches.api, fetchFn: fakeFetch(nesFiles()).fn, webgl2: false });
  assert.deepEqual([...caches.store.keys()].sort(), ['autre-app', `clone90-ejs-${EJS_CDN_VERSION}`, 'clone90-shell-v0.45.0'].sort());
});

test('T46 critère 3 : la version de l\'Amiga est gardée à côté de la version par défaut', async () => {
  const v = engineVersionOf(amiga);
  if (v === EJS_CDN_VERSION) return;
  const caches = fakeCaches({ [`clone90-ejs-${v}`]: [] });
  await prepareOfflineEngine({ systems, games: [...nesGames, { system: 'amiga', id: 'amiga/x' }], cacheStorage: caches.api, fetchFn: fakeFetch(nesFiles()).fn, webgl2: false });
  assert.ok(caches.store.has(`clone90-ejs-${v}`) && caches.store.has(`clone90-ejs-${EJS_CDN_VERSION}`));
});

test('T46 aucun jeu : rien de téléchargé, message qui le dit', async () => {
  const net = fakeFetch(nesFiles());
  const result = await prepareOfflineEngine({ systems, games: [], cacheStorage: fakeCaches().api, fetchFn: net.fn, webgl2: false });
  assert.equal(net.calls.length, 0);
  assert.match(describeOfflineResult(result), /Aucun jeu/);
});

test('T46 navigateur sans Cache Storage : préparation impossible, dite clairement', async () => {
  assert.equal(offlineEngineSupported({}), false);
  assert.equal(offlineEngineSupported({ caches: {}, navigator: { serviceWorker: {} } }), true);
  const result = await prepareOfflineEngine({ systems, games: nesGames, cacheStorage: undefined, fetchFn: fakeFetch(nesFiles()).fn });
  assert.equal(result.unsupported, true);
  assert.match(describeOfflineResult(result), /navigateur/);
});

test('T46 message : plusieurs machines et taille lisible', () => {
  assert.equal(describeOfflineResult({ ready: ['NES', 'Super Nintendo'], failed: [], downloaded: 3 * 1024 * 1024 }), 'Jeu hors ligne prêt pour NES, Super Nintendo (3 Mo téléchargés).');
  assert.equal(describeOfflineResult({ ready: ['NES'], failed: [], downloaded: 0 }), 'Jeu hors ligne prêt pour NES (déjà sur cet appareil).');
});

test('T50 jeu hors ligne : la Game Boy Advance garde le cœur mgba (variante legacy par défaut, environ 1 Mo)', () => {
  const gba = byId('gba');
  assert.equal(ejsCoreFor(gba.emulatorjsCore), 'mgba');
  const urls = engineFiles({ system: gba, report: null, webgl2: true }).map((f) => f.url);
  assert.ok(urls.includes(`${CDN}cores/mgba-legacy-wasm.data`), urls.join('\n'));
  assert.ok(urls.includes(`${CDN}cores/reports/mgba.json`));
  assert.deepEqual(machinesWithGames(systems, [{ system: 'gba' }]).map((s) => s.id), ['gba']);
});
