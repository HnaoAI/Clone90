// Tests de « Choisir le dossier des jeux.command » (T23) : contenu, syntaxe (sans l'exécuter), bits exécutables, jamais servi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { PROJECT_ROOT, createStaticServer } from '../scripts/serve.mjs';

const NAMES = ['Choisir le dossier des jeux.command', 'Lancer Clone90.command'];
const read = (name) => readFileSync(join(PROJECT_ROOT, name), 'utf8');

for (const name of NAMES) {
  test(`${name} : exécutable, shebang bash, bash -n valide, sans tiret cadratin ni sudo`, () => {
    assert.ok(statSync(join(PROJECT_ROOT, name)).mode & 0o100, 'bit exécutable manquant');
    assert.match(read(name), /^#!\/bin\/bash\n/);
    assert.equal(spawnSync('bash', ['-n', join(PROJECT_ROOT, name)], { encoding: 'utf8' }).status, 0);
    assert.ok(!read(name).includes('—'));
    assert.doesNotMatch(read(name), /\bsudo\b|\bdefaults write\b|\bwget\b|\bcurl\b.*https?:\/\/(?!localhost)/);
  });
}

test('choisir le dossier : boîte « choisir un dossier », choix des BIOS ou garder bios/, annulation sans écriture', () => {
  const s = read(NAMES[0]);
  assert.match(s, /osascript -e "POSIX path of \(choose folder with prompt/);
  assert.match(s, /Choisissez le dossier qui contient vos ROMs/);
  assert.match(s, /Garder bios\/ du projet/);
  assert.match(s, /local-settings\.mjs set romsDir/);
  assert.match(s, /local-settings\.mjs set biosDir/);
  assert.match(s, /\|\| annuler/);
  assert.match(s, /local-settings\.mjs check/);
  assert.match(s, /choisir_dossier_valide "Choisissez le dossier qui contient vos ROMs"/);
  assert.ok(s.indexOf('|| annuler') < s.indexOf('local-settings.mjs set'), 'rien n\'est écrit avant les deux choix');
  assert.match(s, /read -n 1 -s -r -p/);
});

test('choisir le dossier : rappelle de relancer Clone90 s\'il est déjà ouvert', () => {
  assert.match(read(NAMES[0]), /Si Clone90 est déjà ouvert, fermez sa fenêtre Terminal puis relancez Lancer Clone90\./);
});

test('lanceur : affiche le dossier des jeux via le générateur, sans autre changement de démarrage', () => {
  const s = read(NAMES[1]);
  assert.match(s, /node scripts\/generate-games\.mjs/);
  assert.match(s, /node scripts\/serve\.mjs --host 127\.0\.0\.1/);
});

test('les deux fichiers .command ne sont jamais servis', async () => {
  const server = createStaticServer({ root: PROJECT_ROOT });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    for (const name of NAMES) {
      const res = await fetch(`http://127.0.0.1:${server.address().port}/${encodeURIComponent(name)}`);
      assert.ok([403, 404].includes(res.status), name);
    }
  } finally { server.close(); }
});
