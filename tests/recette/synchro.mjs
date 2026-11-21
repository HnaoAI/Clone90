// Recette T43 « synchronisation Mac -> téléphone par le Wi-Fi », T51 « synchro par mot de passe » : vrai navigateur, vrai serveur de partage
// HTTPS (vrai certificat openssl), vraie bibliothèque IndexedDB et vrai service worker du téléphone. Montage autonome :
// - « Mac » : Clone90 avec l'API locale (createSettingsApi + sync-api, comme serve.mjs sur macOS), dossier roms/ et bios/ factices ;
// - « téléphone » : Clone90 sans roms/ ni API (comme GitHub Pages), Pixel 7.
// Le conteneur de test n'a pas d'adresse privée : le « Mac » est à 192.168.1.93 (puis 192.168.1.94), port 8443 ; Playwright relaie cette
// adresse vers le serveur de partage (127.0.0.1) avec l'autorité du Mac (comme le certificat installé sur le téléphone ; `ignoreHTTPSErrors` ne
// sert qu'au relais) ; les autres adresses du réseau local et les noms .local ne répondent pas (comme un Wi-Fi sans autre Mac).
// T51 : le téléphone ne saisit QUE le mot de passe et trouve le Mac en balayant le réseau ; un vrai Chromium sans l'autorité refuse le
// certificat et le Mac le signale.
// Usage : PLAYWRIGHT_PATH=... node tests/recette/synchro.mjs [dossier de captures]
import { cp, mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import https from 'node:https';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pw, verdict, results } from './lib.mjs';
import { PROJECT_ROOT } from '../../scripts/project-root.mjs';
import { createStaticServer } from '../../scripts/serve.mjs';
import { createSettingsApi } from '../../scripts/settings-api.mjs';
import { createSyncController } from '../../scripts/sync-api.mjs';
import { SYNC_CERT_DIR } from '../../scripts/sync-cert.mjs';

const captures = process.argv[2];
let LAN = '192.168.1.93';
const SYNC_PORT = 18443;
const PASSWORD = 'mot-de-passe-du-mac';
const shot = async (p, name) => { if (captures) await p.screenshot({ path: join(captures, `${name}.png`), fullPage: true }); };

async function appCopy(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets']) await cp(join(PROJECT_ROOT, f), join(root, f), { recursive: true });
  return root;
}
const macRoot = await appCopy('clone90-recette-mac-');
const phoneRoot = await appCopy('clone90-recette-tel-');
const COVER = await readFile(join(PROJECT_ROOT, 'assets/icons/icon-192.png'));
for (const d of ['roms/nes', 'roms/amiga/Leander', 'roms/clone90-logos', 'bios']) await mkdir(join(macRoot, d), { recursive: true });
await writeFile(join(macRoot, 'roms/nes/Mario.nes'), 'NES-MARIO');
await writeFile(join(macRoot, 'roms/nes/Mario.png'), COVER);
await writeFile(join(macRoot, 'roms/nes/Ancien.nes'), 'NES-ANCIEN');
await writeFile(join(macRoot, 'roms/amiga/Leander/Leander.adf'), 'ADF-LEANDER');
await writeFile(join(macRoot, 'roms/clone90-logos/nes.svg'), '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>');
await writeFile(join(macRoot, 'bios/neogeo.zip'), 'ZIP-NEOGEO');

// « Mac » : même branchement que serve.mjs (API des dossiers + commande du partage), sur 127.0.0.1.
let macPort = 0;
const sync = await createSyncController({ root: macRoot, enabled: true, getPort: () => macPort, syncPort: SYNC_PORT, getAddresses: () => [LAN], getHostname: () => 'Mac de Recette' });
const settingsApi = createSettingsApi({ root: macRoot, enabled: true, getPort: () => macPort, applyFolders: () => {}, chooseFolder: async () => null, regenerate: async () => ({ exitCode: 0 }) });
const api = { handle: (req, res) => (sync.owns((req.url ?? '').split('?')[0]) ? sync.handle(req, res) : settingsApi.handle(req, res)) };
const macServer = createStaticServer({ root: macRoot, api });
macPort = await new Promise((r) => macServer.listen(0, '127.0.0.1', () => r(macServer.address().port)));
const phoneServer = createStaticServer({ root: phoneRoot });
const phonePort = await new Promise((r) => phoneServer.listen(0, '127.0.0.1', () => r(phoneServer.address().port)));
const MAC = `http://localhost:${macPort}`;
const PHONE = `http://localhost:${phonePort}`;

const portOpen = (port) => new Promise((resolve) => {
  const s = net.connect(port, '127.0.0.1');
  s.on('connect', () => { s.destroy(); resolve(true); });
  s.on('error', () => resolve(false));
});

/** Relais Playwright : https://<LAN>:8443/... -> serveur de partage réel, vérifié avec l'autorité du Mac ; autres adresses privées et .local : rien. */
const isLocalTarget = (url) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) || url.hostname.endsWith('.local');
async function relayLan(context, log) {
  const ca = await readFile(join(macRoot, SYNC_CERT_DIR, 'ca.pem'), 'utf8');
  await context.route((url) => isLocalTarget(url), async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    if (url.host !== `${LAN}:8443`) { log.push(`ABSENT ${url.host}`); await route.abort('addressunreachable'); return; }
    log.push(`${req.method()} ${url.pathname}`);
    const body = req.postDataBuffer();
    const res = await new Promise((resolve) => {
      const r = https.request({ host: '127.0.0.1', port: SYNC_PORT, path: url.pathname + url.search, method: req.method(), headers: req.headers(), ca,
        checkServerIdentity: () => undefined }, (out) => { const chunks = []; out.on('data', (c) => chunks.push(c)); out.on('end', () => resolve({ status: out.statusCode, headers: out.headers, body: Buffer.concat(chunks) })); });
      r.on('error', () => resolve(null)); // Mac éteint ou partage arrêté : connexion refusée, comme sur le Wi-Fi
      r.end(body ?? undefined);
    });
    if (!res) { await route.abort('connectionrefused'); return; }
    await route.fulfill({ status: res.status, headers: Object.fromEntries(Object.entries(res.headers).map(([k, v]) => [k, String(v)])), body: res.body });
  });
}

/** Rouvre le panneau du partage du Mac (son état n'est lu qu'à l'ouverture). */
async function reopenSharePanel(mac) {
  await mac.getByRole('button', { name: 'Fermer' }).click();
  await mac.locator('[data-nav-id="folders"]').click();
  await mac.getByRole('button', { name: 'Partager avec le téléphone' }).click();
  await mac.getByText('Partage actif sur le Wi-Fi.').waitFor({ timeout: 5000 });
}

const storedKeys = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open('clone90-local', 1);
  req.onsuccess = () => { const all = req.result.transaction('files').objectStore('files').getAllKeys(); all.onsuccess = () => resolve(all.result.sort()); };
}));

const browser = await pw.chromium.launch();
try {
  // 1. Mac : rien d'ouvert avant le clic ; panneau « Partager avec le téléphone », activation, adresse, code.
  verdict('T43-ferme-avant-activation', !(await portOpen(SYNC_PORT)), `port ${SYNC_PORT}`);
  const macContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await macContext.route('https://**', (r) => r.abort());
  const mac = await macContext.newPage();
  await mac.goto(`${MAC}/index.html`);
  await mac.locator('[data-nav-id="folders"]').click();
  await mac.getByRole('button', { name: 'Partager avec le téléphone' }).click();
  await mac.getByText('rien n\'est ouvert au réseau').waitFor({ timeout: 5000 });
  verdict('T43-panneau-texte-securite', /lecture seule/.test(await mac.locator('#sync-info').textContent()), '');
  await mac.getByRole('button', { name: 'Activer le partage' }).click();
  await mac.getByText('Partage actif sur le Wi-Fi.').waitFor({ timeout: 30000 });
  verdict('T43-adresse-affichee', await mac.getByText(`https://${LAN}:${SYNC_PORT}`).count() > 0, '');
  verdict('T43-port-ouvert', await portOpen(SYNC_PORT), '');
  // T51 : mot de passe choisi une fois sur le Mac, jamais gardé en clair.
  verdict('T51-mac-sans-mot-de-passe', await mac.getByText('Aucun mot de passe').count() > 0, '');
  await mac.getByRole('button', { name: 'Choisir le mot de passe' }).click();
  await mac.getByText('Saisissez d\'abord le mot de passe').waitFor({ timeout: 5000 });
  await mac.locator('#sync-password').fill(PASSWORD);
  verdict('T51-champ-garde-le-focus', await mac.evaluate(() => document.activeElement?.id) === 'sync-password', '');
  await mac.getByRole('button', { name: 'Choisir le mot de passe' }).click();
  await mac.getByText('Mot de passe enregistré').waitFor({ timeout: 10000 });
  const state = await readFile(join(macRoot, 'clone90.sync.json'), 'utf8');
  verdict('T51-mot-de-passe-hache', !state.includes(PASSWORD) && /"hash": "[0-9a-f]{64}"/.test(state), '');
  verdict('T51-bouton-changer', await mac.getByRole('button', { name: 'Changer le mot de passe' }).count() === 1, '');
  await shot(mac, 'mac-1-partage');

  // T51 : un vrai Chromium SANS l'autorité du Mac (téléphone où le certificat n'est pas installé) : le Mac le signale.
  const noCa = await browser.newContext();
  const noCaPage = await noCa.newPage();
  const refusedByChrome = await noCaPage.goto(`https://127.0.0.1:${SYNC_PORT}/sync/hello`).then(() => false, (e) => /CERT|certificate/i.test(e.message));
  verdict('T51-chrome-refuse-sans-certificat', refusedByChrome, '');
  await noCa.close();
  await mac.waitForTimeout(300);
  await reopenSharePanel(mac);
  const warning = await mac.locator('.folders-status.is-error').allTextContents();
  verdict('T51-mac-signale-certificat-refuse', warning.some((t) => /127\.0\.0\.1\) a refusé le certificat/.test(t)), warning.join(' | '));
  await shot(mac, 'mac-2-certificat-refuse');

  // 2. Téléphone : mot de passe seulement (aucune adresse) : mauvais refusé, puis association et première synchronisation.
  const phoneContext = await browser.newContext({ ...pw.devices['Pixel 7'], ignoreHTTPSErrors: true });
  const outside = [];
  phoneContext.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== PHONE && !isLocalTarget(u)) outside.push(r.url()); });
  await phoneContext.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
  const lanLog = [];
  await relayLan(phoneContext, lanLog);
  const phone = await phoneContext.newPage();
  await phone.goto(`${PHONE}/index.html`);
  await phone.evaluate(() => navigator.serviceWorker.ready);
  await phone.goto(`${PHONE}/index.html#/fichiers`);
  verdict('T51-guide-certificat', await phone.getByText('Première fois : installer le certificat du Mac').count() === 1
    && await phone.locator('.sync-guide li').count() === 5, '');
  await shot(phone, 'telephone-0-mot-de-passe');
  await phone.locator('#sync-password').fill('pas-le-bon');
  await phone.getByRole('button', { name: 'Associer' }).click();
  await phone.locator('.library-notice').waitFor({ timeout: 60000 });
  const wrong = await phone.locator('.library-notice').textContent();
  verdict('T51-mauvais-mot-de-passe', /Mot de passe incorrect\. Encore 4 essais/.test(wrong), wrong);
  verdict('T51-trouve-par-balayage', lanLog.includes('GET /sync/hello') && lanLog.some((l) => l.startsWith('ABSENT 192.168.1.')), `${lanLog.length} demandes`);
  const t0 = Date.now();
  await phone.locator('#sync-password').fill(PASSWORD);
  verdict('T51-adresse-vide', (await phone.locator('#sync-address').inputValue()) === '', '');
  await phone.getByRole('button', { name: 'Associer' }).click();
  await phone.getByText('copiés depuis le Mac').waitFor({ timeout: 60000 });
  verdict('T51-duree-recherche', Date.now() - t0 < 30000, `${Date.now() - t0} ms`);
  const first = await phone.locator('.library-notice').textContent();
  verdict('T43-premiere-synchro', /6 fichiers copiés depuis le Mac/.test(first), first);
  const keys = await storedKeys(phone);
  const expected = ['bios/neogeo.zip', 'roms/amiga/Leander.adf', 'roms/clone90-logos/nes.svg', 'roms/nes/Ancien.nes', 'roms/nes/Mario.nes', 'roms/nes/Mario.png'];
  verdict('T43-fichiers-ranges', JSON.stringify(keys) === JSON.stringify(expected), keys.join(', '));
  verdict('T51-associe-nom-du-mac', await phone.getByText('mac-de-recette', { exact: true }).count() > 0, '');
  await shot(phone, 'telephone-1-mes-fichiers');

  // 3. Jeu servi par le service worker depuis le téléphone, tuile avec pochette.
  const served = await phone.evaluate(async () => (await fetch('roms/nes/Mario.nes')).text());
  verdict('T43-jeu-servi-hors-mac', served === 'NES-MARIO', served);
  await phone.goto(`${PHONE}/index.html#/nes`);
  await phone.locator('.game-tile').first().waitFor();
  await phone.waitForFunction(() => [...document.querySelectorAll('.game-cover img')].every((i) => i.complete));
  const mario = await phone.locator('.game-tile[aria-label="Mario"] .game-cover > img').evaluate((img) => img.naturalWidth > 0).catch(() => false);
  verdict('T43-pochette-tuile', mario, '');
  await shot(phone, 'telephone-2-grille-nes');

  // 4. Mac : un jeu ajouté, un jeu supprimé ; le téléphone rouvre Clone90 et se met à jour tout seul.
  await writeFile(join(macRoot, 'roms/nes/Zelda.nes'), 'NES-ZELDA');
  await rm(join(macRoot, 'roms/nes/Ancien.nes'));
  await phone.close();
  const reopened = await phoneContext.newPage();
  await reopened.addInitScript(() => { // messages temporaires notés (ils disparaissent au bout de quelques secondes)
    window.__toasts = [];
    new MutationObserver(() => { const t = document.getElementById('toast')?.textContent; if (t) window.__toasts.push(t); })
      .observe(document, { subtree: true, childList: true, characterData: true });
  });
  await reopened.goto(`${PHONE}/index.html`);
  await reopened.waitForFunction(() => window.__toasts.some((t) => /Synchronisation/.test(t)), null, { timeout: 15000 });
  const auto = await reopened.evaluate(() => window.__toasts.find((t) => /Synchronisation/.test(t)));
  verdict('T43-synchro-ouverture', /1 fichier copié depuis le Mac.*1 fichier retiré/.test(auto), auto);
  const keys2 = await storedKeys(reopened);
  verdict('T43-ajout-et-retrait', keys2.includes('roms/nes/Zelda.nes') && !keys2.includes('roms/nes/Ancien.nes'), keys2.join(', '));
  await shot(reopened, 'telephone-3-ouverture');

  // T51 : la box donne une autre adresse au Mac : « Synchroniser maintenant » le retrouve (balayage) et garde la nouvelle adresse.
  LAN = '192.168.1.94';
  await reopened.goto(`${PHONE}/index.html#/fichiers`);
  await reopened.getByRole('button', { name: 'Synchroniser maintenant' }).click();
  await reopened.locator('.library-notice').waitFor({ timeout: 60000 });
  const movedText = await reopened.locator('.library-notice').textContent();
  const savedUrl = await reopened.evaluate(() => JSON.parse(localStorage.getItem('clone90-sync')).url);
  verdict('T51-mac-retrouve-nouvelle-adresse', savedUrl === 'https://192.168.1.94:8443' && !/introuvable/.test(movedText), `${savedUrl} ; ${movedText}`);

  // 5. Mac éteint (partage arrêté) : le téléphone garde ses jeux, aucune erreur à l'ouverture.
  await mac.getByRole('button', { name: 'Arrêter le partage' }).click();
  await mac.getByText('rien n\'est ouvert au réseau').waitFor({ timeout: 5000 });
  verdict('T43-ferme-apres-arret', !(await portOpen(SYNC_PORT)), '');
  await reopened.close();
  const offline = await phoneContext.newPage();
  await offline.addInitScript(() => {
    window.__toasts = [];
    new MutationObserver(() => { const t = document.getElementById('toast')?.textContent; if (t) window.__toasts.push(t); })
      .observe(document, { subtree: true, childList: true, characterData: true });
  });
  const before = lanLog.length;
  await offline.goto(`${PHONE}/index.html`);
  await offline.waitForTimeout(8000);
  const offlineToasts = await offline.evaluate(() => window.__toasts.join(' | '));
  verdict('T43-mac-eteint-tente', lanLog.length > before, `${lanLog.length - before} demande(s) au Mac`);
  verdict('T43-mac-eteint-silencieux', !/Synchronisation|injoignable|introuvable/.test(offlineToasts), offlineToasts);
  verdict('T51-pas-de-balayage-a-ouverture', lanLog.slice(before).filter((l) => l.startsWith('ABSENT 192.168.')).length === 0, lanLog.slice(before).join(', '));
  verdict('T43-jeux-gardes', (await storedKeys(offline)).includes('roms/nes/Mario.nes'), '');

  // 6. Le téléphone n'a parlé qu'à son site et au Mac associé, en lecture.
  verdict('T43-rien-ailleurs', outside.filter((u) => !u.startsWith('https://cdn.emulatorjs.org/')).length === 0, outside.join(' '));
  verdict('T43-lectures-seulement', lanLog.every((l) => /^(GET|OPTIONS) \/sync\/(hello|manifest|file)$|^POST \/sync\/pair$|^OPTIONS \/sync\/pair$|^ABSENT /.test(l)), [...new Set(lanLog.filter((l) => !l.startsWith('ABSENT ')))].join(', '));
} finally {
  await browser.close();
  await sync.stop();
  macServer.close();
  phoneServer.close();
}
const failed = results.filter((r) => r.verdict !== 'PASSE');
console.log(`${results.length - failed.length}/${results.length} PASSE`);
process.exit(failed.length ? 1 : 0);
