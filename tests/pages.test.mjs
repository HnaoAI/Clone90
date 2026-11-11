// Tests de la publication GitHub Pages (T17) : .nojekyll présent, jamais servi ni mis en cache, aucun nom en « _ » dans le site publié.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { PROJECT_ROOT, createStaticServer } from '../scripts/serve.mjs';

const loadSw = () => {
  const sandbox = { URL, decodeURIComponent, self: null };
  sandbox.self = { addEventListener: () => {}, location: new URL('https://hnaoai.github.io/Clone90/sw.js?v=1.0.0') };
  vm.runInNewContext(readFileSync(join(PROJECT_ROOT, 'sw.js'), 'utf8'), sandbox);
  return sandbox.self.Clone90SW;
};

test('Pages : .nojekyll existe à la racine (GitHub Pages ne lance pas Jekyll)', () => {
  assert.ok(existsSync(join(PROJECT_ROOT, '.nojekyll')));
});

test('Pages : .nojekyll n\'est ni dans la coquille du service worker ni mis en cache', () => {
  const sw = loadSw();
  assert.ok(!sw.SHELL_FILES.some((f) => f.includes('nojekyll')));
  assert.equal(sw.shouldHandle('GET', 'https://hnaoai.github.io/Clone90/.nojekyll', 'https://hnaoai.github.io/Clone90/'), false);
});

test('Pages : le serveur local ne sert pas .nojekyll (fichier caché, 403) et le reste du site répond toujours', async () => {
  const server = createStaticServer({ root: PROJECT_ROOT });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const hidden = await fetch(`${base}/.nojekyll`);
    assert.equal(hidden.status, 403);
    await hidden.text();
    const home = await fetch(`${base}/index.html`);
    assert.equal(home.status, 200);
    await home.text();
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Pages : aucun fichier ni dossier du site publié ne commence par « _ » (Jekyll l\'ignorerait sans .nojekyll)', () => {
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return [name, ...(statSync(full).isDirectory() ? walk(full) : [])];
  });
  const names = ['css', 'js', 'data', 'assets'].flatMap((d) => walk(join(PROJECT_ROOT, d)));
  assert.deepEqual(names.filter((n) => n.startsWith('_')), []);
});
