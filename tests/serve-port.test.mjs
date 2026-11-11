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

// T20 : adresse d'écoute (le lanceur Mac n'expose pas les jeux sur le réseau).
import { resolveHost, isLocalOnlyHost, DEFAULT_HOST } from '../scripts/serve.mjs';

test('hôte par défaut : toutes les interfaces (téléphone Android)', () => {
  assert.equal(DEFAULT_HOST, '0.0.0.0');
  assert.equal(resolveHost([], {}), '0.0.0.0');
});

test('hôte configurable par --host et HOST, --host prioritaire', () => {
  assert.equal(resolveHost(['--host', '127.0.0.1'], {}), '127.0.0.1');
  assert.equal(resolveHost(['--host=127.0.0.1'], { HOST: '10.0.0.1' }), '127.0.0.1');
  assert.equal(resolveHost([], { HOST: 'localhost' }), 'localhost');
});

test('hôte vide : erreur explicite', () => {
  assert.throws(() => resolveHost(['--host', ''], {}), /adresse/i);
  assert.throws(() => resolveHost(['--host'], {}), /adresse/i);
});

test('adresses locales : pas de ligne "Réseau local"', () => {
  for (const h of ['127.0.0.1', 'localhost', '::1', '127.0.0.2']) assert.ok(isLocalOnlyHost(h), h);
  for (const h of ['0.0.0.0', '192.168.1.5', '::']) assert.ok(!isLocalOnlyHost(h), h);
});
