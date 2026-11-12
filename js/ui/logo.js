// Logo d'une machine et sa couleur d'accent (T5, extrait en T6) : partagés par l'accueil et la grille de jeux. Dépend de ui/dom.js et data.js.
// T29 : logo téléchargé (vrai logo, `downloadedLogo`) d'abord, puis logo maison, puis nom de la machine.
import { el } from './dom.js';
import { assetUrl } from '../data.js';

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
 * Images à essayer pour une machine (T29) : le logo téléchargé s'il existe, avec le logo maison en repli ; sinon le logo maison seul.
 * @param {{logo?: string, downloadedLogo?: string}} machine entrée de systems.json (complétée par loadData)
 * @returns {{logo: string|null, fallbackLogo: string|null, downloaded: boolean}} adresses déjà encodées
 */
export function machineLogoSources(machine) {
  const own = assetUrl(machine.logo ?? null);
  if (!machine.downloadedLogo) return { logo: own, fallbackLogo: null, downloaded: false };
  return { logo: assetUrl(machine.downloadedLogo), fallbackLogo: own, downloaded: true };
}

/**
 * Zone du logo d'une machine : image, remplacée par le repli si elle manque ou ne charge pas (jamais d'image cassée, CA-C2).
 * T29 : un logo téléchargé (`downloaded`) qui ne charge pas laisse place au logo maison (`fallbackLogo`), puis au nom.
 * La classe `is-downloaded` donne au vrai logo un fond neutre (css/home.css) ; elle est retirée quand on retombe sur le logo maison.
 * @param {{logo: string|null, fallbackLogo?: string|null, downloaded?: boolean, name: string, accent: string}} tile adresses déjà encodées, nom, couleur CSS (voir accentVar)
 * @param {Document} doc
 */
export function createLogo(tile, doc) {
  const baseClass = 'machine-logo';
  const box = el('span', { class: tile.downloaded ? `${baseClass} is-downloaded` : baseClass, attrs: { style: `--tile-accent: ${tile.accent}`, 'aria-hidden': 'true' } }, [], doc);
  const sources = [tile.logo, tile.fallbackLogo].filter(Boolean);
  let current = null;
  // Remplace seulement l'image (ou le repli) : ce que l'hôte a ajouté à la zone (jauge de l'accueil) reste en place.
  const put = (node) => {
    if (current === null) box.append(node);
    else box.replaceChildren(node, ...[...box.children].filter((c) => c !== current));
    current = node;
  };
  const showNext = () => {
    const src = sources.shift();
    if (!src) { box.setAttribute('class', baseClass); put(logoFallback(tile.name, doc)); return; }
    if (src !== tile.logo) box.setAttribute('class', baseClass);
    const img = el('img', { attrs: { src, alt: '', loading: 'lazy', decoding: 'async' } }, [], doc);
    img.addEventListener('error', showNext);
    put(img);
  };
  showNext();
  return box;
}
