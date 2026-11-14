// Recette T39 « Supprimer le fichier » : vrai navigateur, vraie bibliothèque IndexedDB, vrai service worker, vrai écran Jouer, vraie API locale.
// Partie 1 (« Mes fichiers », ordinateur, téléphone, paysage) : copie de l'application, jeux importés par « Choisir le dossier des jeux », plus
// un jeu du disque servi par un serveur SANS API (ouvert au réseau, téléphone) : pas de bouton pour lui.
// Partie 2 (Mac ou PC) : serveur limité à cet ordinateur avec l'API (api/games), vrai générateur : le jeu est effacé du DISQUE.
// Fichiers factices : l'émulation n'est pas en jeu. Vérifie : bouton présent, confirmation avec le nom du jeu, refus (Annuler, Échap) =
// rien supprimé, suppression = fichiers retirés (jaquette et disquettes comprises, jamais le BIOS ni un autre jeu) et retour à la grille sans le jeu.
// Usage : PLAYWRIGHT_PATH=... node tests/recette/supprimer-jeu.mjs [dossier de captures]
import { cp, mkdtemp, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pw, verdict, results } from './lib.mjs';
import { PROJECT_ROOT } from '../../scripts/project-root.mjs';
import { createStaticServer } from '../../scripts/serve.mjs';
import { createSettingsApi } from '../../scripts/settings-api.mjs';
import { runGenerate } from '../../scripts/generate-games.mjs';

const captures = process.argv[2];
const root = await mkdtemp(join(tmpdir(), 'clone90-recette-suppr-'));
for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets']) {
  await cp(join(PROJECT_ROOT, f), join(root, f), { recursive: true });
}
// Un jeu « du disque du Mac » (games.json + roms/ sur le serveur).
await mkdir(join(root, 'roms', 'nes'), { recursive: true });
await writeFile(join(root, 'roms', 'nes', 'Mac Game.nes'), 'MAC');
await writeFile(join(root, 'games.json'), JSON.stringify({ version: 1, games: [{ id: 'nes/mac-game', system: 'nes', title: 'Mac Game', file: 'roms/nes/Mac Game.nes', cover: null }] }));

const device = await mkdtemp(join(tmpdir(), 'clone90-appareil-'));
const games = join(device, 'Mes jeux');
const deviceFiles = {
  'roms/nes/Zelda.nes': 'ZELDA', 'roms/nes/Zelda.png': 'PNG', 'roms/nes/Mario.nes': 'MARIO', 'bios/kick40068.A1200': 'KICK',
  'roms/amiga/Leander (Disk 1 of 3).adf': 'ADF1', 'roms/amiga/Leander (Disk 2 of 3).adf': 'ADF2', 'roms/amiga/Leander (Disk 3 of 3).adf': 'ADF3',
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
const storedKeys = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('clone90-local', 1);
  req.onsuccess = () => { const all = req.result.transaction('files').objectStore('files').getAllKeys(); all.onsuccess = () => resolve(all.result.sort()); };
}));
/** Ouvre l'écran Jouer d'un jeu depuis la grille de sa machine. */
async function openGame(page, system, title) {
  await page.goto(`${BASE}/index.html#/${system}`);
  await page.locator(`.game-tile[aria-label="${title}"]`).click();
  await page.waitForURL(/player\.html/);
  await page.getByRole('button', { name: 'Jouer' }).waitFor({ timeout: 5000 });
}

try {
  for (const [label, options] of [['ordinateur', { viewport: { width: 1280, height: 900 } }], ['telephone', { ...pw.devices['Pixel 7'] }], ['paysage', { ...pw.devices['Pixel 7 landscape'] }]]) {
    const context = await browser.newContext(options);
    await context.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.goto(`${BASE}/index.html#/fichiers`);
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.getByRole('button', { name: 'Choisir le dossier des jeux' }).click()]);
    await chooser.setFiles(games);
    await page.locator('.library-notice').waitFor({ timeout: 10000 });
    const initial = await storedKeys(page);
    verdict('T39-import', initial.length === 7, initial.join(', '), label);

    // Jeu du disque, serveur sans API (ouvert au réseau local, téléphone) : pas de bouton.
    await openGame(page, 'nes', 'Mac Game');
    verdict('T39-mac-sans-bouton', await page.getByRole('button', { name: 'Supprimer le fichier' }).count() === 0, '', label);

    // Jeu importé : bouton visible, confirmation avec le nom du jeu.
    await openGame(page, 'nes', 'Zelda');
    const del = page.getByRole('button', { name: 'Supprimer le fichier' });
    verdict('T39-bouton-visible', await del.isVisible(), '', label);
    if (label === 'paysage') {
      const box = await del.boundingBox();
      verdict('T39-paysage-dans-ecran', box && box.y + box.height <= page.viewportSize().height, JSON.stringify(box), label);
    }
    await shot(page, `${label}-1-jouer`);
    await del.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const dialogText = await dialog.textContent();
    verdict('T39-confirmation-nom', /Supprimer Zelda \?/.test(dialogText) && /définitive/.test(dialogText), dialogText, label);
    verdict('T39-focus-annuler', await page.evaluate(() => document.activeElement?.textContent) === 'Annuler', '', label);
    await shot(page, `${label}-2-confirmation`);

    // Refus (Annuler) : rien n'est supprimé, on reste sur l'écran Jouer.
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    verdict('T39-refus-annuler', JSON.stringify(await storedKeys(page)) === JSON.stringify(initial) && /player\.html/.test(page.url()) && await dialog.count() === 0, '', label);
    // Refus (Échap au clavier).
    await del.click();
    await dialog.waitFor();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    verdict('T39-refus-echap', JSON.stringify(await storedKeys(page)) === JSON.stringify(initial) && await dialog.count() === 0, '', label);

    // Suppression confirmée : fichier et jaquette retirés, retour à la grille sans le jeu.
    await del.click();

    const btn = dialog.getByRole('button', { name: 'Supprimer', exact: true });
    await btn.click();
    await page.waitForURL(/index\.html#\/nes/, { timeout: 8000 });
    await page.locator('.game-tile').first().waitFor();
    const afterZelda = await storedKeys(page);
    verdict('T39-suppression', !afterZelda.some((k) => k.startsWith('roms/nes/Zelda')) && afterZelda.length === 5, afterZelda.join(', '), label);
    const titles = await page.locator('.game-tile').evaluateAll((t) => t.map((x) => x.getAttribute('aria-label')));
    verdict('T39-grille-sans-jeu', !titles.includes('Zelda') && titles.includes('Mario') && titles.includes('Mac Game'), titles.join(', '), label);
    await shot(page, `${label}-3-grille`);

    // Jeu à 3 disquettes : les 3 fichiers partent, la confirmation le dit.
    await openGame(page, 'amiga', 'Leander');
    await page.getByRole('button', { name: 'Supprimer le fichier' }).click();
    verdict('T39-disquettes-message', /3 fichiers/.test(await dialog.textContent()), '', label);
    await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await page.waitForURL(/index\.html#\/amiga/);
    const afterLeander = await storedKeys(page);
    verdict('T39-disquettes', JSON.stringify(afterLeander) === JSON.stringify(['bios/kick40068.A1200', 'roms/nes/Mario.nes']), afterLeander.join(', '), label);
    await context.close();
  }

  // Partie 2 : Mac ou PC, serveur limité à cet ordinateur, jeux sur le disque.
  const macRoot = await mkdtemp(join(tmpdir(), 'clone90-recette-mac-'));
  for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets']) {
    await cp(join(PROJECT_ROOT, f), join(macRoot, f), { recursive: true });
  }
  const disk = { 'roms/nes/Contra.nes': 'C', 'roms/nes/Contra.png': 'P', 'roms/nes/Tetris.nes': 'T', 'bios/syscard3.pce': 'B' };
  for (const [rel, content] of Object.entries(disk)) { await mkdir(dirname(join(macRoot, rel)), { recursive: true }); await writeFile(join(macRoot, rel), content); }
  const onDisk = (rel) => access(join(macRoot, rel)).then(() => true, () => false);
  await runGenerate({ root: macRoot, log: () => {}, logError: () => {} });
  let macServer;
  const api = createSettingsApi({ root: macRoot, enabled: false, gamesEnabled: true, getPort: () => macServer.address().port, applyFolders: () => {}, chooseFolder: async () => null,
    regenerate: () => runGenerate({ root: macRoot, log: () => {}, logError: () => {} }) });
  macServer = createStaticServer({ root: macRoot, api });
  const macPort = await new Promise((r) => macServer.listen(0, '127.0.0.1', () => r(macServer.address().port)));
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
    const page = await context.newPage();
    const label = 'mac';
    await page.goto(`http://localhost:${macPort}/index.html#/nes`);
    await page.locator('.game-tile[aria-label="Contra"]').click();
    await page.waitForURL(/player\.html/);
    await page.getByRole('button', { name: 'Jouer' }).waitFor({ timeout: 5000 });
    const del = page.getByRole('button', { name: 'Supprimer le fichier' });
    verdict('T39-mac-bouton-visible', await del.isVisible(), '', label);
    await del.click();
    const dialog = page.getByRole('dialog');
    await dialog.waitFor();
    const text = await dialog.textContent();
    verdict('T39-mac-confirmation', /Supprimer Contra \?/.test(text) && /disque/.test(text) && /définitive/.test(text) && /2 fichiers/.test(text), text, label);
    await shot(page, 'mac-1-confirmation');
    await dialog.getByRole('button', { name: 'Annuler' }).click();
    verdict('T39-mac-refus', await onDisk('roms/nes/Contra.nes') && await onDisk('roms/nes/Contra.png') && await dialog.count() === 0, '', label);
    await del.click();
    await dialog.getByRole('button', { name: 'Supprimer', exact: true }).click();
    await page.waitForURL(/index\.html#\/nes/);
    await page.locator('.game-tile').first().waitFor();
    verdict('T39-mac-disque', !(await onDisk('roms/nes/Contra.nes')) && !(await onDisk('roms/nes/Contra.png')) && await onDisk('roms/nes/Tetris.nes') && await onDisk('bios/syscard3.pce') && await onDisk('roms/nes'), '', label);
    const titles = await page.locator('.game-tile').evaluateAll((t) => t.map((x) => x.getAttribute('aria-label')));
    verdict('T39-mac-grille', JSON.stringify(titles) === JSON.stringify(['Tetris']), titles.join(', '), label);
    await shot(page, 'mac-2-grille');
    await context.close();
  } finally { macServer.close(); }
} finally {
  await browser.close();
  server.close();
}
process.exitCode = results.some((r) => r.verdict !== 'PASSE') ? 1 : 0;
