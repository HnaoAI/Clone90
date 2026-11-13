// Recette T28 : sur téléphone Android (Pixel 7, portrait et paysage), le bouton Menu et le ☰ d'EmulatorJS ne recouvrent pas l'image du jeu.
// Vrai EmulatorJS (pas le faux de lib.mjs) : le CDN est servi depuis les paquets npm @emulatorjs/emulatorjs et @emulatorjs/core-fceumm 4.2.3,
// dépaquetés dans EJS_DATA (dossier data/) et EJS_CORE (dossier du cœur). Serveur `node scripts/serve.mjs --port 8765` lancé avant,
// avec une ROM NES homebrew dans roms/nes/ puis `node scripts/generate-games.mjs`. GAME = id du jeu (défaut nes/test).
// Mesure : capture sans nos boutons ni le ☰, rectangle des pixels non noirs = image du jeu, puis intersection avec chaque bouton.
import { pw, BASE, verdict, sleep } from './lib.mjs';
import { routeLocalCdn, imageBox, overlaps } from './mobile-menu-lib.mjs';

const { EJS_DATA, EJS_CORE } = process.env;
const GAME = process.env.GAME ?? 'nes/test';
if (!EJS_DATA || !EJS_CORE) {
  verdict('T28-menu-mobile', null, 'EJS_DATA et EJS_CORE non fournis (paquets npm EmulatorJS dépaquetés)');
  process.exit(0);
}

const browser = await pw.chromium.launch();
for (const [name, device] of [['portrait', 'Pixel 7'], ['paysage', 'Pixel 7 landscape']]) {
  const context = await browser.newContext({ ...pw.devices[device], serviceWorkers: 'block' });
  await routeLocalCdn(context, EJS_DATA, EJS_CORE);
  const page = await context.newPage();
  await page.goto(`${BASE}/player.html?system=${GAME.split('/')[0]}&game=${encodeURIComponent(GAME)}`);
  await page.locator('.play-button').tap();
  await page.waitForFunction(() => window.EJS_emulator?.started, null, { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  const rect = (sel) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const buttons = { 'bouton Menu': await rect('.menu-wrap'), '☰ EmulatorJS': await rect('.ejs_virtualGamepad_open') };
  const before = await page.evaluate(() => [...document.querySelectorAll('.ejs_menu_bar')].map((e) => e.className));
  // Seul le canevas du jeu reste visible, sur fond noir.
  const hide = await page.addStyleTag({ content: 'body { background: #000 !important; } body > :not(#game), #game > :not(.ejs_canvas_parent), .ejs_menu_bar { visibility: hidden !important; }' });
  await sleep(300);
  const scale = pw.devices[device].deviceScaleFactor;
  const game = await imageBox(page, await page.screenshot(), scale);
  if (!game) verdict('T28-menu-mobile', null, 'image du jeu introuvable (jeu non démarré ?)', name);
  for (const [label, box] of Object.entries(buttons)) {
    verdict('T28-menu-mobile', !overlaps(box, game), `${label} ${JSON.stringify(box)} / jeu ${JSON.stringify(game)}`, name);
    verdict('T28-cible-48px', box.w >= 48 && box.h >= 48, `${label} ${Math.round(box.w)} x ${Math.round(box.h)}`, name);
  }
  // Le ☰ déplacé marche toujours : un tap ouvre la barre d'EmulatorJS.
  await hide.evaluate((e) => e.remove());
  await page.locator('.ejs_virtualGamepad_open').tap();
  await sleep(500);
  const after = await page.evaluate(() => [...document.querySelectorAll('.ejs_menu_bar')].map((e) => e.className));
  verdict('T28-hamburger-actif', JSON.stringify(before) !== JSON.stringify(after), 'tap sur ☰', name);
  await context.close();
}
await browser.close();
