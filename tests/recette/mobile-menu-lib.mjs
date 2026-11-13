// Outils des recettes sur téléphone avec le vrai EmulatorJS (T28 mobile-menu.mjs, T31 manette-tactile.mjs) : CDN servi en local,
// mesure de l'image du jeu sur une capture, recouvrement de rectangles.
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const TYPES = { js: 'text/javascript', css: 'text/css', json: 'application/json', wasm: 'application/wasm' };

/**
 * Sert https://cdn.emulatorjs.org/<version>/data/... depuis les paquets npm dépaquetés.
 * @param {object} context contexte Playwright
 * @param {string} ejsData dossier data/ de @emulatorjs/emulatorjs
 * @param {string} ejsCore dossier du cœur (@emulatorjs/core-*)
 */
export async function routeLocalCdn(context, ejsData, ejsCore) {
  await context.route(/cdn\.emulatorjs\.org\/[\d.]+\/data\//, (route) => {
    const p = new URL(route.request().url()).pathname.replace(/^\/[\d.]+\/data\//, '');
    const file = p.startsWith('cores/') ? join(ejsCore, p.slice('cores/'.length)) : join(ejsData, p);
    if (!existsSync(file)) return route.fulfill({ status: 404, body: '' });
    route.fulfill({ status: 200, contentType: TYPES[file.split('.').pop()] ?? 'application/octet-stream', body: readFileSync(file) });
  });
}

/** Rectangle (px CSS) des pixels non noirs d'une capture PNG, décodée dans la page. */
export const imageBox = (page, png, scale) => page.evaluate(async ([b64, s]) => {
  const img = new Image();
  img.src = `data:image/png;base64,${b64}`;
  await img.decode();
  const c = new OffscreenCanvas(img.width, img.height);
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, img.width, img.height).data;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    const i = (y * img.width + x) * 4;
    if (d[i] + d[i + 1] + d[i + 2] > 60) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return x1 < 0 ? null : { x: x0 / s, y: y0 / s, w: (x1 - x0 + 1) / s, h: (y1 - y0 + 1) / s };
}, [png.toString('base64'), scale]);

/** Vrai si deux rectangles {x, y, w, h} se recouvrent. */
export const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

