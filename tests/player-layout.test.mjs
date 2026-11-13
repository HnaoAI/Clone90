// Tests de la mise en page du jeu sur téléphone (T28) : le bouton Menu et le menu d'EmulatorJS ne recouvrent plus l'image du jeu.
// Lit css/player.css (pas de navigateur ici). La vérification en navigateur réel est tests/recette/mobile-menu.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/project-root.mjs';

const css = readFileSync(join(PROJECT_ROOT, 'css/player.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

/** Corps du premier bloc `@media <condition>` dont la condition contient `needle`. */
function mediaBlock(needle) {
  const start = css.indexOf('@media', css.search(new RegExp(`@media[^{]*${needle.replace(/[()/]/g, '\\$&')}`)));
  assert.ok(start >= 0, `bloc @media avec ${needle} absent`);
  let depth = 0;
  for (let i = css.indexOf('{', start); i < css.length; i++) {
    if (css[i] === '{') depth++;
    if (css[i] === '}' && --depth === 0) return css.slice(start, i + 1);
  }
  throw new Error('bloc @media non fermé');
}

const rule = (text, selector) => {
  const m = new RegExp(`(?:^|[}\\s])${selector.replace(/[.#()[\]]/g, '\\$&')}\\s*\\{([^}]*)\\}`).exec(text);
  return m ? m[1] : null;
};

test('Bouton menu ne recouvre pas le jeu en portrait : une barre en haut est réservée, le jeu commence dessous', () => {
  const block = mediaBlock('orientation: portrait');
  const bar = rule(block, '.player-body');
  assert.ok(bar, '.player-body absent du bloc portrait');
  assert.match(bar, /--player-bar:\s*calc\(\s*\d+px\s*\+\s*env\(safe-area-inset-top/, 'hauteur de barre avec safe-area');
  const game = rule(css, '#game');
  assert.match(game, /top:\s*var\(--player-bar/, '#game commence sous la barre');
  // EmulatorJS (.ejs_parent) impose height: 100 % : sans hauteur réduite, le bas des contrôles virtuels sortirait de l'écran.
  assert.match(game, /height:\s*calc\(100%\s*-\s*var\(--player-bar\)\)/, 'hauteur du jeu réduite de la barre');
});

test('Bouton menu ne recouvre pas le jeu en portrait : la barre est plus haute que le bouton Menu (16 px + 48 px + anneau)', () => {
  const px = Number(/--player-bar:\s*calc\(\s*(\d+)px/.exec(mediaBlock('orientation: portrait'))[1]);
  assert.ok(px >= 16 + 48 + 6, `barre de ${px} px trop basse pour le bouton Menu`);
});

test('Bouton menu ne recouvre pas le jeu en paysage de téléphone : pas de barre (le jeu est centré, les côtés sont libres)', () => {
  const root = /:root\s*\{([^}]*)\}/.exec(readFileSync(join(PROJECT_ROOT, 'css/base.css'), 'utf8'))[1];
  assert.match(root, /--player-bar:\s*0px/, 'barre nulle par défaut (base.css :root)');
  const cond = /@media([^{]*orientation: portrait[^{]*)\{/.exec(css)[1];
  assert.doesNotMatch(cond, /orientation: landscape/);
});

test('Bouton menu ne recouvre pas le jeu sur tablette en paysage (4:3) : la barre est aussi réservée', () => {
  const cond = /@media([^{]*orientation: portrait[^{]*)\{/.exec(css)[1];
  assert.match(cond, /max-aspect-ratio:\s*3\s*\/\s*2/);
});

test('Menu d\'EmulatorJS (☰, en haut à droite) : rangé dans la barre, hors de l\'image, et cible tactile de 48 px', () => {
  const r = rule(css, '.player-body .ejs_virtualGamepad_open');
  assert.ok(r, 'règle .ejs_virtualGamepad_open absente');
  assert.match(r, /position:\s*fixed/);
  assert.match(r, /top:\s*calc\(\s*\d+px\s*\+\s*env\(safe-area-inset-top/);
  assert.match(r, /right:\s*calc\(\s*\d+px\s*\+\s*env\(safe-area-inset-right/);
  assert.match(r, /width:\s*48px/);
  assert.match(r, /height:\s*48px/);
});

// T31 : manette tactile d'EmulatorJS (demande de Hicham, 2026-11-13). Vérification en navigateur réel : tests/recette/manette-tactile.mjs.
/** Bloc @media du paysage de téléphone (complément du bloc portrait / 3:2 de T28). */
const landscape = () => mediaBlock('min-aspect-ratio: 3/2');

test('Joystick gris clair : le joystick tactile (nipplejs, rouge par défaut, posé en style en ligne) est forcé en gris clair', () => {
  const m = /([^{}]*\.nipple[^{}]*)\{([^}]*)\}/.exec(css);
  assert.ok(m, 'règle .nipple absente de player.css');
  assert.match(m[1], /\.ejs_virtualGamepad_parent \.nipple \.front/);
  assert.match(m[1], /\.ejs_virtualGamepad_parent \.nipple \.back/);
  // !important : nipplejs écrit background dans l'attribut style, qu'une règle normale ne peut pas battre.
  assert.match(m[2], /background:\s*(lightgr[ae]y|#d3d3d3)\s*!important/);
  // nipplejs pose une opacité de 0,5 (style en ligne) : sans la relever, le gris clair paraît gris foncé sur fond noir.
  assert.match(rule(css, '.player-body .ejs_virtualGamepad_parent .nipple .front') ?? '', /opacity:\s*0\.[6-9]\d*\s*!important/);
});

test('Boutons Select, Start, Slow et Fast sous le joystick en paysage : bloc paysage de téléphone, complément du bloc portrait', () => {
  assert.match(landscape(), /@media\s*\(orientation: landscape\)\s*and\s*\(min-aspect-ratio: 3\/2\)/);
});

test('Boutons Select, Start, Slow et Fast sous le joystick en paysage : leur groupe est à gauche, de la largeur du joystick, sous lui', () => {
  const r = rule(landscape(), '.player-body .ejs_virtualGamepad_bottom');
  assert.ok(r, '.ejs_virtualGamepad_bottom absent du bloc paysage');
  // Joystick (emulator.css 4.2.3) : left 10 px, largeur 125 px, bas à 50 px du conteneur ; le groupe descend sous ce bas.
  assert.match(r, /left:\s*10px/);
  assert.match(r, /width:\s*125px/);
  assert.match(r, /margin-left:\s*0/);
  assert.match(r, /bottom:\s*-\d+px/);
  assert.match(r, /display:\s*grid/);
});

test('Boutons Select, Start, Slow et Fast sous le joystick en paysage : rangés dans la grille (positions d\'EmulatorJS ignorées), Select et Start puis Slow et Fast', () => {
  const block = landscape();
  assert.match(rule(block, '.player-body .ejs_virtualGamepad_bottom .ejs_virtualGamepad_button') ?? '', /position:\s*static/);
  const order = (id) => Number(/order:\s*(\d+)/.exec(rule(block, `.player-body .ejs_virtualGamepad_bottom .b_${id}`) ?? '')?.[1]);
  assert.ok(order('select') < order('start') && order('start') < order('speed_slow') && order('speed_slow') < order('speed_fast'));
});

test('Boutons en portrait : pas touchés (ils sont déjà sous l\'image du jeu)', () => {
  assert.doesNotMatch(mediaBlock('orientation: portrait'), /ejs_virtualGamepad_bottom/);
  assert.equal(rule(css.replace(/@media[^{]*\{[\s\S]*?\}\s*\}/g, ''), '.player-body .ejs_virtualGamepad_bottom'), null);
});
