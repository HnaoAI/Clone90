// Tests de T40 (suite, décision de Hicham le 2026-11-15 : « Passe en automatique sur mac ») : pochettes cherchées seules sur le Mac
// à l'ouverture de Clone90 et après un ajout de jeux par Clone90. Sans réseau : API locale simulée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { countMissingCovers, runAutoCovers, autoCoversToast } from '../js/auto-covers.js';
import { COVERS_INFO } from '../js/ui/folders-panel.js';

const SYSTEMS = [
  { id: 'amiga', name: 'Amiga', thumbnailsRepo: 'Commodore_-_Amiga' },
  { id: 'nes', name: 'NES' },
];
const game = (id, extra = {}) => ({ id, system: 'amiga', title: id, file: `roms/amiga/${id}.adf`, cover: null, ...extra });

test('T40 Mac automatique : on ne compte que les jeux du disque sans pochette, d\'une machine qui a une base', () => {
  assert.equal(countMissingCovers([game('a'), game('b', { cover: 'roms/amiga/b.png' }), game('c', { local: true }), game('d', { system: 'nes' })], SYSTEMS), 1);
  assert.equal(countMissingCovers([], SYSTEMS), 0);
  assert.equal(countMissingCovers(undefined, SYSTEMS), 0);
});

/** API locale simulée : `start` renvoie `startResult`, puis `states` successifs. */
function fakeApi({ startResult = { status: 'started' }, states = [{ status: 'done', id: 1, found: 2, lines: ['Pochettes téléchargées : 2'] }] } = {}) {
  const calls = { start: 0, status: 0, waits: 0 };
  return {
    calls,
    start: async () => { calls.start += 1; return startResult; },
    status: async () => { calls.status += 1; return states[Math.min(calls.status - 1, states.length - 1)]; },
    wait: async () => { calls.waits += 1; },
  };
}

test('T40 Mac automatique : jeux sans pochette = téléchargement lancé sans clic, suivi jusqu\'à la fin', async () => {
  const api = fakeApi({ states: [{ status: 'running', id: 1 }, { status: 'running', id: 1 }, { status: 'done', id: 1, found: 2, lines: ['Pochettes téléchargées : 2'] }] });
  const state = await runAutoCovers({ games: [game('Gods')], systems: SYSTEMS, ...api });
  assert.equal(api.calls.start, 1);
  assert.equal(state.status, 'done');
  assert.equal(api.calls.status, 3);
});

test('T40 Mac automatique : aucun jeu sans pochette = aucune connexion', async () => {
  const api = fakeApi();
  assert.equal(await runAutoCovers({ games: [game('Gods', { cover: 'roms/amiga/Gods.png' })], systems: SYSTEMS, ...api }), null);
  assert.equal(api.calls.start, 0);
});

test('T40 Mac automatique : un autre téléchargement en cours ou une erreur = rien, sans exception', async () => {
  for (const startResult of [{ status: 'busy', message: 'occupé' }, { status: 'error', message: 'refusé' }]) {
    const api = fakeApi({ startResult });
    assert.equal(await runAutoCovers({ games: [game('Gods')], systems: SYSTEMS, ...api }), null);
    assert.equal(api.calls.status, 0);
  }
  const broken = { start: async () => { throw new Error('x'); }, status: async () => null, wait: async () => {} };
  assert.equal(await runAutoCovers({ games: [game('Gods')], systems: SYSTEMS, ...broken }), null);
});

test('T40 Mac automatique : serveur qui ne répond plus pendant le suivi = arrêt du suivi (pas de boucle sans fin)', async () => {
  const api = fakeApi({ states: [{ status: 'running', id: 1 }, null, null, null, null, null] });
  assert.equal(await runAutoCovers({ games: [game('Gods')], systems: SYSTEMS, ...api }), null);
  assert.ok(api.calls.status <= 6);
});

test('T40 Mac automatique : message seulement si des pochettes ont été ajoutées (pas de bruit à chaque ouverture)', () => {
  assert.equal(autoCoversToast({ status: 'done', found: 3, lines: ['Pochettes téléchargées : 3', 'Introuvables : 1'] }), 'Pochettes téléchargées : 3');
  assert.equal(autoCoversToast({ status: 'done', found: 0, lines: ['Introuvables : 1'] }), null);
  assert.equal(autoCoversToast({ status: 'error', message: 'Le téléchargement des pochettes a échoué.' }), null);
  assert.equal(autoCoversToast(null), null);
});

test('T40 Mac automatique : le texte du panneau dit que la recherche se fait aussi sans clic, à l\'ouverture et après un ajout de jeux', () => {
  assert.match(COVERS_INFO, /à chaque ouverture de Clone90/);
  assert.match(COVERS_INFO, /après un ajout de jeux/);
  assert.match(COVERS_INFO, /GitHub voit votre adresse IP et les noms des jeux cherchés/);
  assert.doesNotMatch(COVERS_INFO, /uniquement quand vous cliquez/);
});
