// Logo d'une machine et sa couleur d'accent (T5, extrait en T6) : partagés par l'accueil et la grille de jeux. Dépend de ui/dom.js.
import { el } from './dom.js';

const NEUTRAL_ACCENT = 'var(--panel-2)';

/**
 * Couleur d'accent d'une machine sous forme de valeur CSS. Seule une variable `--m-xxx` est acceptée
 * (le champ vient d'un fichier JSON : pas de CSS arbitraire).
 * @param {string|undefined} accent ex. "--m-amiga"
 */
export const accentVar = (accent) => (/^--m-[a-z0-9]+$/.test(accent ?? '') ? `var(${accent})` : NEUTRAL_ACCENT);

/** Repli du logo : le nom de la machine en police pixel sur sa couleur d'accent (décoratif, le nom réel est dans la tuile). */
const logoFallback = (name, doc) => el('span', { class: 'logo-fallback', text: name, attrs: { 'aria-hidden': 'true' } }, [], doc);

/**
 * Zone du logo d'une machine : image, remplacée par le repli si elle manque ou ne charge pas (jamais d'image cassée, CA-C2).
 * @param {{logo: string|null, name: string, accent: string}} tile logo déjà encodé, nom, couleur CSS (voir accentVar)
 * @param {Document} doc
 */
export function createLogo(tile, doc) {
  const box = el('span', { class: 'machine-logo', attrs: { style: `--tile-accent: ${tile.accent}`, 'aria-hidden': 'true' } }, [], doc);
  if (!tile.logo) { box.append(logoFallback(tile.name, doc)); return box; }
  const img = el('img', { attrs: { src: tile.logo, alt: '', loading: 'lazy', decoding: 'async' } }, [], doc);
  img.addEventListener('error', () => box.replaceChildren(logoFallback(tile.name, doc)));
  box.append(img);
  return box;
}
