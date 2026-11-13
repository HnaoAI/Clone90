// Recette T37 « réglette de taille de l'image » : vrai EmulatorJS (paquets npm dépaquetés, EJS_DATA et EJS_CORE) et ROM NES homebrew,
// serveur `node scripts/serve.mjs --port 8765` (même montage que manette-tactile.mjs). Ordinateur (souris) : réglette sur le bord droit,
// image réduite et centrée, taille gardée par machine après rechargement, double-clic = 100 %, focus rendu au jeu, cachée au repos.
// Téléphone (Pixel 7) : pas de réglette, image inchangée. CAPTURES=<dossier> : captures.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { pw, BASE, verdict, sleep, results } from './lib.mjs';
import { routeLocalCdn, imageBox } from './mobile-menu-lib.mjs';

const { EJS_DATA, EJS_CORE, CAPTURES } = process.env;
const GAME = process.env.GAME ?? 'nes/test';
if (!EJS_DATA || !EJS_CORE) {
  verdict('T37-taille', null, 'EJS_DATA et EJS_CORE non fournis (paquets npm EmulatorJS dépaquetés)');
  process.exit(0);
}
if (CAPTURES) mkdirSync(CAPTURES, { recursive: true });
const URL_GAME = `${BASE}/player.html?system=${GAME.split('/')[0]}&game=${encodeURIComponent(GAME)}`;
const shot = async (page, name) => { if (CAPTURES) await page.screenshot({ path: join(CAPTURES, `${name}.png`) }); };
/** Rectangle de l'image du jeu : réglette, bouton Menu et rappel masqués le temps de la capture. */
async function measure(page) {
  await page.evaluate(() => { document.getElementById('chrome').style.visibility = 'hidden'; });
  const box = await imageBox(page, await page.screenshot(), 1);
  await page.evaluate(() => { document.getElementById('chrome').style.visibility = ''; });
  return box;
}

async function startGame(page) {
  await page.goto(URL_GAME);
  await page.locator('.play-button').click();
  await page.locator('#game canvas').first().waitFor({ timeout: 20000 });
  await sleep(2500);
}

const browser = await pw.chromium.launch();
try {
  const W = 1280;
  const H = 800;
  const context = await browser.newContext({ viewport: { width: W, height: H }, serviceWorkers: 'block' });
  await routeLocalCdn(context, EJS_DATA, EJS_CORE);
  const page = await context.newPage();
  await startGame(page);
  const slider = page.locator('.scale-input');
  verdict('T37-reglette-presente', await slider.isVisible(), await page.locator('.scale-value').textContent());
  const sb = await page.locator('.scale-wrap').boundingBox();
  verdict('T37-bord-droit', sb && sb.x + sb.width > W - 40 && Math.abs(sb.y + sb.height / 2 - H / 2) < 20, JSON.stringify(sb));
  await page.mouse.move(W - 30, H / 2);
  await sleep(3500); // barre d'outils du lecteur repliée : seule l'image est mesurée
  const full = await measure(page);
  await shot(page, 'taille-1-100');

  await slider.fill('60');
  await sleep(800);
  const small = await measure(page);
  const ratio = small && full ? small.w / full.w : 0;
  verdict('T37-image-reduite', ratio > 0.55 && ratio < 0.65, `100 % : ${JSON.stringify(full)} ; 60 % : ${JSON.stringify(small)}`);
  const cx = small.x + small.w / 2;
  const cy = small.y + small.h / 2;
  verdict('T37-image-centree-comme-a-100', Math.abs(cx - (full.x + full.w / 2)) < 4 && Math.abs(cy - (full.y + full.h / 2)) < 4, `centre ${cx}, ${cy}`);
  verdict('T37-texte-taille', (await page.locator('.scale-value').textContent()) === '60 %');
  await shot(page, 'taille-2-60');

  // Réglage à la souris : le focus revient au jeu, les flèches ne bougent plus la réglette.
  const box = await slider.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.1);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.5, { steps: 5 });
  await page.mouse.up();
  const afterDrag = await slider.inputValue();
  const focused = await page.evaluate(() => document.activeElement?.classList.contains('scale-input'));
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('ArrowUp');
  verdict('T37-focus-rendu-au-jeu', !focused && (await slider.inputValue()) === afterDrag, `après glisser : ${afterDrag} %, focus réglette : ${focused}`);

  await slider.fill('45');
  await sleep(300);
  await page.reload();
  await startGame(page);
  verdict('T37-memorisee', (await slider.inputValue()) === '45', `après rechargement : ${await slider.inputValue()} %`);
  const stored = await page.evaluate(() => localStorage.getItem('clone90-game-scale'));
  verdict('T37-par-machine', stored === JSON.stringify({ [GAME.split('/')[0]]: 45 }), stored);

  await page.mouse.move(10, 400);
  await sleep(3600);
  const idle = await page.locator('.scale-wrap').evaluate((n) => getComputedStyle(n).opacity);
  verdict('T37-cachee-au-repos', idle === '0', `opacité ${idle}`);
  await page.mouse.move(W - 30, H / 2);
  await sleep(300);
  verdict('T37-revient-souris', (await page.locator('.scale-wrap').evaluate((n) => getComputedStyle(n).opacity)) === '1');
  await page.locator('.scale-wrap').dblclick();
  await sleep(600);
  const back = await measure(page);
  verdict('T37-double-clic-100', (await slider.inputValue()) === '100' && Math.abs(back.w - full.w) < 4, `${await slider.inputValue()} % ; ${JSON.stringify(back)}`);
  await context.close();

  // Téléphone : aucune réglette, rien ne change.
  const phone = await browser.newContext({ ...pw.devices['Pixel 7'], serviceWorkers: 'block' });
  await routeLocalCdn(phone, EJS_DATA, EJS_CORE);
  const p = await phone.newPage();
  await p.addInitScript(() => localStorage.setItem('clone90-game-scale', '{"nes":40}'));
  await startGame(p);
  verdict('T37-telephone-sans-reglette', (await p.locator('.scale-wrap').count()) === 0);
  const g = await p.locator('#game').boundingBox();
  const vp = p.viewportSize();
  verdict('T37-telephone-image-inchangee', g && Math.abs(g.width - vp.width) < 1, JSON.stringify(g));
  await shot(p, 'taille-3-telephone');
} finally {
  await browser.close();
}
const failed = results.filter((r) => r.verdict !== 'PASSE');
console.log(`${results.length - failed.length}/${results.length} vérifications passées`);
process.exitCode = failed.length ? 1 : 0;
