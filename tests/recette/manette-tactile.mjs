// Recette T31 : manette tactile d'EmulatorJS sur téléphone Android (Pixel 7, portrait et paysage).
// 1) Le joystick (zone nipplejs, schéma de manette par défaut : Amiga, arcade, Mega Drive...) est gris clair, plus rouge.
// 2) Les boutons du centre (Select, Start, Slow, Fast...) ne se dessinent plus sur l'image du jeu ; en paysage ils sont sous le joystick.
// Même montage que mobile-menu.mjs (T28) : vrai EmulatorJS 4.2.3 et cœur fceumm depuis les paquets npm (EJS_DATA, EJS_CORE),
// serveur `node scripts/serve.mjs --port 8765`, ROM NES dans roms/nes/ (GAME, défaut nes/test). Le schéma par défaut est obtenu
// en posant window.EJS_controlScheme avant le chargement (même DOM qu'un jeu Amiga ou arcade, sans leur cœur ni leurs ROMs).
// CAPTURES=<dossier> : écrit une capture par cas (<schéma>-<orientation>.png).
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pw, BASE, verdict, sleep } from './lib.mjs';
import { routeLocalCdn, imageBox, overlaps } from './mobile-menu-lib.mjs';

const { EJS_DATA, EJS_CORE, CAPTURES } = process.env;
const GAME = process.env.GAME ?? 'nes/test';
/** Gris clair voulu par Hicham (CSS lightgray). */
const LIGHT_GREY = 'rgb(211, 211, 211)';

if (!EJS_DATA || !EJS_CORE) {
  verdict('T31-manette-tactile', null, 'EJS_DATA et EJS_CORE non fournis (paquets npm EmulatorJS dépaquetés)');
  process.exit(0);
}
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true });

const browser = await pw.chromium.launch();
// 'defaut' : schéma sans entrée propre dans EmulatorJS (zone joystick rouge) ; 'nes' : croix directionnelle.
for (const scheme of ['defaut', 'nes']) for (const [name, device] of [['portrait', 'Pixel 7'], ['paysage', 'Pixel 7 landscape']]) {
  const where = `${scheme} ${name}`;
  const context = await browser.newContext({ ...pw.devices[device], serviceWorkers: 'block' });
  await routeLocalCdn(context, EJS_DATA, EJS_CORE);
  if (scheme === 'defaut') await context.addInitScript(() => { window.EJS_controlScheme = 'amiga'; });
  const page = await context.newPage();
  await page.goto(`${BASE}/player.html?system=${GAME.split('/')[0]}&game=${encodeURIComponent(GAME)}`);
  await page.locator('.play-button').tap();
  await page.waitForFunction(() => window.EJS_emulator?.started, null, { timeout: 30000 }).catch(() => {});
  await sleep(1500);
  // Capture après le retrait automatique de la barre d'EmulatorJS (ouverte par le tap sur Jouer), pour voir les contrôles.
  if (CAPTURES) { await sleep(4000); await page.screenshot({ path: join(CAPTURES, `${scheme}-${name}.png`) }); }

  const view = pw.devices[device].viewport;
  const boxes = await page.evaluate(() => {
    const r = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, w: b.width, h: b.height }; };
    return {
      left: r(document.querySelector('.ejs_virtualGamepad_left')),
      center: [...document.querySelectorAll('.ejs_virtualGamepad_bottom .ejs_virtualGamepad_button')].map((e) => ({ text: e.textContent, ...r(e) })),
      nipple: [...document.querySelectorAll('.ejs_virtualGamepad_parent .nipple .front, .ejs_virtualGamepad_parent .nipple .back')]
        .map((e) => getComputedStyle(e).backgroundColor),
    };
  });

  if (scheme === 'defaut') {
    verdict('T31-joystick-gris-clair', boxes.nipple.length === 2 && boxes.nipple.every((c) => c === LIGHT_GREY), JSON.stringify(boxes.nipple), where);
  }

  // Image du jeu seule, sur fond noir (même mesure que T28).
  const hide = await page.addStyleTag({ content: 'body { background: #000 !important; } body > :not(#game), #game > :not(.ejs_canvas_parent), .ejs_menu_bar { visibility: hidden !important; }' });
  await sleep(300);
  const game = await imageBox(page, await page.screenshot(), pw.devices[device].deviceScaleFactor);
  await hide.evaluate((e) => e.remove());
  if (!game) { verdict('T31-boutons-hors-jeu', null, 'image du jeu introuvable (jeu non démarré ?)', where); await context.close(); continue; }

  const labels = boxes.center.map((b) => b.text).join(', ');
  verdict('T31-boutons-presents', ['Select', 'Start', 'Fast', 'Slow'].every((t) => labels.includes(t)), labels, where);
  for (const b of boxes.center) {
    const inside = b.x >= 0 && b.y >= 0 && b.x + b.w <= view.width && b.y + b.h <= view.height;
    verdict('T31-boutons-hors-jeu', !overlaps(b, game) && inside, `${b.text} ${JSON.stringify(b)} / jeu ${JSON.stringify(game)}`, where);
    if (name === 'paysage') {
      const under = b.y >= boxes.left.y + boxes.left.h && b.x >= boxes.left.x - 1 && b.x + b.w <= boxes.left.x + boxes.left.w + 1;
      verdict('T31-boutons-sous-joystick', under, `${b.text} ${JSON.stringify(b)} / joystick ${JSON.stringify(boxes.left)}`, where);
    }
  }
  const pairs = boxes.center.flatMap((a, i) => boxes.center.slice(i + 1).map((b) => [a, b]));
  verdict('T31-boutons-separes', pairs.every(([a, b]) => !overlaps(a, b)), labels, where);

  // Les boutons déplacés marchent toujours : un appui envoie l'entrée au cœur.
  const sent = await page.evaluate(() => {
    const gm = window.EJS_emulator.gameManager;
    const calls = [];
    const orig = gm.simulateInput.bind(gm);
    gm.simulateInput = (...a) => { calls.push(a); return orig(...a); };
    window.__calls = calls;
    return true;
  });
  await page.locator('.ejs_virtualGamepad_bottom .b_start').tap();
  await sleep(200);
  const calls = sent ? await page.evaluate(() => window.__calls) : [];
  verdict('T31-boutons-actifs', calls.some((c) => c[1] === 3 && c[2] === 1), `appels simulateInput ${JSON.stringify(calls)}`, where);
  await context.close();
}
await browser.close();
