// Tests du lanceur Mac « Lancer Clone90.command » (T20) : contenu, syntaxe (sans l'exécuter), jamais servi ni mis en cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { PROJECT_ROOT, createStaticServer } from '../scripts/serve.mjs';

const NAME = 'Lancer Clone90.command';
const path = join(PROJECT_ROOT, NAME);
const script = () => readFileSync(path, 'utf8');

test('lanceur Mac : le fichier existe à la racine et est exécutable', () => {
  assert.ok(statSync(path).isFile());
  assert.ok(statSync(path).mode & 0o100, 'bit exécutable manquant');
});

test('lanceur Mac : commence par un shebang bash', () => {
  assert.match(script(), /^#!(\/bin\/bash|\/usr\/bin\/env bash)\n/);
});

test('lanceur Mac : contient les étapes (cd, Node, generate-games, serve, open)', () => {
  const s = script();
  assert.match(s, /cd "\$\(dirname "\$0"\)"/);
  assert.match(s, /command -v node/);
  assert.match(s, /https:\/\/nodejs\.org/);
  assert.match(s, /node scripts\/generate-games\.mjs/);
  assert.match(s, /node scripts\/serve\.mjs/);
  assert.match(s, /http:\/\/localhost:8080\//);
  assert.match(s, /open "\$URL"/);
  assert.match(s, /Clone90 tourne\. Pour l'arrêter, fermez cette fenêtre ou appuyez sur Ctrl \+ C\./);
});

test('lanceur Mac : aucun tiret cadratin, aucun sudo, aucune commande réseau sortante', () => {
  const s = script();
  assert.ok(!s.includes('—'));
  assert.doesNotMatch(s, /\bsudo\b|\bdefaults write\b|\bwget\b/);
  assert.doesNotMatch(s, /https?:\/\/(?!localhost|nodejs\.org)/);
});

test('lanceur Mac : passe bash -n (syntaxe valide, sans exécution)', () => {
  const r = spawnSync('bash', ['-n', path], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('lanceur Mac : le serveur local ne le sert pas (403 ou 404)', async () => {
  const server = createStaticServer({ root: PROJECT_ROOT });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    for (const p of [`/${encodeURIComponent(NAME)}`, '/Lancer Clone90.command'.replace(/ /g, '%20')]) {
      const res = await fetch(base + p);
      assert.ok([403, 404].includes(res.status), `${p} : ${res.status}`);
      await res.text();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('lanceur Mac : absent de la coquille du service worker et jamais intercepté', () => {
  const sandbox = { URL, decodeURIComponent, self: null };
  sandbox.self = { addEventListener: () => {}, location: new URL('https://hnaoai.github.io/Clone90/sw.js?v=1.0.0') };
  vm.runInNewContext(readFileSync(join(PROJECT_ROOT, 'sw.js'), 'utf8'), sandbox);
  const sw = sandbox.self.Clone90SW;
  assert.ok(!sw.SHELL_FILES.some((f) => f.includes('command')));
  assert.equal(sw.isShellPath('Lancer%20Clone90.command'), false);
  assert.equal(sw.isShellPath('Lancer Clone90.command'), false);
});
