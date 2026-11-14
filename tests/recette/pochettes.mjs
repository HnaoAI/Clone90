// Recette T40 « pochettes de Mes fichiers » : vrai navigateur, vrai sélecteur de fichiers, vraie bibliothèque IndexedDB et vrai service worker.
// Montage autonome comme scan-dossier.mjs (application SANS roms/, bios/ ni games.json, comme GitHub Pages ou un téléphone).
// GitHub est remplacé par un faux (interception Playwright de api.github.com et raw.githubusercontent.com, avec l'en-tête CORS du vrai) :
// on vérifie le parcours (import, pochette gardée, tuile, jeu sans pochette, relance, sans réseau), pas la base réelle.
// Usage : PLAYWRIGHT_PATH=... node tests/recette/pochettes.mjs [dossier de captures]
import { cp, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pw, verdict, results } from './lib.mjs';
import { PROJECT_ROOT } from '../../scripts/project-root.mjs';
import { createStaticServer } from '../../scripts/serve.mjs';

const captures = process.argv[2];
const root = await mkdtemp(join(tmpdir(), 'clone90-recette-pochettes-'));
for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets']) {
  await cp(join(PROJECT_ROOT, f), join(root, f), { recursive: true });
}
const device = await mkdtemp(join(tmpdir(), 'clone90-appareil-'));
await writeFile(join(device, 'Gods.adf'), 'ADF-GODS');
await writeFile(join(device, 'Mon jeu maison.adf'), 'ADF-MAISON');
await writeFile(join(device, 'Zool.adf'), 'ADF-ZOOL');
const COVER = await readFile(join(PROJECT_ROOT, 'assets/icons/icon-192.png')); // un vrai PNG, affichable

const server = createStaticServer({ root });
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://localhost:${port}`;
const browser = await pw.chromium.launch();
const shot = async (p, name) => { if (captures) await p.screenshot({ path: join(captures, `${name}.png`), fullPage: true }); };
const CORS = { 'access-control-allow-origin': '*' };

/** Faux GitHub : base Amiga avec Gods et Zool (Mon jeu maison absent). `online: false` = GitHub injoignable. Renvoie les adresses demandées. */
async function fakeGithub(context, { online = true } = {}) {
  const seen = [];
  await context.route('https://api.github.com/**', (route) => {
    seen.push(route.request().url());
    if (!online) return route.abort('internetdisconnected');
    const url = route.request().url();
    if (url.endsWith('/Commodore_-_Amiga/git/trees/HEAD')) return route.fulfill({ headers: CORS, json: { tree: [{ path: 'Named_Boxarts', type: 'tree', sha: 'BOX' }] } });
    if (url.endsWith('/Commodore_-_Amiga/git/trees/BOX')) {
      return route.fulfill({ headers: CORS, json: { truncated: false, tree: [
        { path: 'Gods (Europe).png', type: 'blob', sha: 'g', size: COVER.length }, { path: 'Zool (Europe).png', type: 'blob', sha: 'z', size: COVER.length },
      ] } });
    }
    return route.fulfill({ status: 404, headers: CORS, body: '' });
  });
  await context.route('https://raw.githubusercontent.com/**', (route) => {
    seen.push(route.request().url());
    if (!online) return route.abort('internetdisconnected');
    return route.fulfill({ headers: { ...CORS, 'content-type': 'image/png' }, body: COVER });
  });
  return seen;
}

/** « Mes fichiers », bouton Amiga, fichiers donnés ; renvoie le message affiché sous l'import. */
async function importAmiga(page, files) {
  await page.goto(`${BASE}/index.html#/fichiers`);
  const button = page.locator('[data-nav-id="add-amiga"]');
  await button.waitFor({ timeout: 5000 });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
  await chooser.setFiles(files.map((f) => join(device, f)));
  const notice = page.locator('.library-notice');
  await notice.waitFor({ timeout: 10000 });
  return notice.textContent();
}

const storedKeys = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('clone90-local', 1);
  req.onsuccess = () => { const all = req.result.transaction('files').objectStore('files').getAllKeys(); all.onsuccess = () => resolve(all.result.sort()); };
}));

try {
  for (const [label, options] of [['ordinateur', { viewport: { width: 1280, height: 900 } }], ['telephone', { ...pw.devices['Pixel 7'] }]]) {
    const context = await browser.newContext(options);
    await context.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
    const seen = await fakeGithub(context);
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(() => navigator.serviceWorker.ready);

    // 1. Import de deux jeux : Gods a une pochette, « Mon jeu maison » n'en a pas.
    const message = await importAmiga(page, ['Gods.adf', 'Mon jeu maison.adf']);
    verdict('T40-import-message', message === '2 fichiers ajoutés. Pochettes : 1 ajoutée, 1 introuvable', message, label);
    const keys = await storedKeys(page);
    verdict('T40-pochette-gardee', JSON.stringify(keys) === JSON.stringify(['roms/amiga/Gods.adf', 'roms/amiga/Gods.png', 'roms/amiga/Mon jeu maison.adf']), keys.join(', '), label);
    verdict('T40-texte-github', /GitHub voit l'adresse IP/.test(await page.locator('#library-covers-info').textContent()), '', label);
    await shot(page, `${label}-1-mes-fichiers`);

    // 2. Grille Amiga : la tuile de Gods montre l'image (servie par le service worker depuis l'appareil), l'autre garde son nom.
    await page.goto(`${BASE}/index.html#/amiga`);
    await page.locator('.game-tile').first().waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('.game-cover img')].every((i) => i.complete));
    const tiles = await page.locator('.game-tile').evaluateAll((all) => all.map((t) => {
      const img = t.querySelector('.game-cover > img'); // pas le logo de la machine du repli
      return { title: t.getAttribute('aria-label'), image: Boolean(img && img.naturalWidth > 0), initials: Boolean(t.querySelector('.cover-initials')) };
    }));
    const gods = tiles.find((t) => t.title === 'Gods');
    const maison = tiles.find((t) => t.title === 'Mon jeu maison');
    verdict('T40-tuile-pochette', gods?.image === true, JSON.stringify(gods), label);
    verdict('T40-tuile-sans-pochette', maison?.image === false && maison.initials === true, JSON.stringify(maison), label);
    await shot(page, `${label}-2-grille`);

    // 3. Bouton « Chercher les pochettes manquantes » : rien de retéléchargé.
    const before = seen.length;
    await page.goto(`${BASE}/index.html#/fichiers`);
    await page.locator('[data-nav-id="find-covers"]').click();
    const notice = page.locator('.library-notice');
    await notice.waitFor({ timeout: 10000 });
    const again = await notice.textContent();
    verdict('T40-relance', again === 'Pochettes : 1 introuvable', again, label);
    verdict('T40-relance-sans-telechargement', seen.slice(before).every((u) => !u.startsWith('https://raw.')), seen.slice(before).join(' '), label);
    verdict('T40-liste-en-cache', seen.filter((u) => u.startsWith('https://api.')).length === 2, `${seen.filter((u) => u.startsWith('https://api.')).length} lectures de liste`, label);
    verdict('T40-focus-bouton', await page.evaluate(() => document.activeElement?.dataset?.navId === 'find-covers'), '', label);

    // 4. Seules des lectures d'images libretro-thumbnails sont sorties de l'appareil.
    const outside = seen.filter((u) => !/^https:\/\/(api\.github\.com\/repos|raw\.githubusercontent\.com)\/libretro-thumbnails\//.test(u));
    verdict('T40-seulement-github-images', outside.length === 0 && seen.filter((u) => u.startsWith('https://raw.')).every((u) => /\/Named_Boxarts\/[^/]+\.png$/.test(u)), outside.join(' '), label);
    await context.close();

    // 5. Sans réseau vers GitHub : l'import réussit quand même, la tuile garde son nom.
    const offline = await browser.newContext(options);
    await offline.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
    await fakeGithub(offline, { online: false });
    const page2 = await offline.newPage();
    await page2.goto(`${BASE}/index.html`);
    await page2.evaluate(() => navigator.serviceWorker.ready);
    const msg = await importAmiga(page2, ['Zool.adf']);
    verdict('T40-sans-reseau-import-ok', /^1 fichier ajouté\. Pochettes indisponibles pour Amiga/.test(msg), msg, label);
    verdict('T40-sans-reseau-fichiers', JSON.stringify(await storedKeys(page2)) === JSON.stringify(['roms/amiga/Zool.adf']), '', label);
    await shot(page2, `${label}-3-sans-reseau`);
    await offline.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exitCode = results.some((r) => r.verdict !== 'PASSE') ? 1 : 0;
