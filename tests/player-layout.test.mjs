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
