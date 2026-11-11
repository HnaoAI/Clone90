// Tests de js/version.js (T16) : format, date, ticket à jour, libellé, et non-divergence avec le service worker et son enregistrement.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/serve.mjs';
import { APP_VERSION, APP_DATE, formatVersionLabel } from '../js/version.js';
import { registerServiceWorker } from '../js/pwa.js';

const swSource = readFileSync(join(PROJECT_ROOT, 'sw.js'), 'utf8');

/** Charge sw.js dans un contexte vm avec l'adresse de script donnée (comme le navigateur : `self.location`). */
function loadSw(scriptUrl) {
  const sandbox = { URL, decodeURIComponent, self: null };
  sandbox.self = { addEventListener: () => {}, location: scriptUrl ? new URL(scriptUrl) : undefined };
  vm.runInNewContext(swSource, sandbox);
  return sandbox.self.Clone90SW;
}

test('version : format 0.<ticket>.<n> et date ISO valide', () => {
  assert.match(APP_VERSION, /^0\.\d+\.\d+$/);
  assert.match(APP_DATE, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(!Number.isNaN(Date.parse(APP_DATE)));
});

test('version : le numéro de ticket de la version est celui du dernier ticket (sinon on a oublié de relever la version)', () => {
  const numbers = readdirSync(join(PROJECT_ROOT, 'tickets')).map((f) => /^T(\d+)/.exec(f)?.[1]).filter(Boolean).map(Number);
  assert.equal(Number(APP_VERSION.split('.')[1]), Math.max(...numbers), 'relever APP_VERSION et APP_DATE dans js/version.js');
});

test('formatVersionLabel : « Clone90 v0.16.0 - 11/11/2026 », sans tiret cadratin', () => {
  assert.equal(formatVersionLabel('0.16.0', '2026-11-11'), 'Clone90 v0.16.0 - 11/11/2026');
  assert.equal(formatVersionLabel(), `Clone90 v${APP_VERSION} - ${APP_DATE.split('-').reverse().join('/')}`);
  assert.ok(!formatVersionLabel().includes('—'));
});

test('formatVersionLabel : une date mal formée est affichée telle quelle, sans exception', () => {
  assert.equal(formatVersionLabel('0.1.0', 'hier'), 'Clone90 v0.1.0 - hier');
});

test('sw.js : le nom du cache reprend APP_VERSION (lue dans l\'adresse d\'enregistrement), jamais une valeur écrite en dur', () => {
  const sw = loadSw(`http://localhost:8080/sw.js?v=${APP_VERSION}`);
  assert.equal(sw.CACHE_VERSION, `clone90-shell-v${APP_VERSION}`);
  assert.ok(!/\d+\.\d+\.\d+/.test(swSource.replace(/\/\/.*$/gm, '')), 'sw.js ne contient aucun numéro de version écrit en dur');
});

test('sw.js : sans paramètre ou paramètre douteux, repli sûr (dev) et aucun caractère étranger dans le nom du cache', () => {
  assert.equal(loadSw('http://localhost:8080/sw.js').CACHE_VERSION, 'clone90-shell-vdev');
  assert.equal(loadSw(null).CACHE_VERSION, 'clone90-shell-vdev');
  assert.equal(loadSw('http://localhost:8080/sw.js?v=1.2.3%20%3Cx%3E').CACHE_VERSION, 'clone90-shell-vdev');
});

test('pwa.js enregistre sw.js avec exactement APP_VERSION : les deux ne peuvent pas diverger', async () => {
  const urls = [];
  await registerServiceWorker({ serviceWorker: { register: async (url) => { urls.push(url); } } }, true);
  assert.deepEqual(urls, [`sw.js?v=${APP_VERSION}`]);
  assert.equal(loadSw(`http://localhost:8080/${urls[0]}`).CACHE_VERSION, `clone90-shell-v${APP_VERSION}`);
});
