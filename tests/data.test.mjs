// Tests de js/data.js (T3) : validation de systems.json et games.json, games.json absent, encodage des chemins.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  validateSystems, validateGames, loadData, groupGamesBySystem, assetUrl, encodeGameId,
} from '../js/data.js';

const realSystems = JSON.parse(readFileSync(new URL('../systems.json', import.meta.url), 'utf8'));
const sys = (id, order, extra = {}) => ({
  id, name: id.toUpperCase(), order, emulatorjsCore: id, extensions: ['zip'], bios: [],
  logo: `assets/logos/${id}.svg`, accent: `--m-${id}`, wave: 1, ...extra,
});
const game = (system, name, extra = {}) => ({
  id: `${system}/${name}`, system, title: name, file: `roms/${system}/${name}.zip`, cover: null, ...extra,
});

/** fetchJson factice : renvoie la table { url: valeur }, ou lève l'erreur donnée. */
const fakeFetch = (table) => async (url) => {
  if (!(url in table)) { const e = new Error('absent'); e.status = 404; throw e; }
  const v = table[url];
  if (v instanceof Error) throw v;
  return v;
};

test('validateSystems : accepte le vrai systems.json et trie par order', () => {
  const list = validateSystems(realSystems);
  assert.equal(list.length, realSystems.systems.length);
  const orders = list.map((s) => s.order);
  assert.deepEqual(orders, [...orders].sort((a, b) => a - b));
});

test('validateSystems : trie une liste désordonnée', () => {
  const list = validateSystems({ version: 1, systems: [sys('b', 20), sys('a', 10)] });
  assert.deepEqual(list.map((s) => s.id), ['a', 'b']);
});

test('validateSystems : refuse version inconnue, liste vide, non-objet', () => {
  assert.throws(() => validateSystems(null), /systems\.json/);
  assert.throws(() => validateSystems({ version: 2, systems: [sys('a', 1)] }), /version/);
  assert.throws(() => validateSystems({ version: 1, systems: [] }), /vide/);
  assert.throws(() => validateSystems({ version: 1 }), /systems/);
});

test('validateSystems : refuse id dupliqué, id invalide, champ manquant', () => {
  assert.throws(() => validateSystems({ version: 1, systems: [sys('a', 1), sys('a', 2)] }), /dupliqu/);
  assert.throws(() => validateSystems({ version: 1, systems: [sys('A/b', 1)] }), /id/);
  assert.throws(() => validateSystems({ version: 1, systems: [sys('a', 1, { name: '' })] }), /name/);
  assert.throws(() => validateSystems({ version: 1, systems: [sys('a', 1, { extensions: 'zip' })] }), /extensions/);
  assert.throws(() => validateSystems({ version: 1, systems: [sys('a', 'x')] }), /order/);
});

test('validateGames : garde les jeux valides et écarte les entrées invalides', () => {
  const raw = { version: 1, games: [
    game('neogeo', 'mslug'),
    { id: 'neogeo/x' },                       // champs manquants
    game('inconnue', 'zz'),                   // machine inconnue
    game('neogeo', 'mslug'),                  // id dupliqué
    game('amiga', 'lemmings', { cover: 'roms/amiga/lemmings.png', bios: 'kick34005.A500' }),
  ] };
  const { games, skipped } = validateGames(raw, ['neogeo', 'amiga']);
  assert.deepEqual(games.map((g) => g.id), ['neogeo/mslug', 'amiga/lemmings']);
  assert.equal(skipped, 3);
});

test('validateGames : refuse un fichier d\'une autre version ou sans liste', () => {
  assert.throws(() => validateGames({ version: 9, games: [] }, []), /version/);
  assert.throws(() => validateGames({ version: 1 }, []), /games/);
  assert.throws(() => validateGames('texte', []), /games\.json/);
});

test('validateGames : refuse les chemins absolus ou remontants (chemins toujours relatifs)', () => {
  const raw = { version: 1, games: [
    game('neogeo', 'a', { file: '/roms/neogeo/a.zip' }),
    game('neogeo', 'b', { file: '../roms/b.zip' }),
    game('neogeo', 'c', { cover: 'https://x.test/c.png' }),
    game('neogeo', 'd'),
  ] };
  const { games } = validateGames(raw, ['neogeo']);
  assert.deepEqual(games.map((g) => g.id), ['neogeo/d']);
});

test('loadData : charge systems.json et games.json (statut ok)', async () => {
  const data = await loadData(fakeFetch({
    'systems.json': { version: 1, systems: [sys('neogeo', 20), sys('amiga', 10)] },
    'games.json': { version: 1, games: [game('neogeo', 'mslug')] },
  }));
  assert.deepEqual(data.systems.map((s) => s.id), ['amiga', 'neogeo']);
  assert.equal(data.games.length, 1);
  assert.equal(data.gamesStatus, 'ok');
});

test('loadData : games.json absent (404) ne plante pas, statut absent', async () => {
  const data = await loadData(fakeFetch({ 'systems.json': { version: 1, systems: [sys('amiga', 10)] } }));
  assert.deepEqual(data.games, []);
  assert.equal(data.gamesStatus, 'absent');
  assert.equal(data.systems.length, 1);
});

test('loadData : games.json vide (aucun jeu) donne le statut empty', async () => {
  const data = await loadData(fakeFetch({
    'systems.json': { version: 1, systems: [sys('amiga', 10)] },
    'games.json': { version: 1, games: [] },
  }));
  assert.equal(data.gamesStatus, 'empty');
});

test('loadData : games.json illisible ou invalide donne le statut invalid, sans planter', async () => {
  const systems = { version: 1, systems: [sys('amiga', 10)] };
  const bad = await loadData(fakeFetch({ 'systems.json': systems, 'games.json': { version: 9, games: [] } }));
  assert.equal(bad.gamesStatus, 'invalid');
  const net = await loadData(fakeFetch({ 'systems.json': systems, 'games.json': new Error('réseau') }));
  assert.equal(net.gamesStatus, 'invalid');
  assert.deepEqual(net.games, []);
});

test('loadData : systems.json absent ou invalide est une erreur fatale', async () => {
  await assert.rejects(loadData(fakeFetch({})), /systems\.json/);
  await assert.rejects(loadData(fakeFetch({ 'systems.json': { version: 1, systems: [] } })), /vide/);
});

test('groupGamesBySystem : tous les systèmes présents, y compris à 0 jeu, jeux triés par titre', () => {
  const systems = validateSystems({ version: 1, systems: [sys('amiga', 10), sys('neogeo', 20)] });
  const map = groupGamesBySystem(systems, [game('neogeo', 'b', { title: 'Zebre' }), game('neogeo', 'a', { title: 'abeille' })]);
  assert.deepEqual(map.get('amiga'), []);
  assert.deepEqual(map.get('neogeo').map((g) => g.title), ['abeille', 'Zebre']);
});

test('assetUrl : encodeURI sur les chemins (espaces, accents, apostrophes), null reste null', () => {
  assert.equal(assetUrl('roms/amiga/Lemmings 2 é\'.adf'), 'roms/amiga/Lemmings%202%20%C3%A9\'.adf');
  assert.equal(assetUrl(null), null);
});

test('encodeGameId : encodeURIComponent (le / de l\'id est encodé)', () => {
  assert.equal(encodeGameId('neogeo/mslug 2&x'), 'neogeo%2Fmslug%202%26x');
});

test('validateGames : champ disks (T10) accepté s\'il liste au moins 2 chemins sûrs commençant par file, sinon le jeu est écarté', () => {
  const base = { id: 'amiga/x', system: 'amiga', title: 'X', file: 'roms/amiga/x1.adf', cover: null };
  const raw = { version: 1, games: [
    { ...base, disks: ['roms/amiga/x1.adf', 'roms/amiga/x2.adf'] },
    { ...base, id: 'amiga/y', disks: ['roms/amiga/x1.adf'] },
    { ...base, id: 'amiga/z', disks: ['roms/amiga/x1.adf', '../secret.adf'] },
    { ...base, id: 'amiga/w', disks: ['roms/amiga/x2.adf', 'roms/amiga/x1.adf'] },
    { ...base, id: 'amiga/v', disks: 'roms/amiga/x1.adf' },
    { ...base, id: 'amiga/u' },
  ] };
  const { games, skipped } = validateGames(raw, ['amiga']);
  assert.deepEqual(games.map((g) => g.id), ['amiga/x', 'amiga/u']);
  assert.equal(skipped, 4);
});
