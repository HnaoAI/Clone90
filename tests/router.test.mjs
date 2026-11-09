// Tests de js/router.js (T3) : routes hash #/ et #/<machine>?focus=, sans DOM (window factice).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseHash, buildHash, buildPlayerUrl, createRouter } from '../js/router.js';

test('parseHash : vide, # et #/ sont l\'accueil', () => {
  for (const h of ['', '#', '#/', undefined]) assert.deepEqual(parseHash(h), { name: 'home' });
});

test('parseHash : #/<machine> sans focus', () => {
  assert.deepEqual(parseHash('#/neogeo'), { name: 'system', system: 'neogeo', focus: null });
  assert.deepEqual(parseHash('#/neogeo/'), { name: 'system', system: 'neogeo', focus: null });
});

test('parseHash : ?focus= est décodé avec decodeURIComponent', () => {
  assert.deepEqual(parseHash('#/neogeo?focus=neogeo%2Fmslug%202'),
    { name: 'system', system: 'neogeo', focus: 'neogeo/mslug 2' });
});

test('parseHash : focus vide, focus mal encodé et paramètres inconnus sont tolérés', () => {
  assert.equal(parseHash('#/amiga?focus=').focus, null);
  assert.equal(parseHash('#/amiga?focus=%E0%A4%A').focus, null);
  assert.equal(parseHash('#/amiga?x=1&focus=amiga%2Fa&y=2').focus, 'amiga/a');
});

test('parseHash : forme inconnue donne notfound (le routeur ignore la liste des machines)', () => {
  assert.equal(parseHash('#/a/b').name, 'notfound');
  assert.equal(parseHash('#/NeoGeo').name, 'notfound');
  assert.equal(parseHash('#neogeo').name, 'notfound');
  assert.equal(parseHash('#/<script>').name, 'notfound');
});

test('buildHash : aller-retour avec parseHash, y compris caractères spéciaux', () => {
  assert.equal(buildHash({ name: 'home' }), '#/');
  assert.equal(buildHash({ name: 'system', system: 'neogeo' }), '#/neogeo');
  const route = { name: 'system', system: 'amiga', focus: 'amiga/lem mings&é?#' };
  const hash = buildHash(route);
  assert.equal(hash, '#/amiga?focus=amiga%2Flem%20mings%26%C3%A9%3F%23');
  assert.deepEqual(parseHash(hash), route);
});

test('buildPlayerUrl : player.html?system=&game= avec id encodé', () => {
  assert.equal(buildPlayerUrl('neogeo', 'neogeo/mslug 2'), 'player.html?system=neogeo&game=neogeo%2Fmslug%202');
});

/** window factice : hash + écouteurs hashchange. */
const fakeWindow = (hash = '') => {
  const listeners = new Set();
  return {
    location: { hash },
    addEventListener: (t, f) => { if (t === 'hashchange') listeners.add(f); },
    removeEventListener: (t, f) => { if (t === 'hashchange') listeners.delete(f); },
    fire() { for (const f of [...listeners]) f(); },
    count: () => listeners.size,
  };
};

test('createRouter : start appelle le callback avec la route courante, puis à chaque hashchange', () => {
  const win = fakeWindow('#/neogeo');
  const seen = [];
  const router = createRouter(win);
  router.start((r) => seen.push(r));
  win.location.hash = '#/';
  win.fire();
  assert.deepEqual(seen.map((r) => r.name), ['system', 'home']);
});

test('createRouter : navigate écrit le hash, stop retire l\'écouteur', () => {
  const win = fakeWindow('');
  const router = createRouter(win);
  router.start(() => {});
  router.navigate({ name: 'system', system: 'amiga', focus: 'amiga/a' });
  assert.equal(win.location.hash, '#/amiga?focus=amiga%2Fa');
  assert.equal(win.count(), 1);
  router.stop();
  assert.equal(win.count(), 0);
});

test('createRouter : un second start remplace le premier écouteur (pas de doublon)', () => {
  const win = fakeWindow('');
  const router = createRouter(win);
  let n = 0;
  router.start(() => { n += 1; });
  router.start(() => { n += 10; });
  assert.equal(win.count(), 1);
  assert.equal(n, 11);
});
