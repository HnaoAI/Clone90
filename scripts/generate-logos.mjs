// Génère les logos maison des machines (T5b) : assets/logos/<id>.svg, sans dépendance.
// Source unique : systems.json (liste des machines, noms, champ `logo`, champ `accent`) ; la valeur de la couleur d'accent
// est lue dans css/base.css (variable --m-xxx). Motif : nom de la machine en lettres pixel (police maison scripts/pixel-font.mjs)
// sur la couleur d'accent, avec une petite forme géométrique. Aucun logo officiel ni marque stylisée n'est reproduit.
// Usage : node scripts/generate-logos.mjs   (à relancer quand systems.json ou une couleur de base.css change ; les SVG sont commités)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PROJECT_ROOT } from './project-root.mjs';
import { GLYPHS, GLYPH_WIDTH, GLYPH_HEIGHT } from './pixel-font.mjs';

export const LOGO_TEXT_COLOR = '#f2f0e9'; // --text de docs/ux.md 5.2
const MIN_CONTRAST = 4.5;
const VIEW = { width: 160, height: 100 };
const MARGIN = 8;
const TEXT_TOP = 34; // sous la forme décorative
const TEXT_BOTTOM = VIEW.height - MARGIN;
const MAX_CELL = 6;
const LINE_GAP_CELLS = 3;
const SHAPES = [
  (c) => `<polygon points="80,8 92,20 80,32 68,20" fill="${c}"/>`, // losange
  (c) => `<rect x="70" y="10" width="20" height="20" fill="${c}"/>`, // carré
  (c) => `<polygon points="80,8 92,30 68,30" fill="${c}"/>`, // triangle
  (c) => `<circle cx="80" cy="20" r="11" fill="${c}"/>`, // disque
];

/** Variables d'accent de machine déclarées dans le CSS : { '--m-amiga': '#a84300', ... }. */
export function readAccentColors(css) {
  return Object.fromEntries([...css.matchAll(/(--m-[a-z0-9]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Rapport de contraste WCAG entre deux couleurs #rrggbb. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const columnsOf = (line) => line.length * (GLYPH_WIDTH + 1) - 1;

/** Découpes possibles du nom en 1 ou 2 lignes (coupure entre mots seulement). */
function candidateLayouts(words) {
  const layouts = [[words.join(' ')]];
  for (let i = 1; i < words.length; i += 1) layouts.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
  return layouts;
}

/** Meilleure disposition : la plus grande taille de pixel qui tient dans le cadre, puis le moins de lignes. */
function bestLayout(name) {
  const maxWidth = VIEW.width - 2 * MARGIN;
  const maxHeight = TEXT_BOTTOM - TEXT_TOP;
  const options = candidateLayouts(name.toUpperCase().split(/\s+/).filter(Boolean)).map((lines) => {
    const heightCells = lines.length * GLYPH_HEIGHT + (lines.length - 1) * LINE_GAP_CELLS;
    const cell = Math.min(MAX_CELL, Math.floor(maxWidth / Math.max(...lines.map(columnsOf))), Math.floor(maxHeight / heightCells));
    return { lines, cell, heightCells };
  });
  return options.sort((a, b) => b.cell - a.cell || a.lines.length - b.lines.length)[0];
}

/** Tracé SVG du texte : un rectangle par suite horizontale de pixels allumés (fichier court). */
function textPath({ lines, cell, heightCells }) {
  const top = TEXT_TOP + Math.floor((TEXT_BOTTOM - TEXT_TOP - heightCells * cell) / 2);
  const commands = [];
  lines.forEach((line, row) => {
    const left = Math.floor((VIEW.width - columnsOf(line) * cell) / 2);
    const y0 = top + row * (GLYPH_HEIGHT + LINE_GAP_CELLS) * cell;
    for (let y = 0; y < GLYPH_HEIGHT; y += 1) {
      const bits = [...line].map((ch) => GLYPHS[ch][y]).join('0');
      for (const run of bits.matchAll(/1+/g)) {
        commands.push(`M${left + run.index * cell} ${y0 + y * cell}h${run[0].length * cell}v${cell}h-${run[0].length * cell}z`);
      }
    }
  });
  return commands.join('');
}

const escapeXml = (text) => text.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * SVG du logo d'une machine.
 * @param {{id: string, name: string}} system
 * @param {string} color couleur de fond #rrggbb (accent de la machine)
 * @param {number} shapeIndex rang de la machine, choisit la forme décorative
 */
export function buildLogoSvg(system, color, shapeIndex = 0) {
  if (contrastRatio(LOGO_TEXT_COLOR, color) < MIN_CONTRAST) {
    throw new Error(`Contraste insuffisant (< ${MIN_CONTRAST}:1) entre le texte et ${color} pour ${system.id}`);
  }
  const layout = bestLayout(system.name);
  const frame = `<rect x="3" y="3" width="${VIEW.width - 6}" height="${VIEW.height - 6}" fill="none" stroke="${LOGO_TEXT_COLOR}" stroke-width="2"/>`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW.width} ${VIEW.height}" data-lines="${layout.lines.length}">`,
    `<title>${escapeXml(system.name)}</title>`,
    `<rect width="${VIEW.width}" height="${VIEW.height}" fill="${color}"/>`,
    frame,
    SHAPES[shapeIndex % SHAPES.length](LOGO_TEXT_COLOR),
    `<path data-text="1" d="${textPath(layout)}" fill="${LOGO_TEXT_COLOR}"/>`,
    '</svg>',
    '',
  ].join('\n');
}

/** Tous les logos : Map chemin déclaré dans systems.json (champ `logo`) vers contenu SVG. */
export function generateLogos(systems, css) {
  const colors = readAccentColors(css);
  const logos = new Map();
  systems.forEach((system, index) => {
    const color = colors[system.accent];
    if (!color) throw new Error(`Couleur d'accent ${system.accent} de ${system.id} introuvable dans css/base.css`);
    if (logos.has(system.logo)) throw new Error(`Logo en double dans systems.json : ${system.logo}`);
    logos.set(system.logo, buildLogoSvg(system, color, index));
  });
  return logos;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const { systems } = JSON.parse(readFileSync(join(PROJECT_ROOT, 'systems.json'), 'utf8'));
  const logos = generateLogos(systems, readFileSync(join(PROJECT_ROOT, 'css', 'base.css'), 'utf8'));
  for (const [path, svg] of logos) {
    const file = join(PROJECT_ROOT, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, svg);
  }
  console.log(`${logos.size} logos écrits dans ${join(PROJECT_ROOT, 'assets', 'logos')}`);
}
