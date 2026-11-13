// Recette T34 « Depuis une page web » : vrai navigateur, vrai relais (scripts/link-relay.mjs) et faux site local.
// Montage autonome : copie de l'application dans un dossier temporaire, deux serveurs Clone90 (« Mac » avec l'API, « téléphone » sans API),
// un faux site (page avec liens, fichiers, une page lisible par CORS et une qui ne l'est pas). Le relais autorise 127.0.0.1 ICI SEULEMENT
// (`allowAddress` injecté), sinon il refuserait le faux site comme toute adresse locale.
// Usage : PLAYWRIGHT_PATH=... node tests/recette/liens.mjs [dossier de captures]
import http from 'node:http';
import { cp, mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pw, verdict, results } from './lib.mjs';
import { PROJECT_ROOT } from '../../scripts/project-root.mjs';
import { createStaticServer } from '../../scripts/serve.mjs';
import { createSettingsApi } from '../../scripts/settings-api.mjs';
import { scanPage, downloadLinks } from '../../scripts/link-relay.mjs';
import { runGenerate } from '../../scripts/generate-games.mjs';

const captures = process.argv[2];
const root = await mkdtemp(join(tmpdir(), 'clone90-recette-liens-'));
for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets']) {
  await cp(join(PROJECT_ROOT, f), join(root, f), { recursive: true });
}
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));

// Faux site : /jeux/ page de liens (sans CORS), /ouvert/ même page avec CORS, fichiers.
const page = (prefix) => `<html><body><h1>Mes jeux libres</h1><ul>
  <li><a href="${prefix}Amiga/Demo%20Disk.adf">Demo Disk</a></li><li><a href="${prefix}divers/Pong.zip">Pong</a></li>
  <li><a href="${prefix}nes/homebrew.nes">NES</a></li><li><a href="${prefix}bios/syscard3.pce">BIOS</a></li>
  <li><a href="notice.pdf">Notice</a></li><li><a href="photo.png">Photo</a></li></ul></body></html>`;
const site = http.createServer((req, res) => {
  const cors = req.url.startsWith('/ouvert/') ? { 'Access-Control-Allow-Origin': '*' } : {};
  // T36 : site à deux niveaux, lien sans nom de fichier (Content-Disposition).
  if (req.url === '/categorie/') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<a href="/jeu/1">Jeu libre</a><a href="/aide.html">aide</a>'); }
  if (req.url === '/jeu/1') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<a href="/download?id=7">Télécharger</a>'); }
  if (req.url === '/aide.html') { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end('<p>Rien ici</p>'); }
  if (req.url === '/download?id=7') { res.writeHead(200, { 'Content-Disposition': 'attachment; filename="Sous Page.adf"' }); return res.end('ADF'); }
  if (req.url === '/jeux/' || req.url === '/ouvert/') { res.writeHead(200, { 'Content-Type': 'text/html', ...cors }); return res.end(page('')); }
  if (/\.(adf|zip|nes|pce)$/.test(req.url)) { res.writeHead(200, { 'Content-Type': 'application/octet-stream', ...cors }); return res.end(`FICHIER ${req.url}`); }
  res.writeHead(404); res.end();
});
const sitePort = await listen(site);
const SITE = `http://127.0.0.1:${sitePort}`;

const relay = { allowAddress: (ip) => ip === '127.0.0.1' };
let macServer;
const api = createSettingsApi({
  root, enabled: true, getPort: () => macServer.address().port, applyFolders: (f) => macServer.setFolders(f), chooseFolder: async () => null,
  regenerate: () => runGenerate({ root, log: () => {}, logError: () => {} }),
  scanLinks: (url, systems, options) => scanPage(url, systems, { ...options, ...relay }),
  fetchLinks: (items, options) => downloadLinks(items, { ...options, ...relay }),
});
macServer = createStaticServer({ root, api });
const macPort = await listen(macServer);
const phoneServer = createStaticServer({ root });
const phonePort = await listen(phoneServer);

const browser = await pw.chromium.launch();
const shot = async (p, name) => { if (captures) await p.screenshot({ path: join(captures, `${name}.png`), fullPage: true }); };
try {
  // --- Mac ---
  const mac = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
  await mac.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
  await mac.goto(`http://localhost:${macPort}/index.html`);
  const homeButton = mac.locator('.links-button');
  await homeButton.waitFor({ timeout: 5000 });
  verdict('T34-accueil-bouton', await homeButton.isVisible(), await homeButton.textContent());
  await homeButton.click();
  await mac.locator('#link-url').waitFor();
  verdict('T34-focus-champ', await mac.evaluate(() => document.activeElement?.id === 'link-url'));
  const warning = await mac.locator('.link-warning strong').textContent();
  verdict('T34-avertissement', warning === 'Télécharge uniquement des fichiers dont tu as le droit de disposer.', warning);
  await shot(mac, 'mac-1-adresse');

  await mac.fill('#link-url', 'http://192.168.1.1/');
  await mac.keyboard.press('Enter');
  await mac.locator('.link-status.is-error').waitFor();
  verdict('T34-refus-prive', /local ou privé/.test(await mac.locator('.link-status').textContent()), await mac.locator('.link-status').textContent());

  await mac.fill('#link-url', `${SITE}/jeux/`);
  await mac.getByRole('button', { name: 'Analyser' }).click();
  await mac.locator('.link-file').first().waitFor();
  const names = await mac.locator('.link-toggle').allTextContents();
  verdict('T34-fichiers-reconnus', JSON.stringify(names) === JSON.stringify(['Demo Disk.adf', 'Pong.zip', 'homebrew.nes', 'syscard3.pce']), names.join(', '));
  const machines = await mac.locator('.link-machine').evaluateAll((s) => s.map((x) => x.value));
  verdict('T34-machine-devinee', JSON.stringify(machines) === JSON.stringify(['amiga', '', 'nes', 'bios']), machines.join(', '));
  const pressed = await mac.locator('.link-toggle').evaluateAll((b) => b.map((x) => x.getAttribute('aria-pressed')));
  verdict('T34-pong-non-coche', pressed[1] === 'false', pressed.join(', '));
  await shot(mac, 'mac-2-liste');
  await mac.locator('.link-machine').nth(1).selectOption('arcade');
  verdict('T34-choix-manuel-coche', await mac.locator('.link-toggle').nth(1).getAttribute('aria-pressed') === 'true');
  await mac.locator('.link-toggle').nth(2).click(); // décoche la NES
  const label = await mac.locator('[data-nav-id="link-download"]').textContent();
  verdict('T34-compteur', label === 'Télécharger la sélection (3)', label);
  await mac.locator('[data-nav-id="link-download"]').click();
  await mac.locator('.link-status.is-ok').waitFor({ timeout: 10000 });
  const summary = await mac.locator('.link-status').textContent();
  verdict('T34-resume', /Fichiers téléchargés : 3/.test(summary), summary);
  await shot(mac, 'mac-3-resume');
  const amiga = await readdir(join(root, 'roms', 'amiga')).catch(() => []);
  const arcade = await readdir(join(root, 'roms', 'arcade')).catch(() => []);
  const bios = await readdir(join(root, 'bios')).catch(() => []);
  verdict('T34-fichiers-ranges', amiga.includes('Demo Disk.adf') && arcade.includes('Pong.zip') && bios.includes('syscard3.pce') && !(await readdir(join(root, 'roms')).then((d) => d.includes('nes'))),
    `amiga=${amiga} arcade=${arcade} bios=${bios}`);
  const games = JSON.parse(await readFile(join(root, 'games.json'), 'utf8'));
  verdict('T34-games-json', games.games.some((g) => g.system === 'amiga') && games.games.some((g) => g.system === 'arcade'), `${games.games.length} jeux`);
  await mac.locator('[data-nav-id="link-download"]').click();
  await mac.waitForFunction(() => /Déjà présents : 3/.test(document.querySelector('.link-status')?.textContent ?? ''), null, { timeout: 10000 });
  verdict('T34-deja-presents', true, await mac.locator('.link-status').textContent());
  // T36 : 2 niveaux, fichier trouvé sur une sous-page, sans nom dans l'adresse
  await mac.fill('#link-url', `${SITE}/categorie/`);
  await mac.selectOption('#link-depth', '2');
  await mac.getByRole('button', { name: 'Analyser' }).click();
  await mac.locator('.link-file').first().waitFor({ timeout: 10000 });
  const sub = await mac.locator('.link-toggle').allTextContents();
  verdict('T36-sous-page', JSON.stringify(sub) === JSON.stringify(['Sous Page.adf']), sub.join(', '));
  verdict('T36-page-origine', /\/jeu\/1/.test(await mac.locator('.link-file-page').first().textContent()), await mac.locator('.link-file-page').first().textContent());
  verdict('T36-message', /sur 3 pages/.test(await mac.locator('.link-status').textContent()), await mac.locator('.link-status').textContent());
  await shot(mac, 'mac-4-sous-page');
  await mac.locator('[data-nav-id="link-download"]').click();
  await mac.locator('.link-status.is-ok').waitFor({ timeout: 10000 });
  verdict('T36-telecharge-nom', (await readdir(join(root, 'roms', 'amiga'))).includes('Sous Page.adf'));
  await mac.fill('#link-url', `${SITE}/categorie/`);
  await mac.selectOption('#link-depth', '0');
  await mac.getByRole('button', { name: 'Analyser' }).click();
  await mac.locator('.link-status.is-error').waitFor({ timeout: 10000 });
  const empty = await mac.locator('.link-status').textContent();
  verdict('T36-analyse-vide-expliquee', /2 liens lus sur 1 page, aucun fichier/.test(empty), empty);
  await shot(mac, 'mac-5-vide');
  await mac.locator('[data-nav-id="link-scan"]').focus(); // Échap dans le champ d'adresse appartient au champ (couche d'entrée)
  await mac.keyboard.press('Escape');
  await mac.locator('.links-button').waitFor();
  verdict('T34-retour-accueil', true);

  // --- Téléphone (sans API : le navigateur lit lui-même) ---
  const phone = await (await browser.newContext({ ...pw.devices['Pixel 7'] })).newPage();
  await phone.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
  await phone.goto(`http://localhost:${phonePort}/index.html#/telecharger`);
  await phone.locator('#link-url').waitFor();
  verdict('T34-tel-texte', /Mes fichiers/.test(await phone.locator('.link-warning p').textContent()));
  await phone.fill('#link-url', `${SITE}/jeux/`);
  await phone.getByRole('button', { name: 'Analyser' }).click();
  await phone.locator('.link-status.is-error').waitFor();
  const blocked = await phone.locator('.link-status').textContent();
  verdict('T34-tel-cors-refuse', /depuis Clone90 sur le Mac/.test(blocked), blocked);
  await shot(phone, 'tel-1-refus');
  await phone.fill('#link-url', `${SITE}/ouvert/`);
  await phone.getByRole('button', { name: 'Analyser' }).click();
  await phone.locator('.link-file').first().waitFor();
  await shot(phone, 'tel-2-liste');
  await phone.locator('[data-nav-id="link-download"]').click();
  await phone.locator('.link-status.is-ok').waitFor({ timeout: 10000 });
  const telSummary = await phone.locator('.link-status').textContent();
  verdict('T34-tel-telecharge', /Fichiers téléchargés : 3/.test(telSummary), telSummary);
  const stored = await phone.evaluate(() => new Promise((resolve) => {
    const r = indexedDB.open('clone90-local');
    r.onsuccess = () => { const q = r.result.transaction('files').objectStore('files').getAllKeys(); q.onsuccess = () => resolve(q.result); };
  }));
  verdict('T34-tel-mes-fichiers', ['roms/amiga/Demo Disk.adf', 'roms/nes/homebrew.nes', 'bios/syscard3.pce'].every((p) => stored.includes(p)), stored.join(', '));
  const overflow = await phone.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  verdict('T34-tel-pas-de-debordement', overflow <= 0, `${overflow}px`);
  await shot(phone, 'tel-3-resume');
} finally {
  await browser.close();
  site.close(); macServer.close(); phoneServer.close();
}
const failed = results.filter((r) => r.verdict !== 'PASSE');
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length ? 1 : 0);
