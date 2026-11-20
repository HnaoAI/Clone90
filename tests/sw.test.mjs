// Tests de la logique pure du service worker sw.js (T8) : liste de fichiers, filtre de cache, nettoyage des caches.
// sw.js est un script classique : on l'exécute dans un contexte node:vm et on lit self.Clone90SW.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { PROJECT_ROOT } from '../scripts/serve.mjs';

const source = readFileSync(join(PROJECT_ROOT, 'sw.js'), 'utf8');
const listeners = [];
const sandbox = { URL, decodeURIComponent, self: null };
sandbox.self = { addEventListener: (type) => listeners.push(type) };
vm.runInNewContext(source, sandbox);
const sw = sandbox.self.Clone90SW;
const SCOPE = 'http://localhost:8080/';
const PAGES_SCOPE = 'https://hnaoai.github.io/Clone90/';

test('sw.js hors service worker : n\'enregistre aucun écouteur et expose la logique pure', () => {
  assert.deepEqual(listeners, []);
  assert.ok(sw && typeof sw.shouldHandle === 'function');
});

const listFiles = (dir) => readdirSync(dir).flatMap((name) => {
  const full = join(dir, name);
  return statSync(full).isDirectory() ? listFiles(full) : [full];
});
const rel = (f) => relative(PROJECT_ROOT, f).split('\\').join('/');

test('liste de fichiers : tout js/, css/, assets/icons/ et assets/fonts/ du projet est dans la coquille (sinon hors ligne cassé)', () => {
  const onDisk = ['js', 'css', 'assets/icons', 'assets/fonts'].flatMap((d) => listFiles(join(PROJECT_ROOT, d))).map(rel)
    .filter((f) => !f.endsWith('README.md') && !f.split('/').pop().startsWith('.'));
  const missing = onDisk.filter((f) => !sw.SHELL_FILES.includes(f));
  assert.deepEqual(missing, [], 'fichiers absents de SHELL_FILES');
});

test('logos : tous les fichiers de assets/logos/ sont déclarés dans systems.json, donc ajoutés à la coquille par logoPaths', () => {
  const systems = JSON.parse(readFileSync(join(PROJECT_ROOT, 'systems.json'), 'utf8'));
  const declared = [...sw.logoPaths(systems)];
  const onDisk = listFiles(join(PROJECT_ROOT, 'assets/logos')).map(rel).filter((f) => !f.split('/').pop().startsWith('.'));
  assert.deepEqual(onDisk.sort(), declared.sort());
  for (const logo of declared) assert.equal(sw.isShellPath(logo, declared), true, logo);
});

test('liste de fichiers : chaque entrée de la coquille existe sur le disque', () => {
  for (const f of sw.SHELL_FILES) {
    if (f === './') continue;
    assert.ok(existsSync(join(PROJECT_ROOT, f)), f);
  }
});

test('liste de fichiers : jamais roms/, bios/, games.json ni URL absolue ou chemin absolu dans la coquille', () => {
  for (const f of sw.SHELL_FILES) {
    assert.equal(sw.isNeverCached(f), false, f);
    assert.ok(!f.startsWith('/') && !/^[a-z]+:/i.test(f), `chemin relatif attendu : ${f}`);
  }
  assert.ok(!sw.SHELL_FILES.includes('games.json'));
});

test('filtre : les fichiers de la coquille sont gérés, avec ou sans paramètres (player.html?system=...)', () => {
  for (const f of ['index.html', 'player.html', 'css/base.css', 'js/app.js', 'systems.json']) {
    assert.equal(sw.shouldHandle('GET', `${SCOPE}${f}`, SCOPE), true, f);
  }
  assert.equal(sw.shouldHandle('GET', `${SCOPE}`, SCOPE), true, 'racine');
  assert.equal(sw.shouldHandle('GET', `${SCOPE}player.html?system=neogeo&game=neogeo%2Fmslug`, SCOPE), true);
  assert.equal(sw.shouldHandle('GET', `${SCOPE}index.html#/neogeo`, SCOPE), true);
});

test('filtre CRITIQUE (règle 6) : roms/, bios/ et games.json ne sont jamais gérés ni mis en cache', () => {
  for (const scope of [SCOPE, PAGES_SCOPE]) {
    for (const p of ['roms/neogeo/mslug.zip', 'roms/amiga/Le%20Lemmings.adf', 'roms/neogeo/mslug.png', 'bios/neogeo.zip', 'bios/kick40068.A1200', 'games.json', 'games.json?v=2', 'roms/']) {
      assert.equal(sw.shouldHandle('GET', `${scope}${p}`, scope), false, `${scope}${p}`);
    }
  }
  // même si un logo ou une icône portait ce nom par erreur
  assert.equal(sw.shouldHandle('GET', `${SCOPE}roms/a.png`, SCOPE, ['roms/a.png']), false);
});

test('filtre CRITIQUE : une autre origine (CDN EmulatorJS) n\'est jamais gérée, même avec un chemin de la coquille', () => {
  assert.equal(sw.shouldHandle('GET', 'https://cdn.emulatorjs.org/4.2.3/data/loader.js', SCOPE), false);
  assert.equal(sw.shouldHandle('GET', 'https://cdn.emulatorjs.org/4.2.3/data/cores/fbneo-wasm.data', SCOPE), false);
  assert.equal(sw.shouldHandle('GET', 'https://cdn.emulatorjs.org/index.html', SCOPE), false);
  assert.equal(sw.shouldHandle('GET', 'http://localhost:9999/index.html', SCOPE), false);
});

test('filtre : seules les requêtes GET sont gérées', () => {
  for (const m of ['POST', 'PUT', 'DELETE', 'HEAD']) assert.equal(sw.shouldHandle(m, `${SCOPE}index.html`, SCOPE), false, m);
});

test('filtre : fichier inconnu ou non listé = réseau direct', () => {
  for (const p of ['secret.txt', 'tickets/T7-lancement.md', 'js/inconnu.js', '.git/config', 'data/titles.json']) {
    assert.equal(sw.shouldHandle('GET', `${SCOPE}${p}`, SCOPE), false, p);
  }
});

test('portée GitHub Pages (/Clone90/) : chemins relatifs à la portée, hors portée ignorés', () => {
  assert.equal(sw.shouldHandle('GET', `${PAGES_SCOPE}index.html`, PAGES_SCOPE), true);
  assert.equal(sw.shouldHandle('GET', `${PAGES_SCOPE}js/app.js`, PAGES_SCOPE), true);
  assert.equal(sw.shouldHandle('GET', 'https://hnaoai.github.io/AutreDepot/index.html', PAGES_SCOPE), false);
  assert.equal(sw.shouldHandle('GET', `${PAGES_SCOPE}roms/x.zip`, PAGES_SCOPE), false);
  assert.equal(sw.scopedPath(`${PAGES_SCOPE}css/base.css?x=1#y`, PAGES_SCOPE), 'css/base.css');
  assert.equal(sw.scopedPath('https://hnaoai.github.io/Clone9/index.html', PAGES_SCOPE), null);
});

test('logoPaths : logos lus dans systems.json, valeurs dangereuses écartées', () => {
  const json = { systems: [
    { id: 'a', logo: 'assets/logos/a.svg' }, { id: 'b' }, { id: 'c', logo: '/abs.svg' }, { id: 'd', logo: '../x.svg' },
    { id: 'e', logo: 'https://x/y.svg' }, { id: 'f', logo: 'roms/f.png' }, { id: 'g', logo: 42 }, null,
  ] };
  assert.deepEqual([...sw.logoPaths(json)], ['assets/logos/a.svg']); // [...] : tableau issu d'un autre contexte vm
  assert.deepEqual([...sw.logoPaths(null)], []);
  assert.deepEqual([...sw.logoPaths({ systems: 'x' })], []);
  assert.equal(sw.shouldHandle('GET', `${SCOPE}assets/logos/a.svg`, SCOPE, ['assets/logos/a.svg']), true);
  assert.equal(sw.shouldHandle('GET', `${SCOPE}assets/logos/a.svg`, SCOPE), false);
});

test('staleCacheNames : supprime les anciennes versions de Clone90, jamais les caches d\'autres applications', () => {
  assert.deepEqual(sw.staleCacheNames(['clone90-shell-v0', sw.CACHE_VERSION, 'autre-app', 'workbox-x']), ['clone90-shell-v0']);
  assert.deepEqual(sw.staleCacheNames([sw.CACHE_VERSION]), []);
  assert.deepEqual(sw.staleCacheNames([]), []);
});

test('mise à jour sur téléphone (T28) : la coquille est redemandée au serveur (cache: no-cache), jamais lue telle quelle dans le cache HTTP', () => {
  // GitHub Pages sert avec Cache-Control: max-age=600 : sans no-cache, le téléphone garde l'ancienne version jusqu'à 10 minutes après une livraison.
  assert.equal(sw.NETWORK_FETCH_INIT.cache, 'no-cache');
  assert.match(source, /await fetch\(request, NETWORK_FETCH_INIT\)/);
});

// T46 : moteur EmulatorJS gardé pour jouer hors ligne, dans un cache à part (exception écrite à la règle 6, journal du CLAUDE.md).
test('T46 critère 2 : seuls les fichiers versionnés du CDN EmulatorJS vont dans clone90-ejs-<version>', () => {
  assert.equal(sw.engineCacheFor('GET', 'https://cdn.emulatorjs.org/4.2.3/data/loader.js'), 'clone90-ejs-4.2.3');
  assert.equal(sw.engineCacheFor('GET', 'https://cdn.emulatorjs.org/4.2.1/data/cores/puae-legacy-wasm.data'), 'clone90-ejs-4.2.1');
  assert.equal(sw.engineCacheFor('GET', 'https://cdn.emulatorjs.org/4.2.3/data/cores/reports/fceumm.json?v=1'), 'clone90-ejs-4.2.3');
  for (const url of [
    'https://cdn.emulatorjs.org/stable/data/loader.js', 'https://cdn.emulatorjs.org/stable/data/version.json', 'https://cdn.emulatorjs.org/latest/data/loader.js',
    'http://cdn.emulatorjs.org/4.2.3/data/loader.js', 'https://cdn.emulatorjs.org.exemple.test/4.2.3/data/loader.js', 'https://exemple.test/4.2.3/data/loader.js',
    'https://cdn.emulatorjs.org/4.2.3/data/', 'https://cdn.emulatorjs.org/4.2.3/data/../../x.js', 'https://cdn.emulatorjs.org/4.2.3/data/%2e%2e/x.js',
    'https://cdn.emulatorjs.org/4.2.3/loader.js', `${SCOPE}roms/nes/test.nes`, `${SCOPE}bios/neogeo.zip`, `${SCOPE}js/app.js`, 'pas une adresse',
  ]) assert.equal(sw.engineCacheFor('GET', url), null, url);
  for (const m of ['POST', 'HEAD', 'PUT']) assert.equal(sw.engineCacheFor(m, 'https://cdn.emulatorjs.org/4.2.3/data/loader.js'), null, m);
});

test('T46 critère 3 : une nouvelle version de Clone90 ne vide pas le cache du moteur', () => {
  assert.deepEqual(sw.staleCacheNames(['clone90-shell-v0', sw.CACHE_VERSION, 'clone90-ejs-4.2.3', 'clone90-ejs-4.2.1']), ['clone90-shell-v0']);
});

test('T46 INVARIANT : même préfixe de cache et même CDN que js/offline-engine.js et js/config.js', async () => {
  const { ENGINE_CACHE_PREFIX } = await import('../js/offline-engine.js');
  const { ejsDataUrl } = await import('../js/config.js');
  assert.equal(sw.ENGINE_CACHE_PREFIX, ENGINE_CACHE_PREFIX);
  assert.ok(ejsDataUrl('9.9.9').startsWith(sw.ENGINE_ORIGIN));
  assert.equal(sw.engineCacheFor('GET', `${ejsDataUrl('9.9.9')}loader.js`), `${ENGINE_CACHE_PREFIX}9.9.9`);
});

/** Faux cache d'un seul magasin pour serveEngine. */
function engineCache(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { map, match: async (key) => map.get(key)?.clone(), put: async (key, res) => { map.set(key, res); } };
}

test('T46 critère 1 : cache d\'abord, hors ligne le fichier gardé est rendu sans réseau', async () => {
  const cache = engineCache({ 'https://cdn.emulatorjs.org/4.2.3/data/loader.js': new Response('gardé') });
  const res = await sw.serveEngine({ url: 'https://cdn.emulatorjs.org/4.2.3/data/loader.js?x=1' }, cache, async () => { throw new TypeError('hors ligne'); });
  assert.equal(await res.text(), 'gardé');
});

test('T46 remplissage au premier lancement : fichier absent lu au réseau (CORS, sans cookies), gardé sans paramètres, puis rendu', async () => {
  const cache = engineCache();
  const calls = [];
  const res = await sw.serveEngine({ url: 'https://cdn.emulatorjs.org/4.2.3/data/emulator.min.js?v=2' }, cache, async (url, init) => { calls.push([url, init]); return new Response('moteur'); });
  assert.equal(await res.text(), 'moteur');
  assert.deepEqual(calls.map(([u, i]) => [u, i?.mode, i?.credentials]), [['https://cdn.emulatorjs.org/4.2.3/data/emulator.min.js?v=2', 'cors', 'omit']]);
  assert.equal(await (await cache.match('https://cdn.emulatorjs.org/4.2.3/data/emulator.min.js')).text(), 'moteur');
});

test('T46 critère 2 : une réponse en erreur (404, 500) est rendue telle quelle mais jamais gardée', async () => {
  for (const status of [404, 500]) {
    const cache = engineCache();
    const res = await sw.serveEngine({ url: 'https://cdn.emulatorjs.org/4.2.3/data/localization/fr-FR.json' }, cache, async () => new Response('x', { status }));
    assert.equal(res.status, status);
    assert.equal(cache.map.size, 0);
  }
});

test('T46 CORS refusé par le CDN : la requête d\'origine part telle quelle (rien de cassé en ligne), sans rien garder', async () => {
  const cache = engineCache();
  const request = { url: 'https://cdn.emulatorjs.org/4.2.3/data/loader.js' };
  const seen = [];
  const res = await sw.serveEngine(request, cache, async (input, init) => { seen.push(input); if (init?.mode === 'cors') throw new TypeError('CORS'); return new Response('opaque'); });
  assert.equal(await res.text(), 'opaque');
  assert.equal(seen[1], request);
  assert.equal(cache.map.size, 0);
});

test('T46 sans réseau et rien de gardé : erreur réseau, comme avant (le lecteur affiche son message)', async () => {
  await assert.rejects(sw.serveEngine({ url: 'https://cdn.emulatorjs.org/4.2.3/data/loader.js' }, engineCache(), async () => { throw new TypeError('hors ligne'); }));
});
