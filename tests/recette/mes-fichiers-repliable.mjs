// Recette T55 « Mes fichiers en rubriques repliables » : vrai navigateur, téléphone (Pixel 7, sans API du Mac : rubrique de synchronisation)
// et ordinateur, sur une copie de l'application sans jeux. Vérifie : tout fermé au départ, une seule rubrique ouverte, toucher referme,
// clavier qui ne s'arrête jamais dans une rubrique fermée, arrivée depuis la grille vide d'une machine, rubrique gardée au rechargement
// de l'écran, et prend les captures.
// Usage : PLAYWRIGHT_PATH=... node tests/recette/mes-fichiers-repliable.mjs [dossier de captures]
import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pw, verdict, results } from './lib.mjs';
import { contrastScan } from './page-fns.mjs';
import { PROJECT_ROOT } from '../../scripts/project-root.mjs';
import { createStaticServer } from '../../scripts/serve.mjs';

const captures = process.argv[2];
const root = await mkdtemp(join(tmpdir(), 'clone90-recette-t55-'));
for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets']) {
  await cp(join(PROJECT_ROOT, f), join(root, f), { recursive: true });
}
const server = createStaticServer({ root });
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://localhost:${port}`;
const browser = await pw.chromium.launch();
const shot = async (p, name, fullPage = false) => { if (captures) await p.screenshot({ path: join(captures, `${name}.png`), fullPage }); };
const SECTIONS = ['games', 'folder', 'sync', 'bios', 'covers', 'offline'];
const openIds = (page) => page.evaluate(() => [...document.querySelectorAll('.library-toggle')]
  .filter((t) => t.getAttribute('aria-expanded') === 'true' && !document.getElementById(t.getAttribute('aria-controls')).hidden).map((t) => t.dataset.navId.slice(8)));
const toggle = (page, id) => page.locator(`[data-nav-id="section-${id}"]`);

try {
  for (const [label, options] of [['telephone', { ...pw.devices['Pixel 7'] }], ['ordinateur', { viewport: { width: 1280, height: 860 } }]]) {
    const context = await browser.newContext(options);
    await context.route('https://cdn.emulatorjs.org/**', (r) => r.abort());
    await context.route('**/api/**', (r) => r.fulfill({ status: 404, body: 'Introuvable' }));
    await context.route('**/games.json', (r) => r.fulfill({ status: 404, body: '' }));
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html#/fichiers`);
    await page.locator('.library-toggle').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    const ids = await page.evaluate(() => [...document.querySelectorAll('.library-toggle')].map((t) => t.dataset.navId.slice(8)));
    verdict('T55-CA1-rubriques', JSON.stringify(ids) === JSON.stringify(SECTIONS), ids.join(','), label);
    verdict('T55-CA4-tout-ferme-au-depart', (await openIds(page)).length === 0, '', label);
    const tilesSide = await page.evaluate(() => { const [a, b] = [...document.querySelectorAll('.library-toggle.is-tile')].map((t) => t.getBoundingClientRect()); return Math.abs(a.top - b.top) < 2 && b.left > a.right; });
    verdict('T55-CA1-deux-tuiles-cote-a-cote', tilesSide, '', label);
    verdict('T55-CA1-fichiers-visibles', await page.locator('.library-files-block').isVisible(), '', label);
    const low = await page.evaluate(contrastScan);
    verdict('T55-CA7-contrastes', low.length === 0, JSON.stringify(low.slice(0, 3)), label);
    await shot(page, `${label}-1-ferme`);

    await toggle(page, 'bios').click();
    await page.waitForTimeout(200);
    verdict('T55-CA2-ouvre', JSON.stringify(await openIds(page)) === '["bios"]' && await page.locator('[data-nav-id="add-bios"]').isVisible(), '', label);
    await shot(page, `${label}-2-bios`);
    await toggle(page, 'covers').click();
    await page.waitForTimeout(200);
    verdict('T55-CA2-une-seule-ouverte', JSON.stringify(await openIds(page)) === '["covers"]' && !(await page.locator('[data-nav-id="add-bios"]').isVisible()), '', label);
    const rotated = await page.evaluate(() => getComputedStyle(document.querySelector('[data-nav-id="section-covers"] .library-toggle-arrow')).transform);
    verdict('T55-CA7-fleche-tournee', rotated !== 'none', rotated, label);
    await toggle(page, 'covers').click();
    await page.waitForTimeout(200);
    verdict('T55-CA2-toucher-referme', (await openIds(page)).length === 0, '', label);

    // Clavier : flèches du haut en bas ; le focus ne s'arrête jamais sur un bouton d'une rubrique fermée.
    await toggle(page, 'sync').click();
    await page.waitForTimeout(200);
    await toggle(page, 'games').focus();
    const seen = [];
    for (let i = 0; i < 14; i += 1) {
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(80);
      seen.push(await page.evaluate(() => { const a = document.activeElement; const p = a?.closest('.library-panel'); return { id: a?.dataset?.navId, hiddenPanel: Boolean(p?.hidden) }; }));
    }
    verdict('T55-CA6-clavier-jamais-dans-une-rubrique-fermee', seen.every((s) => !s.hiddenPanel) && seen.some((s) => /^sync-/.test(s.id ?? '')), JSON.stringify(seen.map((s) => s.id)), label);
    await page.keyboard.press('Escape');
    await toggle(page, 'bios').focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(200);
    verdict('T55-CA2-entree-ouvre', JSON.stringify(await openIds(page)) === '["bios"]', '', label);

    // Rubrique gardée : retour à l'accueil puis « Mes fichiers » de nouveau (nouveau rendu) ; arrivée depuis une grille vide.
    await page.goto(`${BASE}/index.html#/`);
    await page.locator('.machine-tile').first().waitFor();
    await page.goto(`${BASE}/index.html#/fichiers`);
    await page.locator('.library-toggle').first().waitFor();
    await page.waitForTimeout(200);
    verdict('T55-CA4-derniere-ouverte-gardee', JSON.stringify(await openIds(page)) === '["bios"]', JSON.stringify(await openIds(page)), label);
    await page.goto(`${BASE}/index.html#/nes`);
    await page.locator('[data-nav-id="add-local"]').first().click();
    await page.waitForFunction(() => /fichiers\?machine=nes/.test(location.hash));
    await page.waitForTimeout(300);
    verdict('T55-CA4-depuis-la-grille-vide', JSON.stringify(await openIds(page)) === '["games"]' && await page.locator('[data-nav-id="add-nes"]').isVisible(), JSON.stringify(await openIds(page)), label);
    await shot(page, `${label}-3-ajouter-des-jeux`);
    if (label === 'telephone') {
      await toggle(page, 'sync').click();
      await page.waitForTimeout(200);
      await shot(page, `${label}-4-synchro`);
    }
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
const failed = results.filter((r) => r.verdict !== 'PASSE');
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length ? 1 : 0);
