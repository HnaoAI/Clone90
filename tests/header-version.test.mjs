// Tests T45 : numéro de version dans l'en-tête, juste sous « Clone90 », sur le téléphone (demande de Hicham du 2026-11-15).
// La vérification dans un vrai navigateur (visible, sous le titre, lisible) est dans tests/recette/style-y2k.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/serve.mjs';
import { APP_VERSION, APP_DATE, formatShortVersionLabel } from '../js/version.js';

const read = (f) => readFileSync(join(PROJECT_ROOT, f), 'utf8');
const html = read('index.html');
const baseCss = read('css/base.css').replace(/\/\*[\s\S]*?\*\//g, '');

test('T45 formatShortVersionLabel : « v0.45.0 - 15/11/2026 » (le nom est déjà au-dessus), date mal formée telle quelle', () => {
  assert.equal(formatShortVersionLabel('0.45.0', '2026-11-15'), 'v0.45.0 - 15/11/2026');
  assert.equal(formatShortVersionLabel('0.1.0', 'hier'), 'v0.1.0 - hier');
  assert.equal(formatShortVersionLabel(), `v${APP_VERSION} - ${APP_DATE.split('-').reverse().join('/')}`);
});

test('T45 index.html : la ligne de version est dans l\'en-tête, juste après le titre « Clone90 »', () => {
  const header = /<header class="app-header">([\s\S]*?)<\/header>/.exec(html)?.[1] ?? '';
  assert.match(header, /<h1 class="site-title">[\s\S]*?<\/h1>\s*<p class="site-version"[^>]*><\/p>/, 'p.site-version vide juste après le h1');
  assert.doesNotMatch(html, /\d+\.\d+\.\d+/, 'aucun numéro écrit en dur : js/version.js reste la seule source');
});

test('T45 app.js : la ligne de l\'en-tête est remplie avant le chargement des données (visible même si games.json manque)', () => {
  const app = read('js/app.js');
  const fill = app.indexOf("querySelector('.site-version')");
  assert.ok(fill > 0, 'remplissage de .site-version');
  assert.match(app, /import \{[^}]*formatShortVersionLabel[^}]*\} from '\.\/version\.js'/);
  assert.ok(fill < app.indexOf('data = await loadAll()'), 'avant loadAll');
});

test('T45 css : ligne cachée sur ordinateur (le numéro reste en bas de l\'accueil), affichée sur téléphone, texte foncé sur le chrome', () => {
  assert.match(baseCss, /\.site-version \{[^}]*display: none/);
  assert.match(baseCss, /@media \(max-width: 599px\) \{[^@]*\.site-version \{[^}]*display: block/);
  assert.match(baseCss, /\.site-version \{[^}]*color: var\(--ink\)/);
});
