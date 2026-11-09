// Tests de js/sort.js (T3) : règle de tri des titres partagée par le navigateur et le générateur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareTitles } from '../js/sort.js';
import { groupGamesBySystem } from '../js/data.js';

test('compareTitles : sans casse ni accents', () => {
  assert.ok(compareTitles('abeille', 'Zebre') < 0);
  assert.equal(compareTitles('Élan', 'elan'), 0);
});

test('compareTitles : les nombres se comparent comme des nombres', () => {
  const titles = ['Game 10', 'Game 2', 'Game 1'].sort(compareTitles);
  assert.deepEqual(titles, ['Game 1', 'Game 2', 'Game 10']);
});

test('groupGamesBySystem utilise le même tri que compareTitles', () => {
  const g = (t) => ({ id: `a/${t}`, system: 'a', title: t, file: `roms/a/${t}.zip`, cover: null });
  const map = groupGamesBySystem([{ id: 'a' }], [g('Game 10'), g('Game 2')]);
  assert.deepEqual(map.get('a').map((x) => x.title), ['Game 2', 'Game 10']);
});
