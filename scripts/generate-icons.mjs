// Génère les icônes PWA (T8) en PNG, sans dépendance ni téléchargement (zlib de Node) : assets/icons/icon-192.png, icon-512.png
// et les versions maskable. Motif maison : "C90" en grands pixels jaunes sur fond bleu nuit (palette de css/base.css).
// Usage : node scripts/generate-icons.mjs   (à relancer seulement pour changer le dessin ; les PNG sont commités)
import { deflateSync } from 'node:zlib';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from './project-root.mjs';
import { GLYPHS } from './pixel-font.mjs';
import { readCssColors, hexToRgb } from './css-colors.mjs';

// Couleurs lues dans css/base.css (--bg et --accent) : une seule source pour la palette (T24).
const colors = readCssColors(readFileSync(join(PROJECT_ROOT, 'css', 'base.css'), 'utf8'));
const BG = hexToRgb(colors['--bg']);
const FG = hexToRgb(colors['--accent']);
const TEXT = ['C', '9', '0'];

/** Image RGB de `size` pixels : texte centré, occupant `fill` (0 à 1) de la largeur ; le reste est le fond. */
export function drawIcon(size, fill) {
  const columns = TEXT.length * 5 + (TEXT.length - 1); // 1 colonne d'espace entre lettres
  const cell = Math.floor((size * fill) / columns);
  const width = columns * cell;
  const height = 7 * cell;
  const left = Math.floor((size - width) / 2);
  const top = Math.floor((size - height) / 2);
  const rgb = Buffer.alloc(size * size * 3);
  for (let i = 0; i < size * size; i += 1) rgb.set(BG, i * 3);
  TEXT.forEach((ch, letter) => GLYPHS[ch].forEach((row, y) => [...row].forEach((bit, x) => {
    if (bit !== '1') return;
    for (let dy = 0; dy < cell; dy += 1) {
      for (let dx = 0; dx < cell; dx += 1) {
        const px = left + (letter * 6 + x) * cell + dx;
        const py = top + y * cell + dy;
        rgb.set(FG, (py * size + px) * 3);
      }
    }
  })));
  return rgb;
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
};

/** Encode des pixels RGB en PNG (8 bits, sans entrelacement). */
export function encodePng(rgb, size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  for (let y = 0; y < size; y += 1) {
    raw[y * (size * 3 + 1)] = 0; // filtre "aucun"
    rgb.copy(raw, y * (size * 3 + 1) + 1, y * size * 3, (y + 1) * size * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// "maskable" : le dessin reste dans la zone sûre (cercle central de 80 %) ; "any" : texte plus grand.
const VARIANTS = [{ suffix: '', fill: 0.78 }, { suffix: '-maskable', fill: 0.5 }];

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = join(PROJECT_ROOT, 'assets', 'icons');
  mkdirSync(dir, { recursive: true });
  for (const size of [192, 512]) {
    for (const { suffix, fill } of VARIANTS) {
      writeFileSync(join(dir, `icon-${size}${suffix}.png`), encodePng(drawIcon(size, fill), size));
    }
  }
  console.log(`Icônes écrites dans ${dir}`);
}
