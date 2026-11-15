// Recette T41 « style Y2K et barre du bas » : vrai navigateur, téléphone (Pixel 7) et ordinateur, sur une copie de l'application avec un
// games.json généré depuis des fichiers factices (on regarde l'affichage, pas l'émulation). Mode Mac simulé : api/settings répond
// (onglet « Dossiers »). Vérifie la barre (onglets, onglet actif, cibles, contenu jamais caché dessous), le clavier, la page de jeu sans
// barre, la réduction des animations, et prend les captures. T45 : numéro de version sous « Clone90 » sur le téléphone, caché sur ordinateur.
// Usage : PLAYWRIGHT_PATH=... node tests/recette/style-y2k.mjs [dossier de captures]
import { cp, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pw, verdict, results } from './lib.mjs';
import { contrastScan } from './page-fns.mjs';
import { PROJECT_ROOT } from '../../scripts/project-root.mjs';
import { createStaticServer } from '../../scripts/serve.mjs';
import { runGenerate } from '../../scripts/generate-games.mjs';

const captures = process.argv[2];
const root = await mkdtemp(join(tmpdir(), 'clone90-recette-y2k-'));
for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets', 'scripts']) {
  await cp(join(PROJECT_ROOT, f), join(root, f), { recursive: true });
}
// Jeux factices : 7 machines avec des jeux (4 couleurs de bulles et leur retour), les autres à 0 jeu.
const roms = { neogeo: 12, amiga: 8, arcade: 24, megadrive: 5, nes: 3, snes: 2, gameboy: 1 };
const ext = { neogeo: 'zip', amiga: 'adf', arcade: 'zip', megadrive: 'md', nes: 'nes', snes: 'sfc', gameboy: 'gb' };
for (const [machine, n] of Object.entries(roms)) {
  await mkdir(join(root, 'roms', machine), { recursive: true });
  for (let i = 1; i <= n; i += 1) await writeFile(join(root, 'roms', machine, `Jeu ${String(i).padStart(2, '0')}.${ext[machine]}`), 'X');
}
await mkdir(join(root, 'bios'), { recursive: true });
await runGenerate({ root, log: () => {} });

/**
 * T45 : numéro de version sous « Clone90 ». Téléphone : visible, juste sous le titre, dans l'en-tête, lisible (AA, y compris sur la bande
 * la plus sombre du chrome, --chrome-lo, sous la pastille) ; ordinateur : caché (le numéro reste en bas de l'accueil).
 */
async function checkHeaderVersion(page, label, where) {
  const m = await page.evaluate(() => {
    const v = document.querySelector('.site-version'); const t = document.querySelector('.site-title'); const h = document.querySelector('.app-header');
    const [rv, rt, rh] = [v, t, h].map((e) => e.getBoundingClientRect());
    return { text: v.textContent, shown: getComputedStyle(v).display !== 'none' && rv.height > 0, below: rv.top >= rt.bottom - 1 && rv.top - rt.bottom < 12,
      left: Math.abs(rv.left - rt.left) < 2, inside: rv.top >= rh.top && rv.bottom <= rh.bottom && rv.right <= rh.right, top: rv.top };
  });
  if (label === 'ordinateur') { verdict(`T45-CA3-cache-sur-ordinateur-${where}`, !m.shown, JSON.stringify(m), label); return; }
  verdict(`T45-CA1-visible-${where}`, m.shown && /^v0\.\d+\.\d+ - \d{2}\/\d{2}\/\d{4}$/.test(m.text) && m.top < 100, JSON.stringify(m), label);
  verdict(`T45-CA1-sous-le-titre-${where}`, m.below && m.left, JSON.stringify(m), label);
  verdict(`T45-CA2-dans-l-en-tete-${where}`, m.inside, JSON.stringify(m), label);
  const low = (await page.evaluate(contrastScan)).filter((x) => /site-version/.test(x.el));
  // Pire cas : pastille blanche à 60 % posée sur --chrome-lo (#6d7a8c), texte --ink (#16133a).
  const worst = await page.evaluate(() => {
    const lum = (r, g, b) => [r, g, b].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [0.2126, 0.7152, 0.0722][i], 0);
    const mix = (c, w) => c * 0.4 + 255 * 0.6;
    const bg = lum(mix(0x6d), mix(0x7a), mix(0x8c)); const fg = lum(0x16, 0x13, 0x3a);
    return (bg + 0.05) / (fg + 0.05);
  });
  verdict(`T45-CA2-lisible-${where}`, low.length === 0 && worst >= 4.5, `${JSON.stringify(low)} pire ${worst.toFixed(2)}`, label);
}

const server = createStaticServer({ root });
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://localhost:${port}`;
const browser = await pw.chromium.launch();
const shot = async (p, name, fullPage = false) => { if (captures) await p.screenshot({ path: join(captures, `${name}.png`), fullPage }); };
const SETTINGS = { romsDir: '/Users/moi/Jeux/ROMs', biosDir: '/projet/bios', romsIsDefault: false, biosIsDefault: true };

/** Contexte de navigateur ; `mac` : l'API locale répond (onglet « Dossiers »), sinon elle est absente comme sur GitHub Pages. */
async function newPage(options, { mac = false, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ ...options, reducedMotion });
  await context.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
  await context.route('**/api/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (mac && path.endsWith('/api/settings')) return r.fulfill({ json: SETTINGS });
    return r.fulfill({ status: 404, body: 'Introuvable' });
  });
  return { context, page: await context.newPage() };
}
const currentTab = (page) => page.evaluate(() => [...document.querySelectorAll('.dock [aria-current="page"]')].map((t) => t.dataset.navId));
const waitHash = async (page, re) => { await page.waitForFunction((src) => new RegExp(src).test(location.hash), re.source); await page.waitForTimeout(250); };
const tabIds = (page) => page.evaluate(() => [...document.querySelectorAll('.dock-tab')].map((t) => t.dataset.navId));

try {
  for (const [label, options] of [['telephone', { ...pw.devices['Pixel 7'] }], ['ordinateur', { viewport: { width: 1280, height: 860 } }]]) {
    const { context, page } = await newPage(options, { mac: label === 'ordinateur' });
    await page.goto(`${BASE}/index.html`);
    await page.locator('.machine-tile').first().waitFor();
    await page.waitForTimeout(300);

    const expectedTabs = label === 'ordinateur' ? ['dock-home', 'library', 'links', 'folders'] : ['dock-home', 'library', 'links'];
    verdict('T41-CA6-onglets', JSON.stringify(await tabIds(page)) === JSON.stringify(expectedTabs), (await tabIds(page)).join(','), label);
    verdict('T41-CA7-actif-accueil', JSON.stringify(await currentTab(page)) === '["dock-home"]', '', label);
    verdict('T41-CA8-accueil-sans-boutons', await page.locator('.home .button, .home .back-button').count() === 0, '', label);
    const sizes = await page.evaluate(() => [...document.querySelectorAll('.dock-tab')].map((t) => { const r = t.getBoundingClientRect(); return [r.width, r.height]; }));
    verdict('T41-CA9-cibles-48px', sizes.every(([w, h]) => w >= 48 && h >= 48), JSON.stringify(sizes), label);
    const colors = await page.evaluate(() => [...document.querySelectorAll('.machine-tile')].slice(0, 4).map((t) => getComputedStyle(t).getPropertyValue('--gel').trim()));
    verdict('T41-CA5-quatre-couleurs', new Set(colors).size === 4, colors.join(','), label);
    verdict('T41-CA3-police-arrondie', /Trebuchet|Arial Rounded/.test(await page.evaluate(() => getComputedStyle(document.querySelector('.screen-title')).fontFamily)), '', label);
    await checkHeaderVersion(page, label, 'accueil');
    await shot(page, `${label}-1-accueil`);

    // Contenu jamais caché sous la barre : tout en bas, la version (dernier élément) est au-dessus de la barre.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);
    const [lastBottom, dockTop] = await page.evaluate(() => [document.querySelector('.app-version').getBoundingClientRect().bottom, document.querySelector('.dock').getBoundingClientRect().top]);
    verdict('T41-CA9-rien-sous-la-barre', lastBottom <= dockTop, `${lastBottom} / ${dockTop}`, label);
    await shot(page, `${label}-2-accueil-bas`);

    // Clavier : bas depuis la première machine, jusqu'à la barre.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.machine-tile').first().focus();
    for (let i = 0; i < 8; i += 1) { await page.keyboard.press('ArrowDown'); await page.waitForTimeout(120); }
    const focusedTab = await page.evaluate(() => document.activeElement?.closest('.dock') ? document.activeElement.dataset.navId : null);
    verdict('T41-CA9-clavier-atteint-la-barre', Boolean(focusedTab), String(focusedTab), label);
    await shot(page, `${label}-3-focus-barre`);

    // Onglets : « Mes fichiers », « Page web », puis « Machines » ; la grille d'une machine garde « Machines ».
    await page.locator('.dock-tab.library-link').click();
    await waitHash(page, /#\/fichiers/);
    verdict('T41-CA7-actif-mes-fichiers', JSON.stringify(await currentTab(page)) === '["library"]', '', label);
    await checkHeaderVersion(page, label, 'mes-fichiers');
    await shot(page, `${label}-4-mes-fichiers`);
    await page.locator('.dock-tab.links-button').click();
    await waitHash(page, /#\/telecharger/);
    verdict('T41-CA7-actif-page-web', JSON.stringify(await currentTab(page)) === '["links"]', JSON.stringify(await currentTab(page)) + page.url(), label);
    await page.locator('.dock-tab.home-tab').click();
    await page.locator('.machine-tile').first().waitFor();
    await page.locator('.machine-tile').first().click();
    await waitHash(page, /#\/amiga/);
    await checkHeaderVersion(page, label, 'grille');
    verdict('T41-CA7-grille-machines', JSON.stringify(await currentTab(page)) === '["dock-home"]', '', label);
    await shot(page, `${label}-5-grille`);

    if (label === 'ordinateur') {
      await page.goto(`${BASE}/index.html`);
      await page.locator('.dock-tab.folders-button').click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      verdict('T41-CA6-dossiers-ouvre-le-panneau', await dialog.isVisible(), '', label);
      await shot(page, `${label}-6-dossiers`);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'detached' });
      await page.waitForTimeout(200);
      verdict('T41-CA6-focus-rendu-a-dossiers', await page.evaluate(() => document.activeElement?.dataset?.navId === 'folders'), '', label);
    }

    // Page de jeu : pas de barre.
    await page.goto(`${BASE}/player.html?system=neogeo&game=${encodeURIComponent('jeu-01')}`);
    await page.waitForTimeout(500);
    verdict('T41-CA10-pas-de-barre-en-jeu', await page.locator('.dock').count() === 0, '', label);
    await context.close();
  }

  const { context, page } = await newPage({ viewport: { width: 1280, height: 860 } }, { reducedMotion: 'reduce' });
  await page.goto(`${BASE}/index.html`);
  await page.locator('.machine-tile').first().waitFor();
  await page.locator('.machine-tile').first().focus();
  await page.keyboard.press('ArrowRight');
  const transform = await page.evaluate(() => getComputedStyle(document.activeElement).transform);
  verdict('T41-CA11-reduced-motion', transform === 'none', transform);
  await context.close();
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => r.verdict !== 'PASSE');
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length ? 1 : 0);
