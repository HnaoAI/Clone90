// Tests du design (T24, style Y2K T41, puis style « Swared » T54, maquette validée par Hicham le 2026-11-22) :
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

test('T54 CA1 palette Swared : les variables de la maquette validée sont présentes avec leurs valeurs', () => {
  const expected = {
    '--bg': '#1f1e1d', '--bg-top': '#34312f', '--bg-deep': '#0d0c0c', '--band-deep': '#141312',
    '--panel': '#1d1c1b', '--panel-2': '#2b2a29', '--panel-3': '#363432',
    '--line': '#000000', '--text': '#ffffff', '--text-muted': '#b3b0ad',
    '--accent': '#3fd04a', '--on-accent': '#0c2a0e', '--focus': '#3fd04a', '--danger': '#c4122a', '--danger-text': '#ff8f87',
    '--dock': '#3a393c', '--dock-text': '#c9c7cb',
  };
  for (const [name, value] of Object.entries(expected)) assert.equal(c[name], value, name);
  for (const old of ['--pink', '--blue', '--lime', '--violet', '--chrome', '--sky', '--band:']) assert.ok(!rootBlock.includes(`${old}`), `${old} supprimée (style Y2K)`);
});

test('T54 CA1 une seule couleur d\'accent : aucun ton saturé autre que le vert dans la palette (hors couleurs machine et danger)', () => {
  const saturated = Object.entries(c).filter(([n]) => !n.startsWith('--m-') && !n.startsWith('--danger') && n !== '--logo-plaque')
    .filter(([, v]) => { const [r, g, b] = hexToRgb(v); return Math.max(r, g, b) - Math.min(r, g, b) > 60; });
  for (const [name, value] of saturated) { const [r, g, b] = hexToRgb(value); assert.ok(g > r && g > b, `${name} ${value} n'est pas un vert`); }
});

test('T54 CA2 contrastes texte 4.5:1 : texte et texte discret sur chaque fond, vert sur les fonds, texte sombre sur le vert, barre du bas', () => {
  const pairs = [
    ...['--bg', '--bg-top', '--panel', '--panel-2', '--panel-3', '--bg-deep', '--band-deep', '--dock'].flatMap((bg) => [['--text', bg], ['--accent', bg]]),
    ...['--bg', '--bg-top', '--panel', '--panel-2', '--panel-3', '--bg-deep'].flatMap((bg) => [['--text-muted', bg], ['--danger-text', bg]]),
    ['--dock-text', '--dock'], ['--on-accent', '--accent'], ['--text', '--danger'],
    ...Object.keys(c).filter((n) => n.startsWith('--m-')).map((m) => ['--text', m]),
  ];
  for (const [fg, bg] of pairs) assert.ok(contrastRatio(c[fg], c[bg]) >= 4.5, `${fg} sur ${bg} : ${contrastRatio(c[fg], c[bg]).toFixed(2)}`);
});

test('T54 CA2 contrastes non textuels 3:1 : anneau de focus et bordure verte de sélection sur tous les fonds', () => {
  for (const bg of ['--bg', '--bg-top', '--panel', '--panel-2', '--panel-3', '--bg-deep', '--dock']) {
    assert.ok(contrastRatio(c['--focus'], c[bg]) >= 3, `--focus sur ${bg}`);
    assert.ok(contrastRatio(c['--accent'], c[bg]) >= 3, `--accent sur ${bg}`);
  }
});

test('contrastes documentés : valeurs de docs/ux.md 5.2 retrouvées par le même calcul', () => {
  const near = (a, b, expected) => assert.ok(Math.abs(contrastRatio(c[a], c[b]) - expected) < 0.02, `${a}/${b} : ${contrastRatio(c[a], c[b]).toFixed(2)}`);
  near('--text', '--bg', 16.64); near('--text-muted', '--panel-2', 6.64); near('--accent', '--panel', 8.37);
  near('--on-accent', '--accent', 7.64); near('--text', '--danger', 6.06);
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
  assert.equal(Object.keys(c).filter((n) => n.startsWith('--m-')).length, 14); // 12, puis PC Engine et PC Engine CD (T30), moins la Game Boy d'origine (T49), plus la Game Boy Advance (T50)
});

test('logos, manifeste, pages et icônes reprennent la palette de base.css (aucune copie qui diverge)', () => {
  assert.equal(LOGO_TEXT_COLOR, c['--text']);
  const manifest = JSON.parse(read('manifest.webmanifest'));
  assert.equal(manifest.theme_color, c['--bg']);
  assert.equal(manifest.background_color, c['--bg']);
  for (const page of ['index.html', 'player.html']) assert.match(read(page), new RegExp(`<meta name="theme-color" content="${c['--bg']}">`), page);
  const rgb = drawIcon(192, 0.5);
  assert.deepEqual([...rgb.subarray(0, 3)], hexToRgb(c['--bg']), 'fond de l\'icône');
  assert.ok(rgb.toString('hex').includes(Buffer.from(hexToRgb(c['--accent'])).toString('hex')), 'lettres de l\'icône en vert (T54)');
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
  // T54 : plus de curseur ▶ ; « PRÊT ? » (player.css) reste, donc couvert par le test ci-dessus.
  assert.deepEqual([...new Set(withAnimation)].sort(), ['player.css']);
  for (const page of ['index.html', 'player.html']) assert.match(read(page), /css\/base\.css/, `${page} charge base.css (règle reduced-motion)`);
});

test('clignotement : une période de 1 s (1 Hz), sous les 3 flashs par seconde de WCAG 2.3.1, pour « PRÊT ? » (seule animation depuis T54)', () => {
  const durations = Object.values(css).flatMap((t) => [...t.matchAll(/animation:\s*blink\s+([\d.]+)s/g)].map((m) => Number(m[1])));
  assert.equal(durations.length, 1);
  for (const d of durations) assert.ok(1 / d <= 1, `${d} s`);
  assert.match(baseCss, /@keyframes blink \{ 50% \{ opacity: 0; \} \}/, '« PRÊT ? » ne fait que disparaître et revenir');
});

test('T54 CA6 accessibilité du focus : anneau de 4 px, sélection des cartes = bordure verte, disque vert, nombre en vert et échelle 1.05', () => {
  assert.match(baseCss, /a:focus-visible, button:focus-visible,[^{]*\{\s*outline: 4px solid var\(--focus\)/);
  const home = css['home.css'];
  assert.match(home, /\.machine-tile:focus-visible, \.input-gamepad \.machine-tile:focus \{[^}]*transform: scale\(1\.05\)[^}]*border-color: var\(--accent\)/);
  assert.match(home, /\.machine-tile:focus-visible \.machine-go, \.input-gamepad \.machine-tile:focus \.machine-go \{[^}]*background: var\(--accent\)/, 'flèche dans un disque vert (forme, pas seulement la couleur)');
  assert.match(home, /\.machine-tile:focus-visible \.machine-count, \.input-gamepad \.machine-tile:focus \.machine-count \{[^}]*color: var\(--accent\)/);
  assert.match(css['grid.css'], /\.game-tile:focus-visible \.game-title, \.input-gamepad \.game-tile:focus \.game-title \{[^}]*color: var\(--accent\)/);
  assert.match(css['grid.css'], /\.game-tile:focus-visible, \.input-gamepad \.game-tile:focus \{[^}]*transform: scale\(1\.05\)/);
  assert.match(home, /prefers-reduced-motion[\s\S]*transform: none/, 'échelle supprimée en reduced-motion');
  assert.match(css['grid.css'], /prefers-reduced-motion[\s\S]*transform: none/);
  assert.doesNotMatch(baseCss, /\\25B6/, 'plus de curseur ▶ clignotant sur les tuiles (T54)');
});

test('T54 CA8 accessibilité : cibles tactiles d\'au moins 48 px (Jouer 64 px), coins arrondis, pas de clip-path (il couperait l\'anneau de focus)', () => {
  assert.match(baseCss, /\.button, \.back-button, \.menu-button \{[^}]*min-height: 48px/);
  assert.match(css['player.css'], /\.play-button \{[^}]*min-height: 64px/);
  assert.match(baseCss, /\.button, \.back-button, \.menu-button \{[^}]*border-radius: var\(--round-sm\)/);
  assert.match(css['home.css'], /\.machine-tile \{[^}]*border-radius: var\(--round\)/);
  assert.match(css['grid.css'], /\.game-tile \{[^}]*border-radius: var\(--round\)/);
  for (const [file, text] of Object.entries(css)) assert.doesNotMatch(text.replace(/\/\*[\s\S]*?\*\//g, ''), /clip-path/, `css/${file}`);
});

test('T54 CA8 boutons : principal vert plein à texte sombre, secondaires sombres à fine bordure claire', () => {
  assert.match(baseCss, /\.button \{[^}]*background: var\(--accent\);[^}]*color: var\(--on-accent\)/);
  assert.match(baseCss, /\.back-button, \.menu-button, \.button\.is-secondary \{[^}]*background: var\(--panel-2\);[^}]*border: 1px solid var\(--edge\)/);
  assert.match(baseCss, /\.dialog-button\.is-danger \{[^}]*background: var\(--danger\)/);
});

test('T54 CA3 police : Nunito intégrée (3 graisses, OFL) pour l\'interface, Press Start 2P gardée pour les visuels de repli et l\'écran de jeu', () => {
  for (const w of [500, 700, 800]) {
    assert.match(baseCss, new RegExp(`font-family: "Nunito";\\s*src: url\\("\\.\\./assets/fonts/Nunito-${w}\\.woff2"\\) format\\("woff2"\\);\\s*font-weight: ${w};`), `Nunito ${w}`);
    assert.ok(readdirSync(join(PROJECT_ROOT, 'assets/fonts')).includes(`Nunito-${w}.woff2`));
  }
  assert.match(read('assets/fonts/Nunito-OFL.txt'), /SIL Open Font License/);
  assert.match(rootBlock, /--font-text: "Nunito"/);
  assert.match(rootBlock, /--font-title: "Nunito"/);
  assert.match(rootBlock, /--font-pixel: "Press Start 2P"/);
  assert.match(baseCss, /\.site-title \{[^}]*font-family: var\(--font-title\)/);
  assert.match(css['grid.css'], /\.grid-title \{[^}]*font-family: var\(--font-title\)/);
});

test('T54 CA5 accueil : cartes noires à fine bordure claire, logo dans une tuile, plus de voyants, 0 jeu délavé', () => {
  const home = css['home.css'];
  assert.match(home, /\.machine-tile \{[^}]*background: var\(--panel\);[^}]*border: 2px solid var\(--edge\)/);
  assert.match(home, /\.machine-logo \{[^}]*background: var\(--panel-2\)/);
  assert.doesNotMatch(home, /\.gauge/);
  assert.match(home, /\.machine-tile\.is-empty \.machine-logo img, \.machine-tile\.is-empty \.logo-fallback \{[^}]*filter: grayscale\(1\)/);
  assert.match(home, /\.machine-tile\.is-empty \.machine-go \{[^}]*display: none/, 'pas de flèche sur une machine vide');
  assert.match(home, /\.home-total \{[^}]*color: var\(--accent\)/, 'gros chiffre vert');
});

test('T54 CA9 barre du bas : grise flottante, onglet actif en vert avec un point', () => {
  const dock = css['dock.css'];
  assert.match(dock, /\.dock \{[^}]*background: var\(--dock\)/);
  assert.match(dock, /\.dock-tab \{[^}]*color: var\(--dock-text\)/);
  assert.match(dock, /\.dock-tab\[aria-current="page"\] \{[^}]*color: var\(--accent\)/);
  assert.match(dock, /\.dock-tab\[aria-current="page"\] \.dock-label::after \{/, 'point sous le libellé actif (forme, pas seulement la couleur)');
  assert.match(dock, /\.dock-icon \{[^}]*background: currentColor/, 'icône de la couleur du libellé');
});

test('mobile 360 px : pas de largeur fixe supérieure à l\'écran dans les règles mobiles (grilles à 2 colonnes souples)', () => {
  assert.match(css['grid.css'], /@media \(max-width: 599px\) \{ \.game-list \{ grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css['home.css'], /@media \(max-width: 599px\) \{ \.machine-list \{ --cols: 2/);
  assert.match(baseCss, /overflow-x: hidden/);
});

test('T54 CA4 en-tête : marque « C90 » décorative et « 90 » en vert, plus de pastille rose ni de jauge ni de plaque chromée', () => {
  const header = /<header class="app-header">([\s\S]*?)<\/header>/.exec(read('index.html'))?.[1] ?? '';
  assert.match(header, /<svg class="header-mark"[^>]*aria-hidden="true"/);
  assert.doesNotMatch(header, /header-orb|header-bars/);
  assert.match(baseCss, /\.site-title-90 \{[^}]*color: var\(--accent\)/);
  assert.doesNotMatch(baseCss, /\.app-header \{[^}]*box-shadow/, 'en-tête à plat, sans plaque');
});
