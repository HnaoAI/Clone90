// Recette T44 « envoyer les jeux du téléphone vers le Mac » : vrai navigateur, vrai serveur de partage HTTPS (vrai certificat openssl),
// vraie bibliothèque IndexedDB du téléphone, vrai générateur de games.json sur le Mac. Même montage que tests/recette/synchro.mjs (T43) :
// « Mac » avec l'API locale, « téléphone » Pixel 7 sans API, adresse 192.168.50.10 relayée par Playwright vers 127.0.0.1.
// T51 : mot de passe choisi sur le Mac ; le téléphone saisit ici aussi l'adresse (champ de secours), la recherche seule est dans synchro.mjs.
// Usage : PLAYWRIGHT_PATH=... node tests/recette/envoi-mac.mjs [dossier de captures]
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
const SYNC_PORT = 18444;
const shot = async (p, name) => { if (captures) await p.screenshot({ path: join(captures, `${name}.png`), fullPage: true }); };

async function appCopy(prefix) {
  const root = await mkdtemp(join(tmpdir(), prefix));
  for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets']) await cp(join(PROJECT_ROOT, f), join(root, f), { recursive: true });
  return root;
}
const macRoot = await appCopy('clone90-recette-mac-');
const phoneRoot = await appCopy('clone90-recette-tel-');
const COVER = await readFile(join(PROJECT_ROOT, 'assets/icons/icon-192.png'));
for (const d of ['roms/nes', 'bios']) await mkdir(join(macRoot, d), { recursive: true });
await writeFile(join(macRoot, 'roms/nes/Mario.nes'), 'NES-MARIO');
await writeFile(join(macRoot, 'roms/nes/Doublon.nes'), 'NES-DOUBLON-MAC');

// « Mac » : même branchement que serve.mjs (API des dossiers + commande du partage), sur 127.0.0.1.
let macPort = 0;
const sync = await createSyncController({ root: macRoot, enabled: true, getPort: () => macPort, syncPort: SYNC_PORT, getAddresses: () => [LAN] }); // vrai générateur de games.json
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


/** Ajoute des fichiers « mis par la personne » dans la bibliothèque du téléphone (comme « Mes fichiers »). */
const putLocal = (page, files) => page.evaluate((list) => new Promise((resolve) => {
  const req = indexedDB.open('clone90-local', 1);
  req.onsuccess = () => {
    const tx = req.result.transaction('files', 'readwrite');
    for (const [path, data] of list) { const blob = new Blob([typeof data === 'string' ? data : new Uint8Array(data)]); tx.objectStore('files').put({ path, blob, size: blob.size, addedAt: Date.now() }); }
    tx.oncomplete = () => resolve();
  };
}), files);
const exists = (p) => readFile(join(macRoot, p), 'utf8').then((t) => t, () => null);
const watchToasts = (page) => page.addInitScript(() => {
  window.__toasts = [];
  new MutationObserver(() => { const t = document.getElementById('toast')?.textContent; if (t) window.__toasts.push(t); })
    .observe(document, { subtree: true, childList: true, characterData: true });
});

const browser = await pw.chromium.launch();
try {
  // 1. Mac : partage activé, réception des jeux ÉTEINTE par défaut, mot de passe (T51).
  const macContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await macContext.route('https://**', (r) => r.abort());
  const mac = await macContext.newPage();
  await mac.goto(`${MAC}/index.html`);
  await mac.locator('[data-nav-id="folders"]').click();
  await mac.getByRole('button', { name: 'Partager avec le téléphone' }).click();
  await mac.getByRole('button', { name: 'Activer le partage' }).click();
  await mac.getByText('Partage actif sur le Wi-Fi.').waitFor({ timeout: 30000 });
  verdict('T44-reception-eteinte-par-defaut', await mac.getByText('Ce Mac n\'accepte pas les jeux des téléphones.').count() === 1
    && await mac.getByRole('button', { name: 'Accepter les jeux du téléphone' }).count() === 1, '');
  verdict('T44-texte-securite', /AJOUTER ses jeux et pochettes.*sans jamais remplacer/.test(await mac.locator('#sync-info').textContent()), '');
  await mac.locator('#sync-password').fill('mot-de-passe-du-mac');
  // T52 : œil à côté du mot de passe, masqué par défaut.
  const macEye = mac.getByRole('button', { name: 'Afficher le mot de passe' });
  const macHidden = await mac.locator('#sync-password').getAttribute('type') === 'password';
  await macEye.click();
  const macShown = await mac.locator('#sync-password').getAttribute('type') === 'text';
  await mac.getByRole('button', { name: 'Masquer le mot de passe' }).click();
  verdict('T52-oeil-mac', macHidden && macShown && await mac.locator('#sync-password').getAttribute('type') === 'password', '');
  await mac.getByRole('button', { name: 'Choisir le mot de passe' }).click();
  await mac.getByText('Mot de passe enregistré').waitFor({ timeout: 10000 });

  // 2. Téléphone : association (copie du Mac), puis fichiers mis à la main : un jeu nouveau et sa pochette, un doublon de nom, un BIOS.
  const phoneContext = await browser.newContext({ ...pw.devices['Pixel 7'], ignoreHTTPSErrors: true });
  const outside = [];
  phoneContext.on('request', (r) => { const u = new URL(r.url()); if (u.origin !== PHONE && u.host !== `${LAN}:${SYNC_PORT}`) outside.push(r.url()); });
  await phoneContext.route('https://**', (r) => (new URL(r.request().url()).host === `${LAN}:${SYNC_PORT}` ? r.fallback() : r.abort()));
  const lanLog = [];
  await relayLan(phoneContext, lanLog);
  const phone = await phoneContext.newPage();
  await phone.goto(`${PHONE}/index.html`);
  await phone.evaluate(() => navigator.serviceWorker.ready);
  await phone.goto(`${PHONE}/index.html#/fichiers`);
  await phone.locator('#sync-address').waitFor();
  await putLocal(phone, [['roms/nes/Perso.nes', 'NES-PERSO-TEL'], ['roms/nes/Doublon.nes', 'NES-DOUBLON-TEL'], ['roms/nes/Perso.png', [...COVER]], ['bios/tel.bin', 'BIOS-TEL']]);
  await phone.locator('#sync-address').fill(`${LAN}:${SYNC_PORT}`);
  await phone.locator('#sync-password').fill('mot-de-passe-du-mac');
  const phoneHidden = await phone.locator('#sync-password').getAttribute('type') === 'password';
  await phone.getByRole('button', { name: 'Afficher le mot de passe' }).click();
  verdict('T52-oeil-telephone', phoneHidden && await phone.locator('#sync-password').getAttribute('type') === 'text', '');
  await phone.getByRole('button', { name: 'Associer' }).click();
  await phone.getByText('copié depuis le Mac').waitFor({ timeout: 20000 });
  const send = phone.getByRole('button', { name: 'Envoyer mes jeux au Mac' });
  verdict('T44-bouton-apres-association', await send.count() === 1, '');

  // 3. Envoi alors que le Mac n'accepte pas : rien n'arrive, message qui dit quoi cocher.
  await send.click();
  await phone.getByText('n\'accepte pas encore les jeux').waitFor({ timeout: 10000 });
  verdict('T44-refus-si-eteint', await exists('roms/nes/Perso.nes') === null, '');
  verdict('T44-aucun-envoi-si-eteint', !lanLog.includes('POST /sync/upload'), [...new Set(lanLog)].join(', '));

  // 4. Mac : « Accepter les jeux du téléphone ».
  await mac.getByRole('button', { name: 'Accepter les jeux du téléphone' }).click();
  await mac.getByRole('button', { name: 'Ne plus accepter les jeux du téléphone' }).waitFor({ timeout: 5000 });
  verdict('T44-reception-allumee', await mac.getByText(/Ce Mac accepte les jeux et pochettes envoyés/).count() === 1, '');
  await shot(mac, 'mac-1-accepter');

  // 5. Téléphone : envoi ; le jeu nouveau puis sa pochette partent, le doublon de nom est signalé, pas le BIOS.
  await phone.getByRole('button', { name: 'Envoyer mes jeux au Mac' }).click();
  await phone.getByText(/jeu envoyé au Mac/).waitFor({ timeout: 15000 });
  const result = await phone.locator('.library-notice').textContent();
  verdict('T44-message-envoi', /1 jeu envoyé au Mac ; 1 pochette envoyée au Mac ; 1 jeu non envoyé : un fichier du même nom est déjà sur le Mac/.test(result), result);
  verdict('T44-jeu-sur-le-mac', await exists('roms/nes/Perso.nes') === 'NES-PERSO-TEL', '');
  verdict('T44-jamais-ecrase', await exists('roms/nes/Doublon.nes') === 'NES-DOUBLON-MAC', '');
  verdict('T44-pochette-sur-le-mac', (await readFile(join(macRoot, 'roms/nes/Perso.png')).catch(() => Buffer.alloc(0))).equals(COVER), '');
  verdict('T44-pas-de-bios', await exists('bios/tel.bin') === null, '');
  await shot(phone, 'telephone-1-envoi');

  // 6. Mac : le jeu reçu apparaît dans Clone90 avec sa pochette (liste des jeux refaite).
  await mac.waitForTimeout(1000);
  await mac.goto(`${MAC}/index.html#/nes`);
  await mac.reload(); // la liste des jeux est lue au chargement de la page
  await mac.locator('.game-tile').first().waitFor();
  verdict('T44-jeu-visible-sur-mac', await mac.locator('.game-tile[aria-label="Perso"]').count() === 1, '');
  await mac.waitForFunction(() => [...document.querySelectorAll('.game-cover img')].every((i) => i.complete));
  const cover = await mac.locator('.game-tile[aria-label="Perso"] .game-cover > img').evaluate((img) => img.naturalWidth > 0).catch(() => false);
  verdict('T44-pochette-visible-sur-mac', cover, '');
  await shot(mac, 'mac-2-grille-nes');

  // 7. Mac : le jeu est supprimé ; le téléphone le retire à l'ouverture suivante (il suit le Mac).
  await rm(join(macRoot, 'roms/nes/Perso.nes'));
  await phone.close();
  const reopened = await phoneContext.newPage();
  await watchToasts(reopened);
  await reopened.goto(`${PHONE}/index.html`);
  await reopened.waitForFunction(() => window.__toasts.some((t) => /Synchronisation/.test(t)), null, { timeout: 15000 });
  const auto = await reopened.evaluate(() => window.__toasts.find((t) => /Synchronisation/.test(t)));
  verdict('T44-suit-le-mac', /1 fichier retiré/.test(auto) && !(await storedKeys(reopened)).includes('roms/nes/Perso.nes'), auto);
  verdict('T44-garde-les-siens', (await storedKeys(reopened)).includes('roms/nes/Doublon.nes'), '');

  // 8. Le téléphone n'a parlé qu'à son site et au Mac associé ; envoi seulement au clic.
  verdict('T44-rien-ailleurs', outside.length === 0, outside.join(' '));
  verdict('T44-envois-au-clic', lanLog.filter((l) => l === 'POST /sync/upload').length === 2, lanLog.filter((l) => l.includes('upload')).join(', '));

  // 9. T52 : un jeu Neo Geo de 3 Mo et le BIOS neogeo.zip rangé avec les jeux : avancement en Mo affiché, BIOS jamais envoyé.
  await putLocal(reopened, [['roms/neogeo/bstars.zip', [...Buffer.alloc(3 * 1024 * 1024, 7)]], ['roms/neogeo/neogeo.zip', 'BIOS-NEOGEO']]);
  await reopened.goto(`${PHONE}/index.html#/fichiers`);
  await reopened.evaluate(() => {
    window.__busy = [];
    new MutationObserver(() => { for (const n of document.querySelectorAll('body *')) { const t = n.textContent; if (/^Envoi au Mac : \d/.test(t ?? '') && n.children.length === 0) window.__busy.push(t); } })
      .observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await reopened.getByRole('button', { name: 'Envoyer mes jeux au Mac' }).click();
  await reopened.getByText(/jeu envoyé au Mac/).waitFor({ timeout: 20000 });
  const seen = await reopened.evaluate(() => window.__busy);
  verdict('T52-progression-mo', seen.some((t) => /bstars\.zip, [\d,]+ (Ko|Mo) sur 3,0 Mo.*Gardez Clone90 ouvert/.test(t)), seen.slice(0, 3).join(' | '));
  verdict('T52-jeu-recu', (await readFile(join(macRoot, 'roms/neogeo/bstars.zip')).catch(() => Buffer.alloc(0))).length === 3 * 1024 * 1024, '');
  verdict('T52-bios-pas-envoye', await exists('roms/neogeo/neogeo.zip') === null, '');
  await shot(reopened, 'telephone-2-envoi-fini');
} finally {
  await browser.close();
  await sync.stop();
  macServer.close();
  phoneServer.close();
}
const failed = results.filter((r) => r.verdict !== 'PASSE');
console.log(`${results.length - failed.length}/${results.length} PASSE`);
process.exit(failed.length ? 1 : 0);
