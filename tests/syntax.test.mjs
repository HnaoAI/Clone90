// T13 : garde-fou contre les erreurs de syntaxe dans les fichiers du navigateur (js/, sw.js, scripts/).
// Pourquoi : une apostrophe non échappée dans js/ui/error-screen.js a cassé tout le site sans qu'aucun test ne le voie,
// car aucun test n'importe app.js ni les écrans. `node --check` analyse un fichier sans l'exécuter, donc sans DOM.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Liste récursive des fichiers .js et .mjs d'un dossier (chemins absolus). */
function listScripts(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return listScripts(full);
    return /\.(m?js)$/.test(name) ? [full] : [];
  });
}

const files = [...listScripts(join(ROOT, 'js')), ...listScripts(join(ROOT, 'scripts')), join(ROOT, 'sw.js')];

test('T13 : le site contient bien des fichiers JavaScript à vérifier', () => {
  assert.ok(files.length > 10, `seulement ${files.length} fichiers trouvés`);
});

for (const file of files) {
  test(`T13 : syntaxe valide : ${file.slice(ROOT.length + 1)}`, () => {
    try {
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' });
    } catch (error) {
      assert.fail(String(error.stderr ?? error.message).split('\n').slice(0, 6).join('\n'));
    }
  });
}
