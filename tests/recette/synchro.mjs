// Recette T43 « synchronisation Mac -> téléphone par le Wi-Fi » : vrai navigateur, vrai serveur de partage HTTPS (vrai certificat openssl),
// vraie bibliothèque IndexedDB et vrai service worker du téléphone. Montage autonome :
// - « Mac » : Clone90 avec l'API locale (createSettingsApi + sync-api, comme serve.mjs sur macOS), dossier roms/ et bios/ factices ;
// - « téléphone » : Clone90 sans roms/ ni API (comme GitHub Pages), Pixel 7.
// Le conteneur de test n'a pas d'adresse privée : le téléphone saisit 192.168.50.10, et Playwright relaie cette adresse vers le serveur de
// partage (127.0.0.1) avec l'autorité du Mac (comme le certificat installé sur le téléphone ; `ignoreHTTPSErrors` ne sert qu'au relais).
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
const LAN = '192.168.50.10';
const SYNC_PORT = 18443;
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
const sync = await createSyncController({ root: macRoot, enabled: true, getPort: () => macPort, syncPort: SYNC_PORT, getAddresses: () => [LAN] });
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

/** Relais Playwright : https://192.168.50.10:18443/... -> serveur de partage réel, vérifié avec l'autorité du Mac. */
async function relayLan(context, log) {
  const ca = await readFile(join(macRoot, SYNC_CERT_DIR, 'ca.pem'), 'utf8');
  await context.route(`https://${LAN}:${SYNC_PORT}/**`, async (route) => {
    const req = route.request();
    const url = new URL(req.url());
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
  await mac.getByRole('button', { name: 'Associer un téléphone' }).click();
  await mac.locator('.sync-code').waitFor();
  const code = (await mac.locator('.sync-code').textContent()).trim();
  verdict('T43-code-6-chiffres', /^\d{6}$/.test(code), code);
  await shot(mac, 'mac-1-partage');

  // 2. Téléphone : mauvais code refusé, puis association et première synchronisation.
  const phoneContext = await browser.newContext({ ...pw.devices['Pixel 7'], ignoreHTTPSErrors: true });
  const outside = [];
  phoneContext.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== PHONE && u.host !== `${LAN}:${SYNC_PORT}`) outside.push(r.url()); });
  await phoneContext.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
  const lanLog = [];
  await relayLan(phoneContext, lanLog);
  const phone = await phoneContext.newPage();
  await phone.goto(`${PHONE}/index.html`);
  await phone.evaluate(() => navigator.serviceWorker.ready);
  await phone.goto(`${PHONE}/index.html#/fichiers`);
  await phone.locator('#sync-address').fill(LAN + `:${SYNC_PORT}`);
  await phone.locator('#sync-code').fill(code === '000000' ? '111111' : '000000');
  await phone.getByRole('button', { name: 'Associer' }).click();
  await phone.locator('.library-notice').waitFor({ timeout: 10000 });
  const wrong = await phone.locator('.library-notice').textContent();
  verdict('T43-mauvais-code', /Code incorrect/.test(wrong), wrong);
  await mac.getByRole('button', { name: 'Associer un téléphone' }).click(); // nouveau code (le précédent compte un essai raté)
  await mac.waitForTimeout(300);
  const code2 = (await mac.locator('.sync-code').textContent()).trim();
  await phone.locator('#sync-address').fill(LAN + `:${SYNC_PORT}`);
  await phone.locator('#sync-code').fill(code2);
  await phone.getByRole('button', { name: 'Associer' }).click();
  await phone.getByText('copiés depuis le Mac').waitFor({ timeout: 20000 });
  const first = await phone.locator('.library-notice').textContent();
  verdict('T43-premiere-synchro', /6 fichiers copiés depuis le Mac/.test(first), first);
  const keys = await storedKeys(phone);
  const expected = ['bios/neogeo.zip', 'roms/amiga/Leander.adf', 'roms/clone90-logos/nes.svg', 'roms/nes/Ancien.nes', 'roms/nes/Mario.nes', 'roms/nes/Mario.png'];
  verdict('T43-fichiers-ranges', JSON.stringify(keys) === JSON.stringify(expected), keys.join(', '));
  verdict('T43-associe-affiche', await phone.getByText(`https://${LAN}:${SYNC_PORT}`).count() > 0, '');
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
  verdict('T43-mac-eteint-silencieux', !/Synchronisation|injoignable/.test(offlineToasts), offlineToasts);
  verdict('T43-jeux-gardes', (await storedKeys(offline)).includes('roms/nes/Mario.nes'), '');

  // 6. Le téléphone n'a parlé qu'à son site et au Mac associé, en lecture.
  verdict('T43-rien-ailleurs', outside.filter((u) => !u.startsWith('https://cdn.emulatorjs.org/')).length === 0, outside.join(' '));
  verdict('T43-lectures-seulement', lanLog.every((l) => /^(GET|OPTIONS) \/sync\/(manifest|file)$|^POST \/sync\/pair$|^OPTIONS \/sync\/pair$/.test(l)), [...new Set(lanLog)].join(', '));
} finally {
  await browser.close();
  await sync.stop();
  macServer.close();
  phoneServer.close();
}
const failed = results.filter((r) => r.verdict !== 'PASSE');
console.log(`${results.length - failed.length}/${results.length} PASSE`);
process.exit(failed.length ? 1 : 0);
