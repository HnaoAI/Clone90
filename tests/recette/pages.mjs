// Recette T9 : simulation GitHub Pages (sous-chemin, sans roms/ ni games.json) + service worker + manifest.
// Usage : node tests/recette/pages.mjs <racine du projet à servir>   (serveur 8765 aussi lancé pour la partie cache SW avec de faux jeux)
import { spawn } from 'node:child_process';
import { open, verdict, sleep, BASE } from './lib.mjs';

const root = process.argv[2];
const PORT = 8766, PREFIX = '/Clone90/', ORIGIN = `http://localhost:${PORT}`;
const srv = spawn('node', [new URL('./subpath-server.mjs', import.meta.url).pathname, root, String(PORT), PREFIX], { stdio: 'inherit' });
await sleep(800);

const ok = (id, c, d = '') => verdict(id, c, d, 'pages');
(async () => {
  const env = await open({ width: 1280, height: 720, contextOptions: { serviceWorkers: 'allow' } });
  const { page, context } = env;
  const reqs = []; const failed = []; const consoleErrors = [];
  page.on('request', (r) => reqs.push(r.url()));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  await page.goto(`${ORIGIN}${PREFIX}`);
  await page.waitForSelector('.machine-tile');
  await sleep(1200);
  const home = await page.evaluate(() => ({ banner: document.querySelector('.banner')?.innerText, tiles: [...document.querySelectorAll('.machine-tile')].map((t) => t.getAttribute('href') + ' ' + t.innerText.replace(/\n/g, ' | ')), imgs: [...document.querySelectorAll('img')].map((i) => i.complete && i.naturalWidth > 0) }));
  ok('Pages : accueil chargé sous /Clone90/ (chemins relatifs)', home.tiles.length === 2 && home.imgs.every(Boolean), JSON.stringify(home.tiles));
  ok('Pages : message "aucun jeu" clair', /Aucun jeu disponible ici/.test(home.banner ?? '') && /GitHub Pages/.test(home.banner), home.banner);
  const outside = reqs.filter((u) => !u.startsWith(ORIGIN + PREFIX) && !u.startsWith('data:'));
  ok('Pages : aucune requête hors du sous-chemin ni vers un autre hôte', outside.length === 0, outside.join(', '));
  ok('Pages : seul games.json répond 404 (attendu)', failed.length === 1 && /games\.json/.test(failed[0]), failed.join(' ; '));
  ok('Pages : console sans erreur JS (hors la ligne réseau 404 du navigateur)', consoleErrors.filter((e) => !/Failed to load resource/.test(e)).length === 0 && env.errors.filter((e) => e.startsWith('pageerror')).length === 0, JSON.stringify({ consoleErrors, errors: env.errors }));
  // Service worker
  const sw = await page.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration(); await navigator.serviceWorker.ready; return r ? { scope: r.scope, active: !!r.active, url: r.active?.scriptURL } : null; });
  ok('SW : enregistré avec la portée /Clone90/', sw?.scope === ORIGIN + PREFIX && sw.active, JSON.stringify(sw));
  const cache = await page.evaluate(async () => { const out = {}; for (const k of await caches.keys()) out[k] = (await (await caches.open(k)).keys()).map((r) => r.url); return out; });
  const urls = Object.values(cache).flat();
  ok('SW : cache créé, contient la coquille (index, player, js, css, icônes, police)', urls.length > 30 && urls.some((u) => u.endsWith('/Clone90/index.html') || u.endsWith('/Clone90/')) && urls.some((u) => u.endsWith('PressStart2P-Regular.ttf')) && urls.some((u) => u.endsWith('player.html')), `${urls.length} entrées, caches=${Object.keys(cache)}`);
  ok('SW : jamais roms/, bios/, games.json dans le cache', !urls.some((u) => /\/(roms|bios)\//.test(u) || /games\.json/.test(u)), '');
  // Hors ligne
  await context.setOffline(true);
  await page.reload(); await page.waitForSelector('.machine-tile, .message-screen', { timeout: 8000 }).catch(() => {});
  const off = await page.evaluate(() => ({ tiles: document.querySelectorAll('.machine-tile').length, banner: document.querySelector('.banner')?.innerText ?? null, fatal: document.querySelector('.message-screen')?.innerText ?? null }));
  ok('SW : hors ligne, l\'application s\'ouvre (coquille depuis le cache)', off.tiles === 2, JSON.stringify(off));
  verdict('SW : hors ligne, message affiché pour la liste des jeux', null, `info : ${JSON.stringify(off.banner)}`, 'pages');
  await page.goto(`${ORIGIN}${PREFIX}player.html?system=amiga&game=x`).catch(() => {});
  await sleep(500);
  const offPlayer = await page.evaluate(() => document.body.innerText.slice(0, 200)).catch(() => 'navigation impossible');
  verdict('SW : hors ligne, player.html', null, `info : ${offPlayer.replace(/\n/g, ' | ')}`, 'pages');
  await context.setOffline(false);
  // Manifest
  const man = await page.evaluate(async () => { const m = await (await fetch('manifest.webmanifest')).json(); const abs = (p) => new URL(p, document.baseURI).href; const icons = await Promise.all(m.icons.map(async (i) => (await fetch(abs(i.src))).status)); return { start: abs(m.start_url), scope: abs(m.scope), icons, display: m.display, name: m.name }; });
  ok('Manifest : start_url et scope relatifs résolus sous /Clone90/, icônes en 200', man.start === ORIGIN + PREFIX && man.scope === ORIGIN + PREFIX && man.icons.every((s) => s === 200), JSON.stringify(man));
  // Navigation Pages
  await page.goto(`${ORIGIN}${PREFIX}#/amiga`); await page.waitForSelector('.empty-state');
  const emp = await page.evaluate(() => document.querySelector('.empty-state').innerText.replace(/\n+/g, ' | '));
  ok('Pages : grille d\'une machine = état vide avec chemin roms/amiga/', /roms\/amiga\//.test(emp), emp);
  await page.goto(`${ORIGIN}${PREFIX}player.html?system=amiga&game=amiga%2Fzool`); await page.waitForSelector('.message-screen, .play-screen');
  const pl = await page.evaluate(() => ({ text: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 250), focus: document.activeElement.textContent }));
  ok('Pages : player.html sur jeu inexistant = message + bouton focusé', /Revenir/.test(pl.focus), JSON.stringify(pl));
  await page.keyboard.press('Enter'); await sleep(800);
  ok('Pages : le bouton de retour reste dans /Clone90/', page.url().startsWith(ORIGIN + PREFIX), page.url());
  await page.goto(`${ORIGIN}${PREFIX}index.html#/inconnu`); await sleep(400);
  ok('Pages : machine inconnue = retour accueil', (await page.evaluate(() => location.hash)) === '#/');
  await page.goto(`${ORIGIN}${PREFIX}nimportequoi.html`);
  verdict('Pages : URL inexistante', null, 'GitHub Pages sert sa propre page 404 (non simulée)', 'pages');
  await env.close();

  // SW sur le serveur local avec de faux jeux : rien d'interdit en cache
  const env2 = await open({ width: 1280, height: 720, contextOptions: { serviceWorkers: 'allow' } });
  const p2 = env2.page;
  await p2.goto(`${BASE}/index.html`); await p2.waitForSelector('.machine-tile'); await p2.evaluate(() => navigator.serviceWorker.ready); await sleep(800);
  await p2.reload(); await p2.waitForSelector('.machine-tile');
  await p2.evaluate(async () => { await fetch('games.json'); await fetch('roms/amiga/Zool%202.adf'); await fetch('bios/kick40068.A1200'); await fetch('roms/amiga/Zool%202.adf', { method: 'HEAD' }); });
  await p2.goto(`${BASE}/player.html?system=amiga&game=amiga%2Fzool_2`); await p2.waitForSelector('.play-screen'); await sleep(500);
  const c2 = await p2.evaluate(async () => { const o = []; for (const k of await caches.keys()) for (const r of await (await caches.open(k)).keys()) o.push(r.url); return o; });
  ok('SW local : après lecture de games.json, roms/, bios/ et ouverture de l\'écran Jouer, aucune de ces ressources en cache', !c2.some((u) => /\/(roms|bios)\/|games\.json|cdn\.emulatorjs/.test(u)), `${c2.length} entrées`);
  const ctl = await p2.evaluate(() => navigator.serviceWorker.controller !== null);
  ok('SW local : la page est contrôlée', ctl);
  await env2.close();
  srv.kill();
})().catch((e) => { console.error(e); srv.kill(); process.exit(1); });
