// Tests du design « Cartouche bleue » (T24) : palette et contrastes (calculés comme dans scripts/generate-logos.mjs),
// couleur déclarée une seule fois, animations couvertes par prefers-reduced-motion, clignotement sous le seuil WCAG, accessibilité du focus.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/project-root.mjs';
import { readCssColors, contrastRatio, hexToRgb } from '../scripts/css-colors.mjs';
import { LOGO_TEXT_COLOR } from '../scripts/generate-logos.mjs';
import { drawIcon } from '../scripts/generate-icons.mjs';

const read = (f) => readFileSync(join(PROJECT_ROOT, f), 'utf8');
const cssFiles = readdirSync(join(PROJECT_ROOT, 'css')).filter((f) => f.endsWith('.css'));
const css = Object.fromEntries(cssFiles.map((f) => [f, read(`css/${f}`)]));
const baseCss = css['base.css'];
const c = readCssColors(baseCss);
const rootBlock = /:root \{[^}]*\}/.exec(baseCss)[0];

test('palette : les variables de la maquette validée sont présentes avec leurs valeurs', () => {
  const expected = {
    '--bg': '#0a1233', '--band': '#0e1b52', '--panel': '#16296e', '--panel-2': '#1f3a9c', '--panel-3': '#2646b0',
    '--line': '#000000', '--bevel-hi': '#6fa8ff', '--bevel-lo': '#0a1a66', '--text': '#ffffff', '--text-muted': '#b9c8ff',
    '--accent': '#ffd23f', '--on-accent': '#1a1200', '--focus': '#3ee0ff', '--danger': '#b3202a', '--danger-text': '#ff8a8a',
    '--disabled-bg': '#1b2147',
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(c[name], value, name);
});

test('contrastes texte 4.5:1 : texte et texte discret sur chaque fond, texte sombre sur le jaune, texte sur les couleurs machine', () => {
  const pairs = [
    ['--text', '--bg'], ['--text', '--band'], ['--text', '--panel'], ['--text', '--panel-2'], ['--text', '--panel-3'],
    ['--text', '--bg-deep'], ['--text', '--band-deep'],
    ['--text-muted', '--bg'], ['--text-muted', '--band'], ['--text-muted', '--panel'], ['--text-muted', '--panel-2'], ['--text-muted', '--disabled-bg'],
    ['--text-muted', '--bg-deep'], ['--accent', '--bg'], ['--accent', '--band'], ['--accent', '--panel'], ['--accent', '--bg-deep'],
    ['--on-accent', '--accent'], ['--text', '--danger'], ['--danger-text', '--panel'], ['--danger-text', '--bg-deep'], ['--danger-text', '--band-deep'],
    ...Object.keys(c).filter((n) => n.startsWith('--m-')).map((m) => ['--text', m]),
  ];
  for (const [fg, bg] of pairs) assert.ok(contrastRatio(c[fg], c[bg]) >= 4.5, `${fg} sur ${bg} : ${contrastRatio(c[fg], c[bg]).toFixed(2)}`);
});

test('contrastes non textuels 3:1 : anneau de focus et biseau clair (limite visible du cadre) sur les fonds', () => {
  for (const fg of ['--focus', '--bevel-hi']) {
    for (const bg of ['--bg', '--band', '--panel', '--bg-deep']) assert.ok(contrastRatio(c[fg], c[bg]) >= 3, `${fg} sur ${bg}`);
  }
  assert.ok(contrastRatio(c['--focus'], c['--panel-2']) >= 3, 'focus sur boutons secondaires');
  assert.ok(contrastRatio(c['--accent'], c['--bg']) >= 3, 'cadre jaune du focus sur le fond');
});

test('contrastes documentés : valeurs de la proposition retrouvées par le même calcul', () => {
  const near = (a, b, expected) => assert.ok(Math.abs(contrastRatio(c[a], c[b]) - expected) < 0.02, `${a}/${b}`);
  near('--text', '--bg', 18.3); near('--text', '--panel', 13.32); near('--text-muted', '--panel-2', 5.96);
  near('--on-accent', '--accent', 12.86); near('--text', '--danger', 6.65); near('--danger-text', '--panel', 5.87);
});

test('une seule source pour chaque couleur : aucune couleur littérale hors du bloc :root des feuilles de style', () => {
  for (const [file, text] of Object.entries(css)) {
    const outside = (file === 'base.css' ? text.replace(rootBlock, '') : text).replace(/\/\*[\s\S]*?\*\//g, '');
    assert.deepEqual(outside.match(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/gi) ?? [], [], `couleur littérale hors :root dans css/${file}`);
  }
});

test('toute variable utilisée dans les CSS et les JS est déclarée dans :root (pas de reste de l\'ancienne palette)', () => {
  const declared = new Set([...rootBlock.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]));
  // Variables posées en ligne ou par une règle, pas dans :root.
  const local = new Set(['--tile-accent', '--bevel-top', '--bevel-bottom', '--cols']);
  const jsFiles = ['js/ui/logo.js', 'js/ui/game-grid.js', 'js/ui/machine-grid.js'];
  const sources = [...Object.entries(css).map(([f, t]) => [`css/${f}`, t]), ...jsFiles.map((f) => [f, read(f)])];
  for (const [file, text] of sources) {
    for (const [, name] of text.matchAll(/var\((--[a-z0-9-]+)/g)) assert.ok(declared.has(name) || local.has(name), `${name} non déclarée (${file})`);
  }
  for (const old of ['--surface', '--border', '--disabled:', '--radius']) assert.ok(!baseCss.includes(old), `${old} supprimée`);
});

test('couleurs machine inchangées (les logos les lisent dans base.css)', () => {
  assert.equal(c['--m-neogeo'], '#7a5a06');
  assert.equal(c['--m-amiga'], '#a84300');
  assert.equal(c['--m-arcade'], '#c0392b');
  assert.equal(Object.keys(c).filter((n) => n.startsWith('--m-')).length, 14); // 12, puis PC Engine et PC Engine CD (T30)
});

test('logos, manifeste, pages et icônes reprennent la palette de base.css (aucune copie qui diverge)', () => {
  assert.equal(LOGO_TEXT_COLOR, c['--text']);
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.theme_color, c['--bg']);
  assert.equal(manifest.background_color, c['--bg']);
  for (const page of ['index.html', 'player.html']) assert.match(read(page), new RegExp(`<meta name="theme-color" content="${c['--bg']}">`), page);
  const rgb = drawIcon(192, 0.5);
  assert.deepEqual([...rgb.subarray(0, 3)], hexToRgb(c['--bg']), 'fond de l\'icône');
  assert.ok(rgb.toString('hex').includes(Buffer.from(hexToRgb(c['--accent'])).toString('hex')), 'lettres de l\'icône en jaune');
});

test('prefers-reduced-motion : la règle coupe animations et transitions sur tous les éléments et pseudo-éléments', () => {
  const block = /@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{([^}]*)\}/.exec(baseCss);
  assert.ok(block, 'règle globale absente de base.css');
  assert.match(block[1], /animation:\s*none\s*!important/);
  assert.match(block[1], /transition:\s*none\s*!important/);
});

test('prefers-reduced-motion : toute animation déclarée dans css/ utilise un @keyframes connu et vit dans une feuille chargée avec base.css', () => {
  const keyframes = new Set(Object.values(css).flatMap((t) => [...t.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1])));
  assert.deepEqual([...keyframes], ['blink']);
  const withAnimation = [];
  for (const [file, text] of Object.entries(css)) {
    for (const [, value] of text.matchAll(/(?<![\w-])animation:\s*([^;}]+)/g)) {
      if (/^none\b/.test(value.trim())) continue;
      withAnimation.push(file);
      assert.ok(keyframes.has(value.trim().split(/\s+/)[0]), `${file} : ${value}`);
    }
  }
  // Curseur (base.css) et « PRÊT ? » (player.css) : les deux sont bien trouvés, donc couverts par le test ci-dessus.
  assert.deepEqual([...new Set(withAnimation)].sort(), ['base.css', 'player.css']);
  for (const page of ['index.html', 'player.html']) assert.match(read(page), /css\/base\.css/, `${page} charge base.css (règle reduced-motion)`);
});

test('clignotement : une période de 1 s (1 Hz), sous les 3 flashs par seconde de WCAG 2.3.1, pour le curseur et « PRÊT ? »', () => {
  const durations = Object.values(css).flatMap((t) => [...t.matchAll(/animation:\s*blink\s+([\d.]+)s/g)].map((m) => Number(m[1])));
  assert.equal(durations.length, 2);
  for (const d of durations) assert.ok(1 / d <= 1, `${d} s`);
  assert.match(baseCss, /@keyframes blink \{ 50% \{ opacity: 0; \} \}/, 'le curseur ne fait que disparaître et revenir');
});

test('accessibilité du focus : anneau de 4 px, curseur forme texte masqué à la technologie d\'assistance, plaque inversée, échelle 1.05', () => {
  assert.match(baseCss, /a:focus-visible, button:focus-visible,[^{]*\{\s*outline: 4px solid var\(--focus\)/);
  assert.match(baseCss, /content: "\\25B6\\FE0E" \/ ""/, 'alternative vide : le curseur n\'est pas lu');
  assert.match(css['home.css'], /machine-tile:focus-visible \.machine-name[^{]*\{[^}]*background: var\(--accent\)/);
  assert.match(css['grid.css'], /game-tile:focus-visible \.game-title[^{]*\{[^}]*background: var\(--accent\)/);
  assert.match(css['home.css'], /transform: scale\(1\.05\)/);
  assert.match(css['home.css'], /prefers-reduced-motion[\s\S]*transform: none/, 'échelle supprimée en reduced-motion');
  assert.match(css['grid.css'], /prefers-reduced-motion[\s\S]*transform: none/);
});

test('accessibilité : cibles tactiles d\'au moins 48 px, coins carrés, pas de clip-path (il couperait l\'anneau de focus)', () => {
  assert.match(baseCss, /\.button, \.back-button, \.menu-button \{[^}]*min-height: 48px/);
  assert.match(css['player.css'], /\.play-button \{[^}]*min-height: 64px/);
  for (const [file, text] of Object.entries(css)) assert.doesNotMatch(text.replace(/\/\*[\s\S]*?\*\//g, ''), /border-radius|clip-path/, `css/${file}`);
});

test('mobile 360 px : pas de largeur fixe supérieure à l\'écran dans les règles mobiles (grilles à 2 colonnes souples)', () => {
  assert.match(css['grid.css'], /@media \(max-width: 599px\) \{ \.game-list \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css['home.css'], /@media \(max-width: 599px\) \{ \.machine-list \{ --cols: 2/);
  assert.match(baseCss, /overflow-x: hidden/);
});
