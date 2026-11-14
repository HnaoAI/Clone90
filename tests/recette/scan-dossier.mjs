// Recette T38 « Choisir le dossier des jeux » : vrai navigateur, vrai sélecteur de dossier (webkitdirectory), vraie bibliothèque IndexedDB
// et vrai service worker. Montage autonome : copie de l'application SANS roms/, bios/ ni games.json (comme GitHub Pages ou un téléphone),
// et un faux dossier de jeux sur « l'appareil » (un sous-dossier par machine, bios/, fichiers parasites). Les fichiers sont factices :
// on vérifie le rangement, les grilles et que le jeu est servi à player.html, pas l'émulation (vérifiée en T27 avec une vraie ROM).
// Usage : PLAYWRIGHT_PATH=... node tests/recette/scan-dossier.mjs [dossier de captures]
import { cp, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pw, verdict, results } from './lib.mjs';
import { PROJECT_ROOT } from '../../scripts/project-root.mjs';
import { createStaticServer } from '../../scripts/serve.mjs';

const captures = process.argv[2];
const root = await mkdtemp(join(tmpdir(), 'clone90-recette-scan-'));
for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets']) {
  await cp(join(PROJECT_ROOT, f), join(root, f), { recursive: true });
}
// Dossier de l'appareil : « Mes jeux/roms/<machine>/... » et « Mes jeux/bios/ ».
const device = await mkdtemp(join(tmpdir(), 'clone90-appareil-'));
const games = join(device, 'Mes jeux');
const deviceFiles = {
  'roms/amiga/Leander (Disk 1 of 3).adf': 'ADF1', 'roms/amiga/Leander (Disk 2 of 3).adf': 'ADF2', 'roms/amiga/Leander (Disk 3 of 3).adf': 'ADF3',
  'roms/Amiga/notice.pdf': 'PDF', 'roms/neogeo/mslug.zip': 'MSLUG', 'roms/neogeo/neogeo.zip': 'BIOSNEOGEO',
  'roms/nes/homebrew.nes': 'NES', 'roms/megacd/Sonic CD/Sonic CD.cue': 'FILE "Sonic CD.bin" BINARY\n  TRACK 01 MODE1/2352\n', 'roms/megacd/Sonic CD/Sonic CD.bin': 'BIN',
  'roms/divers/autre.zip': 'X', 'roms/amiga/.DS_Store': 'X', 'bios/kick40068.A1200': 'KICK',
};
for (const [rel, content] of Object.entries(deviceFiles)) {
  await mkdir(dirname(join(games, rel)), { recursive: true });
  await writeFile(join(games, rel), content);
}

const server = createStaticServer({ root });
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://localhost:${port}`;
const browser = await pw.chromium.launch();
const shot = async (p, name) => { if (captures) await p.screenshot({ path: join(captures, `${name}.png`), fullPage: true }); };

/** Ouvre « Mes fichiers », touche « Choisir le dossier des jeux » et donne le dossier ; renvoie le message affiché. */
async function scan(page) {
  await page.goto(`${BASE}/index.html#/fichiers`);
  const button = page.getByRole('button', { name: 'Choisir le dossier des jeux' });
  await button.waitFor({ timeout: 5000 });
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), button.click()]);
  await chooser.setFiles(games);
  const notice = page.locator('.library-notice');
  await notice.waitFor({ timeout: 10000 });
  return notice.textContent();
}

try {
  for (const [label, options] of [['ordinateur', { viewport: { width: 1280, height: 900 } }], ['telephone', { ...pw.devices['Pixel 7'] }]]) {
    const context = await browser.newContext(options);
    await context.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(() => navigator.serviceWorker.ready);

    const message = await scan(page);
    verdict('T38-message', message === 'Dossier importé : Amiga 3 fichiers, Neo Geo 1 fichier, Mega-CD 2 fichiers, NES 1 fichier ; 2 BIOS ; 2 fichiers ignorés (format ou dossier non reconnu)', message, label);
    verdict('T38-focus-bouton', await page.evaluate(() => document.activeElement?.dataset?.navId === 'scan-folder'), '', label);
    await shot(page, `${label}-1-mes-fichiers`);

    const stored = await page.evaluate(() => new Promise((resolve) => {
      const req = indexedDB.open('clone90-local', 1);
      req.onsuccess = () => {
        const all = req.result.transaction('files').objectStore('files').getAllKeys();
        all.onsuccess = () => resolve(all.result.sort());
      };
    }));
    const expected = ['bios/kick40068.A1200', 'bios/neogeo.zip', 'roms/amiga/Leander (Disk 1 of 3).adf', 'roms/amiga/Leander (Disk 2 of 3).adf',
      'roms/amiga/Leander (Disk 3 of 3).adf', 'roms/megacd/Sonic CD.bin', 'roms/megacd/Sonic CD.cue', 'roms/neogeo/mslug.zip', 'roms/nes/homebrew.nes'];
    verdict('T38-rangement', JSON.stringify(stored) === JSON.stringify(expected), stored.join(', '), label);
    verdict('T38-bios-present', /kick40068\.A1200 - présent/.test(await page.locator('.library-bios').textContent()), '', label);

    // Accueil : chaque machine compte ses jeux ; neogeo.zip n'est pas un jeu.
    await page.goto(`${BASE}/index.html#/`);
    await page.locator('.machine-tile').first().waitFor();
    const count = async (id) => (await page.locator(`.machine-tile[data-nav-id="${id}"] .machine-count`).textContent()).trim();
    const counts = { amiga: await count('amiga'), neogeo: await count('neogeo'), nes: await count('nes'), megacd: await count('megacd') };
    verdict('T38-accueil-compteurs', counts.amiga === '1 jeu' && counts.neogeo === '1 jeu' && counts.nes === '1 jeu' && counts.megacd === '1 jeu', JSON.stringify(counts), label);
    await shot(page, `${label}-2-accueil`);

    await page.goto(`${BASE}/index.html#/neogeo`);
    await page.locator('.game-tile').first().waitFor();
    const titles = await page.locator('.game-tile').evaluateAll((tiles) => tiles.map((t) => t.getAttribute('aria-label')));
    verdict('T38-neogeo-sans-bios', JSON.stringify(titles) === JSON.stringify(['Metal Slug']), titles.join(', '), label);

    // Jouer : le service worker sert les fichiers du jeu et du BIOS depuis l'appareil (le serveur n'a ni roms/ ni bios/).
    const served = await page.evaluate(async () => Promise.all(['roms/neogeo/mslug.zip', 'bios/neogeo.zip', 'roms/megacd/Sonic CD.bin']
      .map(async (p) => { const r = await fetch(p); return [r.status, await r.text()]; })));
    verdict('T38-servi-localement', JSON.stringify(served) === JSON.stringify([[200, 'MSLUG'], [200, 'BIOSNEOGEO'], [200, 'BIN']]), JSON.stringify(served), label);
    await page.locator('.game-tile').first().click();
    await page.waitForURL(/player\.html/);
    const play = page.getByRole('button', { name: /Jouer/ });
    await play.waitFor({ timeout: 5000 });
    const missing = await page.locator('text=/introuvable|manquant/i').count();
    verdict('T38-ecran-jouer', missing === 0, `boutons Jouer : ${await play.count()}`, label);
    await shot(page, `${label}-3-jouer`);

    // Deuxième scan du même dossier : rien n'est recopié.
    const again = await scan(page);
    verdict('T38-rescan', again === 'Rien de nouveau : 9 fichiers déjà présents ; 2 fichiers ignorés (format ou dossier non reconnu)', again, label);
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
process.exitCode = results.some((r) => r.verdict !== 'PASSE') ? 1 : 0;
