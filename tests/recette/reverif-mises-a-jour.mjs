// Recette T47 « revérifier les mises à jour après 5 h » : vrai navigateur, vraie API locale du Mac, horloge simulée (page.clock de Playwright).
// La vérification est simulée côté serveur (aucun réseau) et comptée. La visibilité de l'onglet est simulée (document.hidden piloté par window.__setHidden).
// Usage : PLAYWRIGHT_PATH=... node tests/recette/reverif-mises-a-jour.mjs [dossier de captures]
import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pw, verdict, results } from './lib.mjs';
import { PROJECT_ROOT } from '../../scripts/project-root.mjs';
import { createStaticServer } from '../../scripts/serve.mjs';
import { createSettingsApi } from '../../scripts/settings-api.mjs';
import { APP_VERSION } from '../../js/version.js';

const captures = process.argv[2];
const NEXT = '9.99.0';
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const root = await mkdtemp(join(tmpdir(), 'clone90-recette-reverif-'));
for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets']) {
  await cp(join(PROJECT_ROOT, f), join(root, f), { recursive: true });
}
const listen = (server) => new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
let checks = 0;
let offer = false; // true : la prochaine vérification trouve une mise à jour
let macServer;
const api = createSettingsApi({
  root, enabled: true, getPort: () => macServer.address().port, applyFolders: () => {}, chooseFolder: async () => null,
  regenerate: async () => ({ exitCode: 0 }),
  checkUpdate: async () => {
    checks += 1;
    return offer ? { status: 'available', current: APP_VERSION, latest: NEXT, canApply: true } : { status: 'uptodate', current: APP_VERSION };
  },
  runUpdate: async () => { throw new Error('la recette ne met jamais à jour'); },
  restart: () => {},
});
macServer = createStaticServer({ root, api });
const port = await listen(macServer);
const url = (page) => `http://localhost:${port}/${page}`;

/** Onglet caché ou visible, comme quand on passe à une autre application puis qu'on revient. */
const HIDDEN_INIT = () => {
  let hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  window.__setHidden = (h) => { hidden = h; document.dispatchEvent(new Event('visibilitychange')); };
};

const browser = await pw.chromium.launch();
const shot = async (p, name) => { if (captures) await p.screenshot({ path: join(captures, `${name}.png`) }); };
try {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addInitScript(HIDDEN_INIT);
  const page = await context.newPage();
  await page.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
  await page.clock.install({ time: new Date('2026-11-21T08:00:00') });
  const dialog = page.locator('.dialog-backdrop');
  /** Avance l'horloge de la page (saut direct pour les heures, minuteries une à une pour les secondes), puis laisse la vraie requête à l'API locale aboutir. */
  const advance = async (ms) => {
    if (ms > MIN) await page.clock.fastForward(ms); else await page.clock.runFor(ms);
    await page.waitForTimeout(400);
  };
  const hide = () => page.evaluate(() => window.__setHidden(true));
  const show = () => page.evaluate(() => window.__setHidden(false));

  await page.goto(url('index.html'));
  await page.locator('body.has-dock').waitFor({ state: 'attached' });
  await advance(5500);
  verdict('T47-ouverture-une-verification', checks === 1, `vérifications : ${checks}`);

  await hide();
  await advance(4 * HOUR + 59 * MIN);
  await show();
  await advance(6000);
  verdict('T47-retour-avant-5h-pas-de-verif', checks === 1, `vérifications : ${checks} (4 h 59 après)`);

  await hide();
  await advance(2 * MIN); // 5 h 01 depuis la vérification
  verdict('T47-onglet-cache-pas-de-verif', checks === 1, `vérifications : ${checks}`);
  offer = true;
  await show();
  await advance(3000);
  verdict('T47-retour-apres-5h-attend-5s', checks === 1 && (await dialog.count()) === 0, `vérifications : ${checks}`);
  await advance(2500);
  verdict('T47-retour-apres-5h-verifie', checks === 2, `vérifications : ${checks}`);
  await dialog.waitFor({ timeout: 3000 });
  const status = await page.locator('.update-status').textContent();
  verdict('T47-meme-fenetre-compte-a-rebours', /commence dans [45] secondes/.test(status), status);
  verdict('T47-meme-fenetre-plus-tard', (await page.getByRole('button', { name: 'Plus tard' }).count()) === 1);
  await shot(page, 'reverif-1-fenetre');
  await page.getByRole('button', { name: 'Plus tard' }).click();
  await advance(6000);
  verdict('T47-plus-tard-ferme', (await dialog.count()) === 0);
  offer = false;

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await advance(6000);
  verdict('T47-plus-tard-pas-de-reproposition-avant-5h', checks === 2, `vérifications : ${checks}`);

  await advance(5 * HOUR);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await advance(6000);
  verdict('T47-retour-focus-apres-5h', checks === 3, `vérifications : ${checks}`);

  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await show();
  await advance(6000);
  verdict('T47-pas-de-double-verification', checks === 3, `vérifications : ${checks}`);

  // Onglet quitté pendant les 5 s d'attente : pas de vérification, elle se fait au retour.
  await advance(5 * HOUR);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await advance(2000);
  await hide();
  await advance(6000);
  verdict('T47-quitte-pendant-attente-pas-de-verif', checks === 3, `vérifications : ${checks}`);
  await show();
  await advance(5500);
  verdict('T47-quitte-pendant-attente-verifie-au-retour', checks === 4, `vérifications : ${checks}`);

  // Partie en cours : player.html ne vérifie jamais, même après 5 h ; le retour à l'accueil vérifie si c'est dû.
  await page.goto(url('player.html?system=nes&game=absent'));
  await page.waitForTimeout(500);
  await advance(6 * HOUR);
  await hide();
  await show();
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await advance(6000);
  verdict('T47-jamais-pendant-une-partie', checks === 4 && (await dialog.count()) === 0, `vérifications : ${checks}`);
  await page.goto(url('index.html'));
  await page.locator('body.has-dock').waitFor({ state: 'attached' });
  await advance(5500);
  verdict('T47-retour-accueil-apres-5h-verifie', checks === 5, `vérifications : ${checks}`);

  await page.goto(url('player.html?system=nes&game=absent'));
  await advance(HOUR);
  await page.goto(url('index.html'));
  await page.locator('body.has-dock').waitFor({ state: 'attached' });
  await advance(6000);
  verdict('T47-retour-accueil-avant-5h-pas-de-verif', checks === 5, `vérifications : ${checks}`);

  // Nouvel onglet : vérification à l'ouverture, comme T35.
  const other = await context.newPage();
  await other.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
  await other.goto(url('index.html'));
  await other.locator('body.has-dock').waitFor({ state: 'attached' });
  await other.clock.runFor(5500);
  await other.waitForTimeout(400);
  verdict('T47-nouvel-onglet-verifie', checks === 6, `vérifications : ${checks}`);
} finally {
  await browser.close();
  macServer.close();
}
const failed = results.filter((r) => r.verdict !== 'PASSE');
console.log(`${results.length - failed.length}/${results.length} vérifications passées`);
process.exitCode = failed.length ? 1 : 0;
