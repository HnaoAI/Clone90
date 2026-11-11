// Tests PWA (T8) : manifest, icônes, liens dans les pages, enregistrement du service worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/serve.mjs';
import { canRegisterServiceWorker, registerServiceWorker } from '../js/pwa.js';
import { SERVICE_WORKER_URL } from '../js/config.js';
import { APP_VERSION } from '../js/version.js';

const read = (f) => readFileSync(join(PROJECT_ROOT, f));
const manifest = JSON.parse(read('manifest.webmanifest').toString('utf8'));

test('manifest : nom, démarrage et portée relatifs (GitHub Pages sous /<dépôt>/), plein écran avec repli standalone', () => {
  assert.equal(manifest.name, 'Clone90');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  assert.equal(manifest.display, 'fullscreen');
  assert.deepEqual(manifest.display_override, ['fullscreen', 'standalone']);
  assert.equal(manifest.theme_color, '#0f1117');
  assert.equal(manifest.background_color, '#0f1117');
  assert.equal(manifest.lang, 'fr');
});

test('manifest : icônes 192 et 512 en PNG aux bonnes dimensions, chemins relatifs', () => {
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((i) => i.sizes === `${size}x${size}` && i.purpose === 'any');
    assert.ok(icon, `icône ${size}`);
    assert.equal(icon.type, 'image/png');
    assert.ok(!icon.src.startsWith('/') && !icon.src.includes('://'));
    const png = read(icon.src);
    assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], 'signature PNG');
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
  for (const size of [192, 512]) {
    const icon = manifest.icons.find((i) => i.sizes === `${size}x${size}` && i.purpose === 'maskable');
    assert.ok(icon, `icône maskable ${size}`);
    assert.equal(read(icon.src).readUInt32BE(16), size);
  }
});

test('manifest : aucun chemin absolu ni URL externe', () => {
  const text = JSON.stringify(manifest);
  assert.ok(!/"\/[^"]/.test(text) && !/https?:/.test(text));
});

test('pages : index.html et player.html déclarent le manifest en relatif', () => {
  for (const page of ['index.html', 'player.html']) {
    const html = read(page).toString('utf8');
    assert.match(html, /<link rel="manifest" href="manifest\.webmanifest">/, page);
    assert.match(html, /rel="apple-touch-icon" href="assets\/icons\/icon-192\.png"/, page);
  }
});

test('config : sw.js est relatif', () => assert.equal(SERVICE_WORKER_URL, 'sw.js'));

test('canRegisterServiceWorker : exige l\'API et un contexte sécurisé (HTTPS ou localhost)', () => {
  assert.equal(canRegisterServiceWorker({ serviceWorker: {} }, true), true);
  assert.equal(canRegisterServiceWorker({ serviceWorker: {} }, false), false, 'http://192.168.x.x');
  assert.equal(canRegisterServiceWorker({}, true), false);
  assert.equal(canRegisterServiceWorker(undefined, true), false);
});

test('registerServiceWorker : enregistre sw.js en relatif et renvoie true', async () => {
  const calls = [];
  const nav = { serviceWorker: { register: async (url) => { calls.push(url); } } };
  assert.equal(await registerServiceWorker(nav, true), true);
  assert.deepEqual(calls, [`sw.js?v=${APP_VERSION}`]); // T16 : la version passe par l'adresse (voir tests/version.test.mjs)
});

test('registerServiceWorker : refus ou erreur = false sans rejet, rien tenté hors contexte sécurisé', async () => {
  let called = false;
  const failing = { serviceWorker: { register: async () => { called = true; throw new Error('SecurityError'); } } };
  assert.equal(await registerServiceWorker(failing, true), false);
  called = false;
  assert.equal(await registerServiceWorker(failing, false), false);
  assert.equal(called, false);
});

test('T16 pages : index.html et player.html déclarent une icône existante (pas de requête /favicon.ico)', () => {
  for (const page of ['index.html', 'player.html']) {
    const href = /<link rel="icon" type="image\/png" href="([^"]+)">/.exec(read(page).toString('utf8'))?.[1];
    assert.ok(href && !href.startsWith('/'), page);
    assert.ok(read(href).length > 0, href);
  }
});
