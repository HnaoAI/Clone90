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

// T33 : téléphone en paysage (Hicham, 2026-11-13 : « je ne peux pas lancer de jeu car le bouton disparaît »). Avis ux : écran Jouer en
// 2 colonnes, bandes de 160 px réservées aux commandes en jeu. Vérification en navigateur réel : tests/recette/paysage.mjs.
/** Bloc @media de l'écran Jouer en paysage bas (téléphone couché). */
const lowLandscape = () => mediaBlock('max-height: 500px');

test('Bouton Jouer visible en paysage : bloc paysage bas (téléphone couché, 500 px de haut ou moins)', () => {
  assert.match(lowLandscape(), /@media\s*\(orientation: landscape\)\s*and\s*\(max-height: 500px\)/);
});

test('Bouton Jouer visible en paysage : centrage « safe » (le haut de la jaquette n\'est jamais coupé), défilement de secours', () => {
  const r = rule(lowLandscape(), '.player-screen');
  assert.ok(r, '.player-screen absent du bloc paysage bas');
  assert.match(r, /place-items:\s*safe center/);
  // Marge gauche : le bouton Menu (16 px + ~110 px) ne recouvre ni la jaquette ni le bouton Jouer.
  assert.match(r, /padding:[^;]*calc\(\s*140px\s*\+\s*env\(safe-area-inset-left/);
  assert.match(rule(css, '.player-screen'), /overflow-y:\s*auto/);
});

test('Bouton Jouer visible en paysage : jaquette à gauche, titre, machine, PRÊT ? et Jouer à droite (2 colonnes)', () => {
  const block = lowLandscape();
  const screen = rule(block, '.play-screen:not(.play-message)');
  assert.ok(screen, 'écran Jouer absent du bloc paysage bas (les messages d\'erreur gardent leur pile)');
  assert.match(screen, /display:\s*grid/);
  assert.match(screen, /grid-template-columns:/);
  const cover = rule(block, '.play-screen:not(.play-message) .play-cover');
  assert.match(cover, /grid-row:\s*1\s*\/\s*span\s*4/);
  // Taille de la jaquette réglée sur la hauteur visible (dvh : barre d'adresse comprise), plafonnée.
  assert.match(cover, /width:\s*calc\(\s*min\(\s*100dvh\s*-\s*\d+px\s*,\s*\d+px\s*\)\s*\*\s*0?\.75\s*\)/);
});

test('Commandes hors de l\'image en paysage : 160 px réservés de chaque côté, l\'image n\'est réduite que si les bandes noires sont plus étroites', () => {
  const r = rule(landscape(), '.player-body #game .ejs_canvas_parent');
  assert.ok(r, '.ejs_canvas_parent absent du bloc paysage');
  // Image 4:3 (ou autre) dessinée par le cœur au centre de la toile, bandes noires comprises : réduire la largeur de la toile ne change
  // l'image que si elle était plus large que 100 % - 320 px.
  assert.match(r, /width:\s*calc\(100%\s*-\s*320px\)/);
  assert.match(r, /margin:\s*0 auto/);
});

test('Boutons Select, Start, Slow et Fast sous le joystick en paysage : cibles de 40 px de haut (2 rangées dans les 100 px libres sous le joystick)', () => {
  const block = landscape();
  assert.match(rule(block, '.player-body .ejs_virtualGamepad_bottom .ejs_virtualGamepad_button') ?? '', /height:\s*40px/);
  const r = rule(block, '.player-body .ejs_virtualGamepad_bottom');
  const bottom = -Number(/bottom:\s*-(\d+)px/.exec(r)[1]);
  const gap = Number(/row-gap:\s*(\d+)px/.exec(r)[1]);
  // Conteneur à 50 px du bas de l'écran, joystick de 50 à 175 px au-dessus du conteneur : 2 rangées + écart entre 4 px du bas et le joystick.
  assert.ok(50 + bottom >= 4, 'rangée du bas collée au bord de l\'écran');
  assert.ok(50 + bottom + 2 * 40 + gap <= 50 + 50 - 4, 'rangée du haut touche le joystick');
});
