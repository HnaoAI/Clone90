// Recette T56 : vrai Clone90 du Mac (scripts/serve.mjs lancé pour de vrai, sur une copie de l'application) et vrai navigateur.
// Vérifie : en-tête sans logo (Pixel 7 et ordinateur), dossiers des machines créés au démarrage (non-régression T53), dossier d'une
// machine ajoutée à systems.json pendant que Clone90 tourne créé sans relance (écriture comme git : fichier temporaire puis renommage),
// dossier d'une autre casse gardé, et le même processus toujours en marche. Prend les captures de l'en-tête.
// Usage : PLAYWRIGHT_PATH=... node tests/recette/dossiers-machines.mjs [dossier de captures]
import { spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pw, verdict, results } from './lib.mjs';
import { PROJECT_ROOT } from '../../scripts/project-root.mjs';
import { runGenerate } from '../../scripts/generate-games.mjs';

const captures = process.argv[2];
const root = await mkdtemp(join(tmpdir(), 'clone90-recette-t56-'));
for (const f of ['index.html', 'player.html', 'manifest.webmanifest', 'sw.js', 'systems.json', 'css', 'js', 'data', 'assets', 'scripts']) {
  await cp(join(PROJECT_ROOT, f), join(root, f), { recursive: true });
}
await mkdir(join(root, 'roms', 'Amiga'), { recursive: true });
await writeFile(join(root, 'roms', 'Amiga', 'Leander.adf'), 'L');
await runGenerate({ root, log: () => {} });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (check, ms) => { const end = Date.now() + ms; while (Date.now() < end) { if (await check()) return true; await wait(100); } return false; };
const romsList = () => readdir(join(root, 'roms'));

const port = 18000 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, [join(root, 'scripts', 'serve.mjs'), '--port', String(port), '--host', '127.0.0.1'], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
let output = '';
child.stdout.on('data', (d) => { output += d; });
child.stderr.on('data', (d) => { output += d; });
const BASE = `http://localhost:${port}`;
const browser = await pw.chromium.launch();
try {
  const started = await until(() => output.includes('Clone90 : http://localhost'), 10000);
  verdict('T56-demarrage-serveur', started, output.split('\n')[0]);
  const catalog = JSON.parse(await readFile(join(root, 'systems.json'), 'utf8'));
  const { systems } = catalog;
  const ids = systems.map((s) => s.id);
  const atStart = await romsList();
  const missing = ids.filter((id) => id !== 'amiga' && !atStart.includes(id));
  verdict('T56-CA5-dossiers-au-demarrage', missing.length === 0 && !atStart.includes('amiga') && atStart.includes('Amiga'), `manquants : ${missing.join(', ') || 'aucun'}`);

  // Nouvelle machine pendant que Clone90 tourne : écriture comme git (fichier temporaire puis renommage).
  const next = { ...catalog, systems: [...systems, { ...systems[systems.length - 1], id: 'machinetest', name: 'Machine de test', order: 999 }] };
  await writeFile(join(root, 'systems.json.tmp'), JSON.stringify(next, null, 2));
  const t0 = Date.now();
  await rename(join(root, 'systems.json.tmp'), join(root, 'systems.json'));
  const created = await until(async () => (await romsList()).includes('machinetest'), 5000);
  verdict('T56-CA2-dossier-sans-relance', created && child.exitCode === null, `${Date.now() - t0} ms, processus ${child.pid} toujours en marche : ${child.exitCode === null}`);
  verdict('T56-CA2-message-console', await until(() => output.includes('roms/machinetest'), 2000), // le message arrive par le tube juste après le dossier
    output.split('\n').find((l) => l.includes('machinetest')) ?? '');
  verdict('T56-CA5-rien-deplace', (await readdir(join(root, 'roms', 'Amiga'))).join() === 'Leander.adf', '');

  for (const [label, options] of [['telephone', { ...pw.devices['Pixel 7'] }], ['ordinateur', { viewport: { width: 1280, height: 860 } }]]) {
    const context = await browser.newContext(options);
    const page = await context.newPage();
    await page.goto(`${BASE}/index.html`);
    await page.locator('.screen-title').first().waitFor();
    const header = await page.evaluate(() => {
      const h = document.querySelector('.app-header');
      return { images: h.querySelectorAll('svg, img').length, title: h.querySelector('.site-title')?.textContent, version: h.querySelector('.site-version')?.textContent ?? '' };
    });
    verdict('T56-CA1-titre-sans-logo', header.images === 0 && header.title === 'Clone90', JSON.stringify(header), label);
    if (captures) await page.screenshot({ path: join(captures, `${label}-1-en-tete.png`) });
    await context.close();
  }
} finally {
  await browser.close();
  child.kill();
}
const failed = results.filter((r) => r.verdict !== 'PASSE');
console.log(`\n${results.length - failed.length}/${results.length} vérifications passées`);
process.exit(failed.length ? 1 : 0);
