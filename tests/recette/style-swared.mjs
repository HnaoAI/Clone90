// Recette T54 « style Swared » : vrai navigateur, téléphone (Pixel 7) et ordinateur, sur une copie de l'application avec un games.json
// généré depuis des fichiers factices (on regarde l'affichage, pas l'émulation). Mode Mac simulé : api/settings et api/sync répondent
// (onglets « Dossiers » et « Partager avec le téléphone »). Vérifie la palette, la police Nunito chargée, l'en-tête, le total de jeux,
// les cartes (sélection verte, flèche dans un disque, machines vides), la barre du bas (non-régression T41), le bouton Jouer, les boîtes,
// les contrastes mesurés à l'écran, la réduction des animations, et prend les captures.
// Usage : PLAYWRIGHT_PATH=... node tests/recette/style-swared.mjs [dossier de captures]
import { cp, mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pw, verdict, results } from './lib.mjs';
import { contrastScan } from './page-fns.mjs';
import { PROJECT_ROOT } from '../../scripts/project-root.mjs';
import { createStaticServer } from '../../scripts/serve.mjs';
import { runGenerate } from '../../scripts/generate-games.mjs';

const captures = process.argv[2];
const root = await mkdtemp(join(tmpdir(), 'clone90-recette-swared-'));
for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets', 'scripts']) {
  await cp(join(PROJECT_ROOT, f), join(root, f), { recursive: true });
}
// Jeux factices : 7 machines avec des jeux (55 en tout), les autres à 0 jeu.
const roms = { neogeo: 12, amiga: 8, arcade: 24, megadrive: 5, nes: 3, snes: 2, gameboycolor: 1 };
const ext = { neogeo: 'zip', amiga: 'adf', arcade: 'zip', megadrive: 'md', nes: 'nes', snes: 'sfc', gameboycolor: 'gbc' };
for (const [machine, n] of Object.entries(roms)) {
  await mkdir(join(root, 'roms', machine), { recursive: true });
  for (let i = 1; i <= n; i += 1) await writeFile(join(root, 'roms', machine, `Jeu ${String(i).padStart(2, '0')}.${ext[machine]}`), 'X');
}
await mkdir(join(root, 'bios'), { recursive: true });
await runGenerate({ root, log: () => {} });

const server = createStaticServer({ root });
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://localhost:${port}`;
const browser = await pw.chromium.launch();
const shot = async (p, name, fullPage = false) => { if (captures) await p.screenshot({ path: join(captures, `${name}.png`), fullPage }); };
const SETTINGS = { romsDir: '/Users/moi/Jeux/ROMs', biosDir: '/projet/bios', romsIsDefault: false, biosIsDefault: true };
const SYNC = { enabled: true, running: true, addresses: ['https://192.168.1.20:8443'], devices: 1, hasPassword: true, acceptUploads: false };

/** Contexte de navigateur ; `mac` : l'API locale répond (onglet « Dossiers », partage), sinon elle est absente comme sur GitHub Pages. */
async function newPage(options, { mac = false, reducedMotion = 'no-preference' } = {}) {
  const context = await browser.newContext({ ...options, reducedMotion });
  await context.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
  await context.route('**/api/**', (r) => {
    const path = new URL(r.request().url()).pathname;
    if (mac && path.endsWith('/api/settings')) return r.fulfill({ json: SETTINGS });
    if (mac && path.endsWith('/api/sync')) return r.fulfill({ json: SYNC });
    return r.fulfill({ status: 404, body: 'Introuvable' });
  });
  return { context, page: await context.newPage() };
}
const currentTab = (page) => page.evaluate(() => [...document.querySelectorAll('.dock [aria-current="page"]')].map((t) => t.dataset.navId));
const waitHash = async (page, re) => { await page.waitForFunction((src) => new RegExp(src).test(location.hash), re.source); await page.waitForTimeout(250); };
const tabIds = (page) => page.evaluate(() => [...document.querySelectorAll('.dock-tab')].map((t) => t.dataset.navId));
const style = (page, sel, prop) => page.evaluate(([s, p]) => { const e = document.querySelector(s); return e ? getComputedStyle(e)[p] : null; }, [sel, prop]);
const GREEN = 'rgb(63, 208, 74)';
/** Contrastes mesurés à l'écran (page-fns.mjs) : aucun texte sous 4.5:1. */
async function checkContrast(page, label, where) {
  const low = await page.evaluate(contrastScan);
  verdict(`T54-CA2-contrastes-${where}`, low.length === 0, JSON.stringify(low.slice(0, 4)), label);
}

try {
  for (const [label, options] of [['telephone', { ...pw.devices['Pixel 7'] }], ['ordinateur', { viewport: { width: 1280, height: 860 } }]]) {
    const { context, page } = await newPage(options, { mac: label === 'ordinateur' });
    await page.goto(`${BASE}/index.html`);
    await page.locator('.machine-tile').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    verdict('T54-CA1-fond-anthracite', await style(page, 'body', 'backgroundColor') === 'rgb(31, 30, 29)', await style(page, 'body', 'backgroundColor'), label);
    verdict('T54-CA1-carte-noire', await style(page, '.machine-tile', 'backgroundColor') === 'rgb(29, 28, 27)', await style(page, '.machine-tile', 'backgroundColor'), label);
    verdict('T54-CA3-nunito-chargee', await page.evaluate(() => document.fonts.check('800 16px Nunito') && [...document.fonts].some((f) => f.family.replace(/"/g, '') === 'Nunito' && f.status === 'loaded')), '', label);
    verdict('T54-CA4-marque-en-tete', await page.locator('.app-header .header-mark').isVisible() && await style(page, '.site-title-90', 'color') === GREEN, '', label);
    const total = await page.locator('.home-total').textContent();
    verdict('T54-CA5-total-vert', total === '55 jeux' && await style(page, '.home-total', 'color') === GREEN, String(total), label);
    const empties = await page.evaluate(() => {
      const tiles = [...document.querySelectorAll('.machine-tile')];
      const first = tiles.findIndex((t) => t.classList.contains('is-empty'));
      return { last: first > 0 && tiles.slice(first).every((t) => t.classList.contains('is-empty')),
        noArrow: tiles.filter((t) => t.classList.contains('is-empty')).every((t) => getComputedStyle(t.querySelector('.machine-go')).display === 'none') };
    });
    verdict('T54-CA5-vides-en-fin-sans-fleche', empties.last && empties.noArrow, JSON.stringify(empties), label);
    verdict('T54-CA5-plus-de-voyants', await page.locator('.gauge').count() === 0, '', label);

    const expectedTabs = label === 'ordinateur' ? ['dock-home', 'library', 'links', 'folders'] : ['dock-home', 'library', 'links'];
    verdict('T54-CA9-onglets', JSON.stringify(await tabIds(page)) === JSON.stringify(expectedTabs), (await tabIds(page)).join(','), label);
    verdict('T54-CA9-actif-vert', JSON.stringify(await currentTab(page)) === '["dock-home"]' && await style(page, '.dock-tab[aria-current="page"]', 'color') === GREEN, '', label);
    const sizes = await page.evaluate(() => [...document.querySelectorAll('.dock-tab')].map((t) => { const r = t.getBoundingClientRect(); return [r.width, r.height]; }));
    verdict('T54-CA9-cibles-48px', sizes.every(([w, h]) => w >= 48 && h >= 48), JSON.stringify(sizes), label);
    await checkContrast(page, label, 'accueil');
    await shot(page, `${label}-1-accueil`);

    // Sélection au clavier : bordure verte, disque vert, nombre en vert, agrandissement.
    await page.locator('.machine-tile').first().focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(250);
    const sel = await page.evaluate(() => { const t = document.activeElement; const cs = getComputedStyle(t);
      return { border: cs.borderTopColor, go: getComputedStyle(t.querySelector('.machine-go')).backgroundColor, count: getComputedStyle(t.querySelector('.machine-count')).color, transform: cs.transform }; });
    verdict('T54-CA6-selection-verte', sel.border === GREEN && sel.go === GREEN && sel.count === GREEN && sel.transform !== 'none', JSON.stringify(sel), label);
    await shot(page, `${label}-2-selection`);

    // Contenu jamais caché sous la barre (non-régression T41).
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(200);
    const [lastBottom, dockTop] = await page.evaluate(() => [document.querySelector('.app-version').getBoundingClientRect().bottom, document.querySelector('.dock').getBoundingClientRect().top]);
    verdict('T54-CA9-rien-sous-la-barre', lastBottom <= dockTop, `${lastBottom} / ${dockTop}`, label);
    await shot(page, `${label}-3-accueil-bas`);

    // Grille : retour rond, titre centré, nombre de jeux en vert, carte sélectionnée avec titre vert.
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.locator('.machine-tile').first().click();
    await waitHash(page, /#\/amiga/);
    await page.locator('.game-tile').first().waitFor();
    const head = await page.evaluate(() => { const t = document.querySelector('.grid-title').getBoundingClientRect(); const b = document.querySelector('.grid-header .back-button').getBoundingClientRect();
      return { center: Math.abs((t.left + t.right) / 2 - window.innerWidth / 2), round: Math.abs(b.width - b.height) < 1 && b.width >= 48 }; });
    verdict('T54-CA7-en-tete-centre', head.center < 40 && head.round, JSON.stringify(head), label);
    verdict('T54-CA7-nombre-vert', await style(page, '.grid-count', 'color') === GREEN, '', label);
    await page.locator('.game-tile').first().focus();
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(250);
    verdict('T54-CA7-pochette-choisie', await page.evaluate(() => getComputedStyle(document.activeElement.querySelector('.game-title')).color) === GREEN, '', label);
    await checkContrast(page, label, 'grille');
    await shot(page, `${label}-4-grille`);

    // Mes fichiers et Page web : nouveau style, onglet actif.
    await page.locator('.dock-tab.library-link').click();
    await waitHash(page, /#\/fichiers/);
    verdict('T54-CA9-actif-mes-fichiers', JSON.stringify(await currentTab(page)) === '["library"]', '', label);
    await checkContrast(page, label, 'mes-fichiers');
    await shot(page, `${label}-5-mes-fichiers`);
    await page.locator('.dock-tab.links-button').click();
    await waitHash(page, /#\/telecharger/);
    await checkContrast(page, label, 'page-web');
    await shot(page, `${label}-6-page-web`);

    if (label === 'ordinateur') {
      await page.goto(`${BASE}/index.html`);
      await page.locator('.dock-tab.folders-button').click();
      const dialog = page.getByRole('dialog');
      await dialog.waitFor();
      await page.waitForTimeout(300);
      verdict('T54-CA10-boite-noire', await style(page, '.dialog-box', 'backgroundColor') === 'rgb(29, 28, 27)', '', label);
      await checkContrast(page, label, 'dossiers');
      await shot(page, `${label}-7-dossiers`);
      await page.getByRole('button', { name: 'Partager avec le téléphone' }).click();
      await page.getByText('https://192.168.1.20:8443').first().waitFor();
      await page.waitForTimeout(300);
      await checkContrast(page, label, 'partage');
      await shot(page, `${label}-8-partage`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }

    // Écran Jouer (Mega Drive : pas de BIOS) : bouton vert plein d'au moins 64 px, pas de barre en jeu.
    await page.goto(`${BASE}/index.html#/megadrive`);
    await page.locator('.game-tile').first().waitFor();
    const playerHref = await page.locator('.game-tile').first().getAttribute('href');
    await page.goto(new URL(playerHref, `${BASE}/index.html`).href);
    await page.locator('.play-button').waitFor();
    await page.waitForTimeout(300);
    const play = await page.evaluate(() => { const b = document.querySelector('.play-button'); const r = b.getBoundingClientRect(); return { bg: getComputedStyle(b).backgroundColor, h: r.height }; });
    verdict('T54-CA8-jouer-vert-64px', play.bg === GREEN && play.h >= 64, JSON.stringify(play), label);
    verdict('T54-CA9-pas-de-barre-en-jeu', await page.locator('.dock').count() === 0, '', label);
    await checkContrast(page, label, 'jouer');
    await shot(page, `${label}-9-jouer`);
    await context.close();
  }

  const { context, page } = await newPage({ viewport: { width: 1280, height: 860 } }, { reducedMotion: 'reduce' });
  await page.goto(`${BASE}/index.html`);
  await page.locator('.machine-tile').first().waitFor();
  await page.locator('.machine-tile').first().focus();
  await page.keyboard.press('ArrowRight');
  const transform = await page.evaluate(() => getComputedStyle(document.activeElement).transform);
  verdict('T54-CA11-reduced-motion', transform === 'none', transform);
  await context.close();
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => r.verdict !== 'PASSE');
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length ? 1 : 0);
