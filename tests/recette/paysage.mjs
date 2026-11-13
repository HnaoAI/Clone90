// Recette T33 : téléphone en paysage (signalé par Hicham : « je ne peux pas lancer de jeu car le bouton disparaît »).
// 1) Écran Jouer ouvert en portrait puis téléphone tourné en paysage (et ouvert directement en paysage) : jaquette et bouton Jouer
//    entiers dans l'écran, sans défilement, hors du bouton Menu ; un vrai toucher (CDP) sur Jouer lance le jeu.
// 2) En jeu : bouton Menu, ☰, joystick ou croix et tous les boutons virtuels dans l'écran, hors de l'image du jeu, sans se chevaucher ;
//    Start toujours actif.
// Tailles : Pixel 7 paysage (863x360), 720x360, 640x360 (16:9 étroit), 800x300 (barre d'adresse affichée).
// Même montage que manette-tactile.mjs (T31) : vrai EmulatorJS (EJS_DATA, EJS_CORE), serveur `node scripts/serve.mjs --port 8765`,
// ROM NES dans roms/nes/ (GAME), schéma par défaut forcé par EJS_controlScheme. CAPTURES=<dossier> : une capture par cas.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pw, BASE, verdict, sleep } from './lib.mjs';
import { routeLocalCdn, imageBox, overlaps } from './mobile-menu-lib.mjs';

const { EJS_DATA, EJS_CORE, CAPTURES } = process.env;
const GAME = process.env.GAME ?? 'nes/test';
if (!EJS_DATA || !EJS_CORE) {
  verdict('T33-paysage', null, 'EJS_DATA et EJS_CORE non fournis (paquets npm EmulatorJS dépaquetés)');
  process.exit(0);
}
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true });
const SIZES = [[863, 360], [720, 360], [640, 360], [800, 300]];
const inside = (b, w, h) => b.x >= 0 && b.y >= 0 && b.x + b.w <= w + 0.5 && b.y + b.h <= h + 0.5;
const rect = (sel) => (document.querySelector(sel) ? (({ x, y, width: w, height: h }) => ({ x, y, w, h }))(document.querySelector(sel).getBoundingClientRect()) : null);

/** Toucher réel (CDP) au centre d'un rectangle. */
async function touch(cdp, b) {
  const touchPoints = [{ x: b.x + b.w / 2, y: b.y + b.h / 2 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints });
  await sleep(80);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const browser = await pw.chromium.launch();
for (const scheme of ['defaut', 'nes']) for (const [w, h] of SIZES) for (const start of ['rotation', 'paysage']) {
  // L'écran en jeu ne dépend pas de la façon d'arriver : mesuré une fois par taille, après un départ en paysage.
  const where = `${scheme} ${w}x${h} ${start}`;
  const context = await browser.newContext({ ...pw.devices['Pixel 7'], ...(start === 'paysage' ? { viewport: { width: w, height: h } } : {}), serviceWorkers: 'block' });
  await routeLocalCdn(context, EJS_DATA, EJS_CORE);
  if (scheme === 'defaut') await context.addInitScript(() => { window.EJS_controlScheme = 'amiga'; });
  const page = await context.newPage();
  await page.goto(`${BASE}/player.html?system=${GAME.split('/')[0]}&game=${encodeURIComponent(GAME)}`);
  await page.locator('.play-button').waitFor();
  if (start === 'rotation') { await sleep(300); await page.setViewportSize({ width: w, height: h }); }
  await sleep(600);
  if (CAPTURES && scheme === 'defaut') await page.screenshot({ path: join(CAPTURES, `jouer-${w}x${h}-${start}.png`) });

  const jouer = await page.evaluate((f) => { const r = eval(f); return { btn: r('.play-button'), cover: r('.play-cover'), menu: r('.menu-wrap'), title: r('.play-title') }; }, `(${rect})`);
  verdict('T33-jouer-visible', inside(jouer.btn, w, h), `Jouer ${JSON.stringify(jouer.btn)}`, where);
  verdict('T33-jaquette-entiere', inside(jouer.cover, w, h) && inside(jouer.title, w, h), `jaquette ${JSON.stringify(jouer.cover)} titre ${JSON.stringify(jouer.title)}`, where);
  verdict('T33-jouer-hors-menu', [jouer.btn, jouer.cover, jouer.title].every((b) => !overlaps(b, jouer.menu)), `menu ${JSON.stringify(jouer.menu)}`, where);
  verdict('T33-cible-jouer-48px', jouer.btn.h >= 48 && jouer.btn.w >= 48, JSON.stringify(jouer.btn), where);

  const cdp = await context.newCDPSession(page);
  await touch(cdp, jouer.btn);
  const started = await page.waitForFunction(() => window.EJS_emulator?.started, null, { timeout: 30000 }).then(() => true, () => false);
  verdict('T33-toucher-jouer-lance-le-jeu', started, '', where);
  if (!started || start === 'rotation') { await context.close(); continue; }
  await sleep(6000); // retrait automatique de la barre d'EmulatorJS, ouverte par le toucher sur Jouer
  if (CAPTURES) await page.screenshot({ path: join(CAPTURES, `jeu-${scheme}-${w}x${h}.png`) });

  const ctrls = await page.evaluate((f) => {
    const r = eval(f);
    const all = [...document.querySelectorAll('.ejs_virtualGamepad_button')].filter((e) => e.offsetParent).map((e, i) => ({ name: e.textContent || `bouton${i}`, ...(({ x, y, width: w, height: h }) => ({ x, y, w, h }))(e.getBoundingClientRect()) }));
    const pad = document.querySelector('.ejs_dpad_main') ? r('.ejs_dpad_main') : r('.ejs_virtualGamepad_left');
    return [...all, { name: 'joystick/croix', ...pad }, { name: 'Menu', ...r('.menu-wrap') }, { name: '☰', ...r('.ejs_virtualGamepad_open') }];
  }, `(${rect})`);
  const hide = await page.addStyleTag({ content: 'body { background: #000 !important; } body > :not(#game), #game > :not(.ejs_canvas_parent), .ejs_menu_bar { visibility: hidden !important; }' });
  await sleep(300);
  const game = await imageBox(page, await page.screenshot(), pw.devices['Pixel 7'].deviceScaleFactor);
  await hide.evaluate((e) => e.remove());
  verdict('T33-image-du-jeu', !!game, JSON.stringify(game), where);
  for (const c of ctrls) {
    verdict('T33-commande-dans-ecran', inside(c, w, h), `${c.name} ${JSON.stringify(c)}`, where);
    if (game) verdict('T33-commande-hors-image', !overlaps(c, game), `${c.name} ${JSON.stringify(c)} / jeu ${JSON.stringify(game)}`, where);
  }
  // Boutons ronds d'EmulatorJS (A, B, X, Y : carrés de 50 px, en losange) : leurs rectangles se touchent aux coins sans que les disques
  // se recouvrent ; pour eux, on compare la distance des centres à la somme des rayons.
  const round = (b) => Math.abs(b.w - b.h) < 1 && b.w <= 60 && b.name.length === 1;
  const clash = (a, b) => (round(a) && round(b)
    ? Math.hypot(a.x + a.w / 2 - b.x - b.w / 2, a.y + a.h / 2 - b.y - b.h / 2) < (a.w + b.w) / 2
    : overlaps(a, b));
  const pairs = ctrls.flatMap((a, i) => ctrls.slice(i + 1).map((b) => [a, b])).filter(([a, b]) => clash(a, b));
  verdict('T33-commandes-separees', pairs.length === 0, pairs.map(([a, b]) => `${a.name}/${b.name}`).join(', '), where);

  // Start (lancer une partie, « Press Start ») : un vrai toucher envoie l'entrée au cœur.
  await page.evaluate(() => {
    const gm = window.EJS_emulator.gameManager;
    const orig = gm.simulateInput.bind(gm);
    window.__calls = [];
    gm.simulateInput = (...a) => { window.__calls.push(a); return orig(...a); };
  });
  const startBtn = ctrls.find((c) => c.name === 'Start');
  if (startBtn) await touch(cdp, startBtn);
  await sleep(300);
  const calls = await page.evaluate(() => window.__calls.length);
  verdict('T33-start-actif', !!startBtn && calls > 0, `${calls} appel(s)`, where);
  await context.close();
}
await browser.close();
