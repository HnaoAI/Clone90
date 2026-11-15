// Recette T42 « logos des machines sur le téléphone » : vrai navigateur (Pixel 7 et ordinateur), vraie bibliothèque IndexedDB, vrai service worker,
// application SANS roms/, bios/ ni games.json (comme GitHub Pages ou un téléphone). GitHub est remplacé par un faux (interception Playwright de
// api.github.com et raw.githubusercontent.com, avec l'en-tête CORS du vrai). Par défaut les logos servis sont de petits SVG factices ;
// `VRAIS_LOGOS=<dossier>` sert à la place les fichiers <dossier>/<logoTheme>.svg (copie locale du thème, pour des captures réalistes).
// Vérifie : logos rangés au chemin du Mac après un import, accueil avec les vrais logos dans les bulles, « Mes fichiers » sans les logos,
// relance sans téléchargement, seulement des lectures du thème es-theme-carbon, logos encore là hors ligne, import sans réseau avec logos maison.
// Usage : PLAYWRIGHT_PATH=... [VRAIS_LOGOS=...] node tests/recette/logos-telephone.mjs [dossier de captures]
import { cp, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pw, verdict, results } from './lib.mjs';
import { PROJECT_ROOT } from '../../scripts/project-root.mjs';
import { createStaticServer } from '../../scripts/serve.mjs';

const captures = process.argv[2];
const realLogos = process.env.VRAIS_LOGOS;
const root = await mkdtemp(join(tmpdir(), 'clone90-recette-logos-'));
for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets']) {
  await cp(join(PROJECT_ROOT, f), join(root, f), { recursive: true });
}
const systems = JSON.parse(await readFile(join(PROJECT_ROOT, 'systems.json'), 'utf8')).systems;
const withTheme = systems.filter((s) => s.logoTheme);
const device = await mkdtemp(join(tmpdir(), 'clone90-appareil-'));
for (const name of ['Gods.adf', 'Zool.adf', 'Jeu NES.nes']) await writeFile(join(device, name), 'X');

const server = createStaticServer({ root });
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://localhost:${port}`;
const browser = await pw.chromium.launch();
const shot = async (p, name, fullPage = false) => { if (captures) await p.screenshot({ path: join(captures, `${name}.png`), fullPage }); };
const CORS = { 'access-control-allow-origin': '*' };
const THEME = /^https:\/\/raw\.githubusercontent\.com\/RetroPie\/es-theme-carbon\/[0-9a-f]{40}\/([a-z0-9-]+)\/art\/system\.svg$/;
const fakeSvg = (theme) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 80"><rect width="200" height="80" rx="12" fill="#222"/><text x="100" y="50" font-size="28" text-anchor="middle" fill="#fff">${theme}</text></svg>`;
const logoBody = async (theme) => (realLogos ? readFile(join(realLogos, `${theme}.svg`), 'utf8') : fakeSvg(theme));

/** Faux GitHub : listes de pochettes vides (aucune pochette), logos du thème. `online: false` = GitHub injoignable. Renvoie les adresses demandées. */
async function fakeGithub(context, { online = true } = {}) {
  const seen = [];
  await context.route('https://api.github.com/**', (route) => {
    seen.push(route.request().url());
    if (!online) return route.abort('internetdisconnected');
    if (route.request().url().endsWith('/git/trees/HEAD')) return route.fulfill({ headers: CORS, json: { tree: [{ path: 'Named_Boxarts', type: 'tree', sha: 'BOX' }] } });
    return route.fulfill({ headers: CORS, json: { truncated: false, tree: [] } });
  });
  await context.route('https://raw.githubusercontent.com/**', async (route) => {
    const url = route.request().url();
    seen.push(url);
    if (!online) return route.abort('internetdisconnected');
    const theme = url.match(THEME)?.[1];
    if (!theme) return route.fulfill({ status: 404, headers: CORS, body: '' });
    return route.fulfill({ headers: { ...CORS, 'content-type': 'image/svg+xml' }, body: await logoBody(theme) });
  });
  return seen;
}

/** « Mes fichiers », bouton d'ajout d'une machine, fichiers donnés ; renvoie le message affiché sous l'import. */
async function importGames(page, systemId, files) {
  await page.goto(`${BASE}/index.html#/fichiers`);
  const button = page.locator(`[data-nav-id="add-${systemId}"]`);
  await button.waitFor({ timeout: 5000 });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
  await chooser.setFiles(files.map((f) => join(device, f)));
  const notice = page.locator('.library-notice');
  await notice.waitFor({ timeout: 15000 });
  return notice.textContent();
}

const storedKeys = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('clone90-local', 1);
  req.onsuccess = () => { const all = req.result.transaction('files').objectStore('files').getAllKeys(); all.onsuccess = () => resolve(all.result.sort()); };
}));

/** Logos de l'accueil : par machine affichée, source de l'image, image chargée, plaque du vrai logo. */
async function homeLogos(page) {
  await page.goto(`${BASE}/index.html#/`);
  await page.locator('.machine-tile').first().waitFor();
  await page.waitForFunction(() => [...document.querySelectorAll('.machine-logo img')].every((i) => i.complete));
  return page.locator('.machine-tile').evaluateAll((all) => all.map((t) => {
    const img = t.querySelector('.machine-logo img');
    return { name: t.querySelector('.machine-name')?.textContent, src: img?.getAttribute('src') ?? null, loaded: Boolean(img && img.naturalWidth > 0),
      downloaded: t.querySelector('.machine-logo')?.classList.contains('is-downloaded') ?? false };
  }));
}

try {
  for (const [label, options] of [['telephone', { ...pw.devices['Pixel 7'] }], ['ordinateur', { viewport: { width: 1280, height: 900 } }]]) {
    const context = await browser.newContext(options);
    await context.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
    const seen = await fakeGithub(context);
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(() => navigator.serviceWorker.ready);

    // 0. Avant : logos maison (référence).
    await importGames(page, 'amiga', ['Gods.adf', 'Zool.adf']);
    const msg = await importGames(page, 'nes', ['Jeu NES.nes']);
    verdict('T42-import-reussi', /^1 fichier ajouté/.test(msg), msg, label);

    // 1. Les logos de toutes les machines du thème sont rangés au chemin du Mac, une seule lecture chacun.
    const keys = await storedKeys(page);
    const logoKeys = keys.filter((k) => k.startsWith('roms/clone90-logos/'));
    const expected = withTheme.map((s) => `roms/clone90-logos/${s.id}.svg`).sort();
    verdict('T42-logos-ranges', JSON.stringify(logoKeys) === JSON.stringify(expected), `${logoKeys.length} sur ${expected.length}`, label);
    const logoReads = seen.filter((u) => THEME.test(u));
    verdict('T42-une-lecture-par-logo', logoReads.length === withTheme.length, `${logoReads.length} lectures`, label);

    // 2. Accueil (toutes les machines, celles à 0 jeu après) : chaque machine montre son vrai logo, chargé (servi par le service worker
    //    depuis l'appareil), sur la plaque claire.
    const tiles = await homeLogos(page);
    const ok = tiles.length === systems.length && tiles.every((t) => t.downloaded && t.loaded && /^roms\/clone90-logos\/[a-z0-9]+\.svg$/.test(t.src));
    verdict('T42-accueil-vrais-logos', ok, JSON.stringify(tiles), label);
    await shot(page, `${label}-1-accueil`, label === 'telephone');

    // 3. « Mes fichiers » : les logos ne sont pas listés comme fichiers de la personne ; la phrase parle des logos.
    await page.goto(`${BASE}/index.html#/fichiers`);
    await page.locator('[data-nav-id="find-covers"]').waitFor();
    const listed = await page.locator('main, #screen').first().textContent();
    verdict('T42-mes-fichiers-sans-logos', !/clone90-logos|\.svg/.test(listed) && /Gods\.adf/.test(listed), '', label);
    verdict('T42-texte-logos', /logos des machines/.test(await page.locator('#library-covers-info').textContent()), '', label);

    // 4. Relance (« Chercher les pochettes manquantes ») : aucun logo retéléchargé.
    const before = seen.length;
    await page.locator('[data-nav-id="find-covers"]').click();
    await page.locator('.library-notice').waitFor({ timeout: 15000 });
    verdict('T42-relance-sans-telechargement', seen.slice(before).every((u) => !THEME.test(u)), seen.slice(before).join(' '), label);

    // 5. Seules des lectures de GitHub : listes libretro-thumbnails et logos du thème, rien d'autre.
    const outside = seen.filter((u) => !THEME.test(u) && !/^https:\/\/api\.github\.com\/repos\/libretro-thumbnails\//.test(u));
    verdict('T42-seulement-github', outside.length === 0, outside.join(' '), label);

    // 6. Hors ligne : les logos restent (gardés sur l'appareil).
    await context.setOffline(true);
    const offlineTiles = await homeLogos(page);
    verdict('T42-hors-ligne-logos', offlineTiles.length === systems.length && offlineTiles.every((t) => t.downloaded && t.loaded), JSON.stringify(offlineTiles), label);
    await context.close();

    // 7. GitHub injoignable : l'import réussit, rien n'est rangé, l'accueil garde le logo maison.
    const offline = await browser.newContext(options);
    await offline.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
    await fakeGithub(offline, { online: false });
    const page2 = await offline.newPage();
    await page2.goto(`${BASE}/index.html`);
    await page2.evaluate(() => navigator.serviceWorker.ready);
    const msg2 = await importGames(page2, 'amiga', ['Gods.adf']);
    verdict('T42-sans-reseau-import-ok', /^1 fichier ajouté/.test(msg2), msg2, label);
    verdict('T42-sans-reseau-rien-range', JSON.stringify(await storedKeys(page2)) === JSON.stringify(['roms/amiga/Gods.adf']), '', label);
    const own = await homeLogos(page2);
    const amiga = own.find((t) => t.name === 'Amiga');
    verdict('T42-sans-reseau-logo-maison', amiga?.src === 'assets/logos/amiga.svg' && amiga.loaded && own.every((t) => !t.downloaded), JSON.stringify(amiga), label);
    if (label === 'telephone') await shot(page2, `${label}-2-sans-reseau-logo-maison`);
    await offline.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exitCode = results.some((r) => r.verdict !== 'PASSE') ? 1 : 0;
