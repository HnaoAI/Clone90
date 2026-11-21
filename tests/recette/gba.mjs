// Recette T50 : Game Boy Advance avec le VRAI EmulatorJS 4.2.3 et le vrai cœur mgba (paquets npm dépaquetés : EJS_DATA = dossier data/
// de @emulatorjs/emulatorjs, EJS_CORE = dossier de @emulatorjs/core-mgba), servis comme le CDN. Montage autonome comme hors-ligne.mjs :
// application copiée dans un dossier temporaire, une ROM GBA homebrew écrite ici (aucun jeu du commerce), games.json généré.
// 1) Ordinateur : la tuile Game Boy Advance est sur l'accueil, juste après la Game Boy Color, avec son jeu.
// 2) Pixel 7 debout et couché : le jeu démarre (l'écran devient magenta, couleur peinte par la ROM), la manette tactile a L, R, A, B,
//    Start et Select, dans l'écran, hors de l'image du jeu, sans chevauchement ; un appui sur R et sur L arrive au cœur.
// Usage : PLAYWRIGHT_PATH=... EJS_DATA=... EJS_CORE=... node tests/recette/gba.mjs [dossier de captures]
import { mkdtemp, mkdir, cp, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pw, verdict, sleep } from './lib.mjs';
import { imageBox, overlaps } from './mobile-menu-lib.mjs';
import { PROJECT_ROOT, createStaticServer } from '../../scripts/serve.mjs';
import { generateGames } from '../../scripts/generate-games.mjs';

const { EJS_DATA, EJS_CORE } = process.env;
const captures = process.argv[2];
if (!EJS_DATA || !EJS_CORE) {
  verdict('T50-gba', null, 'EJS_DATA et EJS_CORE non fournis (paquets npm EmulatorJS et core-mgba dépaquetés)');
  process.exit(0);
}
if (captures) await mkdir(captures, { recursive: true });

const root = await mkdtemp(join(tmpdir(), 'clone90-recette-gba-'));
for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets']) {
  await cp(join(PROJECT_ROOT, f), join(root, f), { recursive: true });
}

/**
 * ROM GBA homebrew minimale (ARM) : passe l'écran en mode 3, le remplit de magenta (BGR555 0x7C1F), puis boucle.
 * En-tête réduit à ce que mGBA vérifie (saut 0xEA.. en tête, 0x96 à 0xB2). Aucun jeu ni logo du commerce.
 */
function homebrewGba() {
  const rom = Buffer.alloc(1024, 0);
  const words = (at, list) => list.forEach((w, i) => rom.writeUInt32LE(w >>> 0, at + i * 4));
  words(0, [0xEA00002E]); // b 0xC0
  rom.write('CLONE90TEST', 0xA0, 'ascii');
  rom[0xB2] = 0x96;
  words(0xC0, [
    0xE3A00301, // mov r0, #0x04000000 (DISPCNT)
    0xE3A01B01, // mov r1, #0x400
    0xE3811003, // orr r1, r1, #3      (mode 3 + BG2)
    0xE1C010B0, // strh r1, [r0]
    0xE3A02406, // mov r2, #0x06000000 (VRAM)
    0xE3A0301F, // mov r3, #0x1F       (rouge)
    0xE3833B1F, // orr r3, r3, #0x7C00 (+ bleu = magenta)
    0xE3A04C96, // mov r4, #0x9600     (240 x 160 pixels)
    0xE0C230B2, // boucle : strh r3, [r2], #2
    0xE2544001, // subs r4, r4, #1
    0x1AFFFFFC, // bne boucle
    0xEAFFFFFE, // b .
  ]);
  return rom;
}
await mkdir(join(root, 'roms', 'gba'), { recursive: true });
await mkdir(join(root, 'roms', 'gameboycolor'), { recursive: true });
await writeFile(join(root, 'roms', 'gba', 'Essai GBA.gba'), homebrewGba());
await writeFile(join(root, 'roms', 'gameboycolor', 'Essai GBC.gbc'), Buffer.alloc(32768)); // seulement pour la tuile voisine
const generated = await generateGames({ root });
await writeFile(join(root, 'games.json'), JSON.stringify(generated, null, 2));
verdict('T50-games-json', generated.games.some((g) => g.system === 'gba' && g.file === 'roms/gba/Essai GBA.gba'), JSON.stringify(generated.games.map((g) => g.file)));

// emulator.min.js / .min.css absents du paquet npm (le CDN les a) : fabriqués comme dans hors-ligne.mjs.
const minDir = await mkdtemp(join(tmpdir(), 'clone90-ejs-min-'));
const order = ['emulator.js', 'nipplejs.js', 'shaders.js', 'storage.js', 'gamepad.js', 'GameManager.js', 'socket.io.min.js', 'compression.js'];
await writeFile(join(minDir, 'emulator.min.js'), (await Promise.all(order.map((f) => readFile(join(EJS_DATA, 'src', f), 'utf8')))).join('\n;\n'));
await cp(join(EJS_DATA, 'emulator.css'), join(minDir, 'emulator.min.css'));

const TYPES = { js: 'text/javascript', css: 'text/css', json: 'application/json', wasm: 'application/wasm' };
async function routeCdn(context, requests) {
  await context.route(/cdn\.emulatorjs\.org/, (route) => {
    requests.push(route.request().url());
    const p = new URL(route.request().url()).pathname.replace(/^\/[\d.]+\/data\//, '');
    const file = p.startsWith('cores/') ? join(EJS_CORE, p.slice('cores/'.length)) : existsSync(join(minDir, p)) ? join(minDir, p) : join(EJS_DATA, p);
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (!existsSync(file)) return route.fulfill({ status: 404, headers, body: '' });
    return route.fulfill({ status: 200, headers, contentType: TYPES[file.split('.').pop()] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  await context.route(/github(usercontent)?\.com/, (route) => route.abort());
}

const server = createStaticServer({ root });
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const base = `http://localhost:${port}`;
const browser = await pw.chromium.launch();
const shot = async (page, name) => { if (captures) await page.screenshot({ path: join(captures, `${name}.png`) }); };

// --- 1) Accueil sur ordinateur ---
{
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, serviceWorkers: 'block' });
  await routeCdn(context, []);
  const page = await context.newPage();
  await page.goto(`${base}/index.html`);
  await page.waitForSelector('.machine-tile[data-nav-id="gba"]', { timeout: 10000 }).catch(() => {});
  const tiles = await page.evaluate(() => [...document.querySelectorAll('.machine-tile')].map((e) => ({ id: e.dataset.navId, text: e.textContent.replace(/\s+/g, ' ').trim() })));
  const ids = tiles.map((t) => t.id);
  verdict('T50-tuile-accueil', ids.includes('gba') && ids[ids.indexOf('gameboycolor') + 1] === 'gba', ids.join(', '), 'ordinateur');
  verdict('T50-tuile-un-jeu', /Game Boy Advance/.test(tiles.find((t) => t.id === 'gba')?.text ?? '') && /1/.test(tiles.find((t) => t.id === 'gba')?.text ?? ''), JSON.stringify(tiles.find((t) => t.id === 'gba')), 'ordinateur');
  await page.locator('.machine-tile[data-nav-id="gba"]').scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, 'ordinateur-1-accueil');
  await context.close();
}

// --- 2) Jeu sur téléphone, debout et couché ---
const WANTED = ['L', 'R', 'A', 'B', 'Start', 'Select'];
// Paysage : Pixel 7 (863x360) et les tailles de T33 les plus serrées (640x360 étroit, 800x300 bas).
const landscape = (width, height) => ({ ...pw.devices['Pixel 7 landscape'], viewport: { width, height }, screen: { width, height } });
const DEVICES = [['portrait', 'Pixel 7', pw.devices['Pixel 7']], ['paysage', 'Pixel 7 landscape', pw.devices['Pixel 7 landscape']],
  ['paysage-640x360', '640x360', landscape(640, 360)], ['paysage-800x300', '800x300', landscape(800, 300)]];
for (const [name, label, options] of DEVICES) {
  const where = label;
  const context = await browser.newContext({ ...options, serviceWorkers: 'block' });
  const requests = [];
  await routeCdn(context, requests);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/player.html?system=gba&game=${encodeURIComponent('gba/essai_gba')}`);
  await page.locator('.play-button').tap();
  const started = await page.waitForFunction(() => window.EJS_emulator?.started, null, { timeout: 30000 }).then(() => true).catch(() => false);
  verdict('T50-jeu-demarre', started, errors.join(' | '), where);
  verdict('T50-coeur-mgba', requests.some((u) => /cores\/mgba(-legacy)?-wasm\.data$/.test(u)), requests.filter((u) => u.includes('cores/')).join(', '), where);
  await sleep(5500); // laisse la barre d'EmulatorJS se retirer
  await shot(page, `telephone-${DEVICES.findIndex((d) => d[0] === name) + 1}-jeu-${name}`);

  const view = options.viewport;
  // La ROM peint tout l'écran en magenta : la couleur au centre de l'image prouve que mgba exécute le jeu.
  const hide = await page.addStyleTag({ content: 'body { background: #000 !important; } body > :not(#game), #game > :not(.ejs_canvas_parent), .ejs_menu_bar { visibility: hidden !important; }' });
  await sleep(300);
  const png = await page.screenshot();
  const game = await imageBox(page, png, options.deviceScaleFactor);
  const center = game ? await page.evaluate(async ([b64, x, y]) => {
    const img = new Image(); img.src = `data:image/png;base64,${b64}`; await img.decode();
    const c = new OffscreenCanvas(img.width, img.height); const g = c.getContext('2d'); g.drawImage(img, 0, 0);
    return [...g.getImageData(x, y, 1, 1).data.slice(0, 3)];
  }, [png.toString('base64'), Math.round((game.x + game.w / 2) * options.deviceScaleFactor), Math.round((game.y + game.h / 2) * options.deviceScaleFactor)]) : null;
  await hide.evaluate((e) => e.remove());
  await sleep(500); // le retrait de la feuille de masquage n'est pas immédiat pour elementFromPoint
  const magenta = center && center[0] > 200 && center[1] < 60 && center[2] > 200;
  verdict('T50-image-du-jeu', Boolean(magenta), `centre ${JSON.stringify(center)} / image ${JSON.stringify(game)}`, where);
  if (!game) { await context.close(); continue; }

  const buttons = await page.evaluate(() => [...document.querySelectorAll('.ejs_virtualGamepad_parent .ejs_virtualGamepad_button')]
    .filter((e) => getComputedStyle(e).display !== 'none' && e.getClientRects().length > 0)
    .map((e) => { const b = e.getBoundingClientRect(); return { text: e.textContent.trim(), x: b.x, y: b.y, w: b.width, h: b.height }; }));
  const wanted = WANTED.map((t) => buttons.find((b) => b.text === t)).filter(Boolean);
  verdict('T50-boutons-presents', wanted.length === WANTED.length, buttons.map((b) => b.text).join(', '), where);
  for (const b of wanted) {
    const inside = b.x >= 0 && b.y >= 0 && b.x + b.w <= view.width && b.y + b.h <= view.height;
    verdict('T50-bouton-dans-ecran-hors-jeu', inside && !overlaps(b, game), `${b.text} ${JSON.stringify(b)} / jeu ${JSON.stringify(game)}`, where);
  }
  // Rien de Clone90 (bouton Menu, ☰) ne recouvre un bouton : le point touché au centre appartient bien au bouton.
  const hidden = await page.evaluate((list) => list.filter((b) => {
    const hit = document.elementFromPoint(b.x + b.w / 2, b.y + b.h / 2);
    return !hit?.classList.contains('ejs_virtualGamepad_button') || hit.textContent.trim() !== b.text;
  }).map((b) => `${b.text} sous ${document.elementsFromPoint(b.x + b.w / 2, b.y + b.h / 2).slice(0, 4).map((e) => e.className || e.tagName).join(' > ')}`), wanted);
  verdict('T50-boutons-pas-caches', hidden.length === 0, hidden.join(', '), where);
  const pairs = wanted.flatMap((a, i) => wanted.slice(i + 1).map((b) => [a, b]));
  const clash = pairs.filter(([a, b]) => overlaps(a, b)).map(([a, b]) => `${a.text}/${b.text}`);
  verdict('T50-boutons-separes', clash.length === 0, clash.join(', '), where);

  // Un appui sur L puis R envoie l'entrée au cœur (input_value 10 et 11 du schéma « gba » d'EmulatorJS).
  await page.evaluate(() => {
    const gm = window.EJS_emulator.gameManager;
    const orig = gm.simulateInput.bind(gm);
    window.__calls = [];
    gm.simulateInput = (...a) => { window.__calls.push(a); return orig(...a); };
  });
  await page.locator('.ejs_virtualGamepad_parent .b_l').tap();
  await page.locator('.ejs_virtualGamepad_parent .b_r').tap();
  await sleep(200);
  const calls = await page.evaluate(() => window.__calls);
  verdict('T50-L-R-actifs', calls.some((c) => c[1] === 10 && c[2] === 1) && calls.some((c) => c[1] === 11 && c[2] === 1), JSON.stringify(calls), where);
  await context.close();
}

await browser.close();
server.close();
