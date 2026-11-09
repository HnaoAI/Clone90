// Tests de la lecture du port de scripts/serve.mjs (T1) : option --port, variable PORT, défaut 8080.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolvePort, DEFAULT_PORT } from '../scripts/serve.mjs';

test('port par défaut : 8080', () => {
  assert.equal(DEFAULT_PORT, 8080);
  assert.equal(resolvePort([], {}), 8080);
});

test('port configurable par la variable PORT', () => {
  assert.equal(resolvePort([], { PORT: '9000' }), 9000);
});

test('port configurable par --port, prioritaire sur PORT', () => {
  assert.equal(resolvePort(['--port', '3000'], { PORT: '9000' }), 3000);
  assert.equal(resolvePort(['--port=3001'], {}), 3001);
});

test('port invalide : erreur explicite', () => {
  for (const mauvais of ['abc', '0', '70000', '-1', '80.5', '']) {
    assert.throws(() => resolvePort(['--port', mauvais], {}), /port/i, mauvais);
  }
});
