// Recette T46 « jouer hors ligne » : vrai navigateur (Pixel 7), vrai service worker, vrai EmulatorJS 4.2.3 et vrai cœur NES (paquets npm
// dépaquetés : EJS_DATA = dossier data/ de @emulatorjs/emulatorjs, EJS_CORE = dossier de @emulatorjs/core-fceumm), servis comme le CDN
// (avec CORS). Montage autonome : copie de l'application SANS roms/, bios/ ni games.json (comme GitHub Pages), ROM NES homebrew écrite ici
// et importée dans « Mes fichiers ». « Hors ligne » = serveur de l'application arrêté, CDN coupé et navigateur hors ligne.
// Le paquet npm n'a pas emulator.min.js / emulator.min.css (le CDN les a) : ils sont fabriqués ici en mettant bout à bout les scripts de src/,
// dans l'ordre de loader.js (le .min du CDN est ce même ensemble, minifié).
// Usage : PLAYWRIGHT_PATH=... EJS_DATA=... EJS_CORE=... node tests/recette/hors-ligne.mjs [dossier de captures]
import { cp, mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pw, verdict, results, sleep } from './lib.mjs';
import { PROJECT_ROOT } from '../../scripts/project-root.mjs';
import { createStaticServer } from '../../scripts/serve.mjs';

const { EJS_DATA, EJS_CORE } = process.env;
const captures = process.argv[2];
if (!EJS_DATA || !EJS_CORE) {
  verdict('T46-hors-ligne', null, 'EJS_DATA et EJS_CORE non fournis (paquets npm EmulatorJS dépaquetés)');
  process.exit(0);
}
if (captures) await mkdir(captures, { recursive: true });

// Application sans jeux.
const root = await mkdtemp(join(tmpdir(), 'clone90-recette-hors-ligne-'));
for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets']) {
  await cp(join(PROJECT_ROOT, f), join(root, f), { recursive: true });
}
// .min fabriqués (voir en-tête).
const minDir = await mkdtemp(join(tmpdir(), 'clone90-ejs-min-'));
const order = ['emulator.js', 'nipplejs.js', 'shaders.js', 'storage.js', 'gamepad.js', 'GameManager.js', 'socket.io.min.js', 'compression.js'];
await writeFile(join(minDir, 'emulator.min.js'), (await Promise.all(order.map((f) => readFile(join(EJS_DATA, 'src', f), 'utf8')))).join('\n;\n'));
await cp(join(EJS_DATA, 'emulator.css'), join(minDir, 'emulator.min.css'));

/** ROM NES homebrew minimale (iNES, mapper 0) : boucle infinie, vecteurs sur $8000. Aucun jeu du commerce. */
function homebrewNes() {
  const prg = Buffer.alloc(16384, 0xea);
  prg[0] = 0x4c; prg[1] = 0x00; prg[2] = 0x80; // JMP $8000
  for (const at of [0x3ffa, 0x3ffc, 0x3ffe]) { prg[at] = 0x00; prg[at + 1] = 0x80; }
  return Buffer.concat([Buffer.from([0x4e, 0x45, 0x53, 0x1a, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), prg, Buffer.alloc(8192)]);
}
const romDir = await mkdtemp(join(tmpdir(), 'clone90-rom-'));
const romFile = join(romDir, 'Essai Hors Ligne.nes');
await writeFile(romFile, homebrewNes());

const TYPES = { js: 'text/javascript', css: 'text/css', json: 'application/json', wasm: 'application/wasm' };
/** Faux CDN : https://cdn.emulatorjs.org/<version>/data/... ; `state.online` faux = coupure réseau. Compte les demandes. */
async function routeCdn(context, state) {
  await context.route(/cdn\.emulatorjs\.org/, (route) => {
    state.requests.push(route.request().url());
    if (!state.online) return route.abort('internetdisconnected');
    const p = new URL(route.request().url()).pathname.replace(/^\/[\d.]+\/data\//, '');
    const file = p.startsWith('cores/') ? join(EJS_CORE, p.slice('cores/'.length)) : existsSync(join(minDir, p)) ? join(minDir, p) : join(EJS_DATA, p);
    const headers = { 'Access-Control-Allow-Origin': '*' };
    if (!existsSync(file)) return route.fulfill({ status: 404, headers, body: '' });
    return route.fulfill({ status: 200, headers, contentType: TYPES[file.split('.').pop()] ?? 'application/octet-stream', body: readFileSync(file) });
  });
  await context.route(/github(usercontent)?\.com/, (route) => route.abort()); // pochettes et logos : hors sujet ici
}

const browser = await pw.chromium.launch();
const shot = async (page, name) => { if (captures) await page.screenshot({ path: join(captures, `${name}.png`) }); };

/** Une « personne » : contexte Pixel 7 neuf, serveur de l'application à elle (arrêté pour passer hors ligne). */
async function newPhone() {
  const server = createStaticServer({ root });
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  const base = `http://localhost:${port}`;
  const context = await browser.newContext({ ...pw.devices['Pixel 7'] });
  const state = { online: true, requests: [] };
  await routeCdn(context, state);
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/index.html`);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload(); // page contrôlée par le service worker
  // Import de la ROM dans « Mes fichiers ».
  await page.goto(`${base}/index.html#/fichiers`);
  const add = page.locator('button[data-nav-id="add-nes"]');
  await add.waitFor({ timeout: 10000 });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), add.click()]);
  await chooser.setFiles(romFile);
  await page.locator('.library-notice').waitFor({ timeout: 15000 });
  const goOffline = async () => {
    state.online = false;
    await context.setOffline(true);
    server.closeAllConnections?.();
    await new Promise((r) => server.close(r));
  };
  return { base, context, page, state, errors, goOffline };
}

/** Ouvre le jeu NES depuis l'accueil (comme la personne), touche « Jouer » ; vrai si EmulatorJS a démarré le jeu. */
async function playFromHome(page, base) {
  await page.goto(`${base}/index.html#/nes`);
  await page.locator('.game-tile').first().waitFor({ timeout: 10000 });
  await page.locator('.game-tile').first().tap();
  await page.locator('.play-button').waitFor({ timeout: 10000 });
  await page.locator('.play-button').tap();
  const started = await page.waitForFunction(() => window.EJS_emulator?.started === true, null, { timeout: 40000 }).then(() => true).catch(() => false);
  return started;
}

const engineCacheKeys = (page) => page.evaluate(async () => {
  const out = {};
  for (const name of (await caches.keys()).filter((n) => n.startsWith('clone90-ejs-'))) out[name] = (await (await caches.open(name)).keys()).map((r) => r.url);
  return out;
});

try {
  // 1. Bouton « Préparer le jeu hors ligne », puis mode avion.
  {
    const { base, page, state, errors, goOffline } = await newPhone();
    const button = page.getByRole('button', { name: 'Préparer le jeu hors ligne' });
    await button.click();
    const notice = page.locator('.library-notice');
    await page.waitForFunction(() => /hors ligne|Préparation/.test(document.querySelector('.library-notice')?.textContent ?? ''), null, { timeout: 30000 });
    const text = await notice.textContent();
    verdict('T46-bouton-message', /^Jeu hors ligne prêt pour NES \(.+ téléchargés\)\.$/.test(text), text);
    verdict('T46-bouton-focus', await page.evaluate(() => document.activeElement?.dataset?.navId === 'prepare-offline'));
    await shot(page, 'telephone-1-prepare');
    const keys = await engineCacheKeys(page);
    const urls = keys['clone90-ejs-4.2.3'] ?? [];
    verdict('T46-cache-contenu', ['loader.js', 'emulator.min.js', 'cores/fceumm-legacy-wasm.data', 'cores/reports/fceumm.json'].every((f) => urls.includes(`https://cdn.emulatorjs.org/4.2.3/data/${f}`)), urls.map((u) => u.split('/data/')[1]).join(', '));
    verdict('T46-cache-que-le-cdn', Object.keys(keys).length === 1 && urls.every((u) => u.startsWith('https://cdn.emulatorjs.org/4.2.3/data/')), Object.keys(keys).join(', '));
    // Deuxième appui : rien de téléchargé.
    const before = state.requests.length;
    await button.click();
    await page.waitForFunction(() => /déjà sur cet appareil/.test(document.querySelector('.library-notice')?.textContent ?? ''), null, { timeout: 15000 }).catch(() => {});
    verdict('T46-seulement-ce-qui-manque', state.requests.slice(before).filter((u) => !u.includes('/localization/')).length === 0, (await notice.textContent()) ?? '');

    await goOffline();
    const started = await playFromHome(page, base);
    verdict('T46-hors-ligne-apres-bouton', started, errors.join(' | '));
    await sleep(1500);
    await shot(page, 'telephone-2-jeu-hors-ligne');
    await page.context().close();
  }

  // 2. Sans le bouton : une partie avec réseau, puis mode avion.
  {
    const { base, page, errors, goOffline } = await newPhone();
    verdict('T46-premiere-partie-en-ligne', await playFromHome(page, base), errors.join(' | '));
    await goOffline();
    verdict('T46-hors-ligne-apres-partie', await playFromHome(page, base), errors.join(' | '));
    await page.context().close();
  }

  // 3. Jamais préparé, jamais joué : message qui cite le bouton.
  {
    const { base, page, goOffline } = await newPhone();
    await goOffline();
    await playFromHome(page, base);
    const message = await page.locator('body').textContent();
    verdict('T46-message-sans-preparation', /Préparer le jeu hors ligne/.test(message), message.replace(/\s+/g, ' ').slice(0, 300));
    await shot(page, 'telephone-3-sans-preparation');
    await page.context().close();
  }
} finally {
  await browser.close();
}
const failed = results.filter((r) => r.verdict !== 'PASSE');
console.log(`${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length ? 1 : 0);
