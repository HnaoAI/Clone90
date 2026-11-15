// Tests du design (T24, palette et formes remplacées par le style Y2K de T41, maquette validée par Hicham le 2026-11-15) :
// palette et contrastes (calculés comme dans scripts/generate-logos.mjs), couleur déclarée une seule fois, animations couvertes par prefers-reduced-motion, clignotement sous le seuil WCAG, accessibilité du focus.
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

test('T41 CA1 palette Y2K : les variables de la maquette validée sont présentes avec leurs valeurs', () => {
  const expected = {
    '--sky': '#2a8cff', '--bg': '#1239b0', '--bg-mid': '#3a1690', '--band': '#8a0f6e',
    '--panel': '#0d3fb8', '--panel-2': '#1a55d6', '--panel-3': '#2a62dc',
    '--line': '#000000', '--text': '#ffffff', '--text-muted': '#d6e4ff',
    '--accent': '#ffe11a', '--on-accent': '#2a1a00', '--focus': '#c8ff3d', '--danger': '#c4122a', '--danger-text': '#ffb3b8',
    '--disabled-bg': '#4a5370',
    '--pink': '#c8007f', '--blue': '#0f55d8', '--lime': '#7ee01a', '--on-lime': '#102600', '--violet': '#6a1fe0',
    '--chrome': '#c9d2de', '--ink': '#16133a',
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(c[name], value, name);
});

test('T41 CA2 contrastes texte 4.5:1 : texte et texte discret sur chaque fond, texte sombre sur le jaune et le chrome, texte sur les bulles et les couleurs machine', () => {
  const pairs = [
    ['--text', '--bg'], ['--text', '--bg-mid'], ['--text', '--band'], ['--text', '--panel'], ['--text', '--panel-2'], ['--text', '--panel-3'],
    ['--text', '--bg-deep'], ['--text', '--band-deep'],
    ['--text-muted', '--bg'], ['--text-muted', '--bg-mid'], ['--text-muted', '--band'], ['--text-muted', '--panel'], ['--text-muted', '--panel-2'],
    ['--text-muted', '--disabled-bg'], ['--text-muted', '--bg-deep'],
    ['--accent', '--bg'], ['--accent', '--bg-mid'], ['--accent', '--band'], ['--accent', '--panel'], ['--accent', '--bg-deep'],
    ['--on-accent', '--accent'], ['--text', '--danger'], ['--danger-text', '--panel'], ['--danger-text', '--bg-deep'], ['--danger-text', '--band-deep'],
    ['--text', '--pink'], ['--text', '--blue'], ['--text', '--violet'], ['--on-lime', '--lime'], ['--text', '--disabled-bg'],
    ['--ink', '--chrome'], ['--ink', '--chrome-hi'], ['--ink', '--logo-plaque'],
    ...Object.keys(c).filter((n) => n.startsWith('--m-')).map((m) => ['--text', m]),
  ];
  for (const [fg, bg] of pairs) assert.ok(contrastRatio(c[fg], c[bg]) >= 4.5, `${fg} sur ${bg} : ${contrastRatio(c[fg], c[bg]).toFixed(2)}`);
});

test('T41 CA2 contrastes non textuels 3:1 : anneau de focus et halo jaune sur les fonds et les bulles', () => {
  for (const bg of ['--bg', '--bg-mid', '--band', '--panel', '--panel-2', '--pink', '--blue', '--violet', '--bg-deep']) {
    assert.ok(contrastRatio(c['--focus'], c[bg]) >= 3, `--focus sur ${bg}`);
    assert.ok(contrastRatio(c['--accent'], c[bg]) >= 3, `--accent sur ${bg}`);
  }
});

test('contrastes documentés : valeurs de docs/ux.md 5.2 retrouvées par le même calcul', () => {
  const near = (a, b, expected) => assert.ok(Math.abs(contrastRatio(c[a], c[b]) - expected) < 0.02, `${a}/${b} : ${contrastRatio(c[a], c[b]).toFixed(2)}`);
  near('--text', '--bg', 9.38); near('--text', '--panel', 8.68); near('--text-muted', '--panel-2', 4.95);
  near('--on-accent', '--accent', 12.87); near('--text', '--danger', 6.06); near('--danger-text', '--panel', 5.12);
  near('--text', '--pink', 5.58); near('--on-lime', '--lime', 9.67); near('--ink', '--chrome', 11.58);
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
  const local = new Set(['--tile-accent', '--bevel-top', '--bevel-bottom', '--cols', '--gel', '--gel-hi', '--gel-lo', '--gel-text', '--icon']);
  const jsFiles = ['js/ui/logo.js', 'js/ui/game-grid.js', 'js/ui/machine-grid.js', 'js/ui/bottom-nav.js'];
  const sources = [...Object.entries(css).map(([f, t]) => [`css/${f}`, t]), ...jsFiles.map((f) => [f, read(f)])];
  for (const [file, text] of sources) {
    for (const [, name] of text.matchAll(/var\((--[a-z0-9-]+)/g)) assert.ok(declared.has(name) || local.has(name), `${name} non déclarée (${file})`);
  }
  for (const old of ['--surface', '--border', '--disabled:']) assert.ok(!baseCss.includes(old), `${old} supprimée`);
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

test('T41 CA4 accessibilité : cibles tactiles d\'au moins 48 px, formes arrondies, pas de clip-path (il couperait l\'anneau de focus)', () => {
  assert.match(baseCss, /\.button, \.back-button, \.menu-button \{[^}]*min-height: 48px/);
  assert.match(css['player.css'], /\.play-button \{[^}]*min-height: 64px/);
  assert.match(baseCss, /\.button, \.back-button, \.menu-button \{[^}]*border-radius: var\(--pill\)/, 'boutons en pilule');
  assert.match(css['home.css'], /\.machine-tile \{[^}]*border-radius: var\(--round\)/, 'bulles des machines');
  for (const [file, text] of Object.entries(css)) assert.doesNotMatch(text.replace(/\/\*[\s\S]*?\*\//g, ''), /clip-path/, `css/${file}`);
});

test('T41 CA3 police : interface et titres en police arrondie, Press Start 2P gardée pour les visuels de repli et l\'écran de jeu', () => {
  assert.match(rootBlock, /--font-text: "Trebuchet MS"/);
  assert.match(rootBlock, /--font-title: "Arial Rounded MT Bold", "Trebuchet MS"/);
  assert.match(rootBlock, /--font-pixel: "Press Start 2P"/);
  assert.match(baseCss, /\.site-title \{[^}]*font-family: var\(--font-title\)/);
  assert.match(baseCss, /\.screen-title \{[^}]*font-family: var\(--font-title\)/);
  assert.match(css['grid.css'], /\.grid-title \{[^}]*font-family: var\(--font-title\)/);
});

test('T41 CA5 accueil : bulles qui alternent quatre couleurs, voyants ronds, 0 jeu en chrome terne', () => {
  const home = css['home.css'];
  for (const [n, tone] of [['4n+1', 'pink'], ['4n+2', 'blue'], ['4n+3', 'lime'], ['4n+4', 'violet']]) {
    assert.match(home, new RegExp(`\\.machine-item:nth-child\\(${n.replace('+', '\\+')}\\) \\.machine-tile \\{[^}]*--gel: var\\(--${tone}\\)`), tone);
  }
  assert.match(home, /\.gauge i \{[^}]*border-radius: 50%/);
  assert.match(home, /\.machine-tile\.is-empty[^{]*\{[^}]*--gel: var\(--disabled-bg\)/);
  assert.match(home, /\.machine-count \{[^}]*background:[^;]*var\(--chrome\)/, 'pastille chromée');
});

test('mobile 360 px : pas de largeur fixe supérieure à l\'écran dans les règles mobiles (grilles à 2 colonnes souples)', () => {
  assert.match(css['grid.css'], /@media \(max-width: 599px\) \{ \.game-list \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css['home.css'], /@media \(max-width: 599px\) \{ \.machine-list \{ --cols: 2/);
  assert.match(baseCss, /overflow-x: hidden/);
});
