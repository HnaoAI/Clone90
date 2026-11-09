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

test('liste de fichiers : tout js/, css/ et assets/icons/ du projet est dans la coquille (sinon hors ligne cassé)', () => {
  const onDisk = ['js', 'css', 'assets/icons'].flatMap((d) => listFiles(join(PROJECT_ROOT, d))).map(rel)
    .filter((f) => !f.endsWith('README.md') && !f.split('/').pop().startsWith('.'));
  const missing = onDisk.filter((f) => !sw.SHELL_FILES.includes(f));
  assert.deepEqual(missing, [], 'fichiers absents de SHELL_FILES');
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
  assert.equal(sw.shouldHandle('GET', 'https://cdn.emulatorjs.org/stable/data/loader.js', SCOPE), false);
  assert.equal(sw.shouldHandle('GET', 'https://cdn.emulatorjs.org/stable/data/cores/fbneo-wasm.data', SCOPE), false);
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
