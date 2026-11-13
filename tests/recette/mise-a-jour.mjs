// Recette T35 « mises à jour » : vrai navigateur, vraie API locale et vraie fenêtre, montage autonome (copie de l'application).
// La vérification et le pull sont simulés côté serveur (aucun réseau) : « appliquer » réécrit js/version.js de la copie, comme le ferait git pull.
// Usage : PLAYWRIGHT_PATH=... node tests/recette/mise-a-jour.mjs [dossier de captures]
import { cp, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pw, verdict, results } from './lib.mjs';
import { PROJECT_ROOT } from '../../scripts/project-root.mjs';
import { createStaticServer } from '../../scripts/serve.mjs';
import { createSettingsApi } from '../../scripts/settings-api.mjs';
import { APP_VERSION } from '../../js/version.js';

const captures = process.argv[2];
const NEXT = '9.99.0';
const root = await mkdtemp(join(tmpdir(), 'clone90-recette-maj-'));
for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets']) {
  await cp(join(PROJECT_ROOT, f), join(root, f), { recursive: true });
}
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const calls = { check: 0, apply: 0, restart: 0 };
let macServer;
const api = createSettingsApi({
  root, enabled: true, getPort: () => macServer.address().port, applyFolders: () => {}, chooseFolder: async () => null,
  regenerate: async () => ({ exitCode: 0 }),
  checkUpdate: async () => { calls.check += 1; return { status: 'available', current: APP_VERSION, latest: NEXT, canApply: true }; },
  runUpdate: async () => {
    calls.apply += 1;
    await new Promise((r) => setTimeout(r, 800));
    await writeFile(join(root, 'js', 'version.js'), `export const APP_VERSION = '${NEXT}';\nexport const APP_DATE = '2026-11-14';\nexport function formatVersionLabel(v = APP_VERSION, d = APP_DATE) { return \`Clone90 v\${v} - \${d}\`; }\n`);
    return { ok: true, version: NEXT };
  },
  restart: () => { calls.restart += 1; },
});
macServer = createStaticServer({ root, api });
const macPort = await listen(macServer);
const phoneServer = createStaticServer({ root: PROJECT_ROOT });
const phonePort = await listen(phoneServer);

const browser = await pw.chromium.launch();
const shot = async (p, name) => { if (captures) await p.screenshot({ path: join(captures, `${name}.png`) }); };
const dialog = (p) => p.locator('.dialog-backdrop');
try {
  // --- Mac : « Plus tard » d'abord (avant toute réécriture de version.js) ---
  const later = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await later.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
  await later.goto(`http://localhost:${macPort}/index.html`);
  await later.waitForTimeout(3000);
  verdict('T35-pas-avant-5s', (await dialog(later).count()) === 0, `vérifications : ${calls.check}`);
  await dialog(later).waitFor({ timeout: 5000 });
  const title = await later.locator('.dialog-title').textContent();
  verdict('T35-fenetre-titre', title === 'Mise à jour disponible', title);
  const message = await later.locator('#update-message').textContent();
  verdict('T35-fenetre-texte', message.includes(`v${NEXT}`) && message.includes(`v${APP_VERSION}`) && /ne sont pas touchés/.test(message), message);
  verdict('T35-compte-a-rebours', /commence dans [45] secondes/.test(await later.locator('.update-status').textContent()), await later.locator('.update-status').textContent());
  verdict('T35-focus-maintenant', await later.evaluate(() => document.activeElement?.textContent === 'Mettre à jour maintenant'));
  await shot(later, 'maj-1-fenetre');
  await later.getByRole('button', { name: 'Plus tard' }).click();
  await later.waitForTimeout(6000);
  verdict('T35-plus-tard', (await dialog(later).count()) === 0 && calls.apply === 0, `apply : ${calls.apply}`);
  await later.goto(`http://localhost:${macPort}/index.html`);
  await later.waitForTimeout(6500);
  verdict('T35-meme-onglet-pas-de-nouvelle-verif', (await dialog(later).count()) === 0 && calls.check === 1, `vérifications : ${calls.check}`);

  // --- Mac : compte à rebours jusqu'au bout, mise à jour, rechargement sur la nouvelle version ---
  const mac = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await mac.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
  await mac.goto(`http://localhost:${macPort}/index.html`);
  await dialog(mac).waitFor({ timeout: 8000 });
  await mac.keyboard.press('Escape').catch(() => {});
  await mac.waitForTimeout(100);
  const escaped = (await dialog(mac).count()) === 0;
  if (escaped) verdict('T35-retour-plus-tard', true, 'Échap = Plus tard');
  const auto = escaped ? await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage() : mac;
  if (escaped) { await auto.route('https://cdn.emulatorjs.org/**', (r) => r.abort()); await auto.goto(`http://localhost:${macPort}/index.html`); await dialog(auto).waitFor({ timeout: 8000 }); }
  await auto.locator('.update-status', { hasText: 'Mise à jour en cours' }).waitFor({ timeout: 7000 });
  verdict('T35-demarre-seule', calls.apply === 1, `apply : ${calls.apply}`);
  verdict('T35-boutons-caches', (await auto.locator('.dialog-button:visible').count()) === 0);
  await auto.keyboard.press('Escape');
  await auto.mouse.click(5, 5);
  verdict('T35-pas-de-fermeture-pendant', (await dialog(auto).count()) === 1);
  await shot(auto, 'maj-2-en-cours');
  await auto.waitForEvent('load', { timeout: 15000 });
  await auto.waitForTimeout(500);
  const footer = await auto.locator('body').textContent();
  verdict('T35-recharge-nouvelle-version', footer.includes(`v${NEXT}`), footer.match(/Clone90 v[\d.]+/)?.[0]);
  verdict('T35-relance-serveur', calls.restart === 1, `relances : ${calls.restart}`);
  await shot(auto, 'maj-3-apres');

  // --- Téléphone / site (sans API) : version du site plus récente : même fenêtre, la page se recharge ---
  const phoneContext = await browser.newContext({ viewport: { width: 412, height: 915 }, hasTouch: true, isMobile: true });
  const phone = await phoneContext.newPage();
  await phone.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
  await phoneContext.route(/js\/version\.js\?t=/, (r) => r.fulfill({ contentType: 'text/javascript', body: `export const APP_VERSION = '${NEXT}';` }));
  await phone.goto(`http://localhost:${phonePort}/index.html`);
  await dialog(phone).waitFor({ timeout: 8000 });
  verdict('T35-telephone-texte', /La page se recharge dans/.test(await phone.locator('.update-status').textContent()), await phone.locator('.update-status').textContent());
  const box = await phone.locator('.dialog-box').boundingBox();
  verdict('T35-telephone-dans-ecran', box && box.x >= 0 && box.x + box.width <= 412, JSON.stringify(box));
  await shot(phone, 'maj-4-telephone');
  await phone.waitForEvent('load', { timeout: 10000 });
  await phone.waitForTimeout(6500);
  verdict('T35-telephone-recharge-une-fois', (await dialog(phone).count()) === 0);
} finally {
  await browser.close();
  macServer.close();
  phoneServer.close();
}
const failed = results.filter((r) => r.verdict !== 'PASSE');
console.log(`${results.length - failed.length}/${results.length} vérifications passées`);
process.exitCode = failed.length ? 1 : 0;
