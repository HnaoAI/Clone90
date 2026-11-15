// Tests de T42 : vrais logos des machines sur le téléphone (navigateur). AUCUN réseau : faux GitHub, fausse bibliothèque.
// Couvre js/local-logos.js, l'ajout des logos locaux par loadData (js/data.js), la source commune avec le Mac (js/logo-source.js)
// et l'écran « Mes fichiers » (logos non listés comme fichiers de la personne).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findLocalLogos, loadLocalLogos, localLogoPaths, localLogoPath, isLocalLogoPath,
} from '../js/local-logos.js';
import * as source from '../js/logo-source.js';
import * as macLogos from '../scripts/machine-logos.mjs';
import { LOGOS_DIR as MAC_LOGOS_DIR } from '../scripts/generate-games.mjs';
import { loadData } from '../js/data.js';
import { machineLogoSources } from '../js/ui/logo.js';
import { groupLibraryEntries, COVERS_LIBRARY_INFO } from '../js/ui/library-screen.js';

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>';
const SYSTEMS = [
  { id: 'amiga', name: 'Amiga', logoTheme: 'amiga' },
  { id: 'pcenginecd', name: 'PC Engine CD', logoTheme: 'tg-cd' },
  { id: 'nes', name: 'NES' }, // sans logoTheme : garde son logo maison
];

/** Fausse bibliothèque (mêmes méthodes que local-library.js). */
function fakeLibrary(paths = []) {
  const files = new Map(paths.map((p) => [p, new Blob(['x'])]));
  return {
    files,
    list: async () => [...files.keys()].map((path) => ({ path, size: files.get(path).size, addedAt: 0 })),
    put: async (path, blob) => { files.set(path, blob); },
  };
}

/** Faux GitHub : `body(url)` donne le texte renvoyé ; les adresses demandées sont enregistrées. */
function fakeFetch(body = () => SVG) {
  const calls = [];
  const fetchBytes = async (url, options) => {
    calls.push(url);
    assert.equal(options.maxBytes, source.MAX_LOGO_BYTES);
    const out = body(url);
    if (out instanceof Error) throw out;
    return new TextEncoder().encode(out);
  };
  return { calls, fetchBytes };
}

test('T42 le téléphone télécharge le logo de chaque machine qui en a un et le range au même chemin que sur le Mac', async () => {
  const library = fakeLibrary();
  const { calls, fetchBytes } = fakeFetch();
  const summary = await findLocalLogos({ systems: SYSTEMS, library, fetchBytes });
  assert.deepEqual(summary, { found: ['Amiga', 'PC Engine CD'], alreadyHave: 0, failed: [] });
  assert.deepEqual([...library.files.keys()].sort(), ['roms/clone90-logos/amiga.svg', 'roms/clone90-logos/pcenginecd.svg']);
  const blob = library.files.get('roms/clone90-logos/amiga.svg');
  assert.equal(blob.type, 'image/svg+xml');
  assert.equal(await blob.text(), SVG);
  assert.deepEqual(calls, [source.logoUrl('amiga'), source.logoUrl('tg-cd')]);
});

test('T42 seulement des lectures sur raw.githubusercontent.com, thème es-theme-carbon figé (même source que le Mac)', async () => {
  const { calls, fetchBytes } = fakeFetch();
  await findLocalLogos({ systems: SYSTEMS, library: fakeLibrary(), fetchBytes });
  for (const url of calls) assert.match(url, new RegExp(`^https://raw\\.githubusercontent\\.com/RetroPie/es-theme-carbon/${source.LOGO_THEME_COMMIT}/[a-z0-9-]+/art/system\\.svg$`));
  assert.equal(macLogos.logoUrl, source.logoUrl);
  assert.equal(macLogos.checkSvg, source.checkSvg);
  assert.equal(macLogos.MAX_LOGO_BYTES, source.MAX_LOGO_BYTES);
  assert.equal(source.LOGOS_DIR, MAC_LOGOS_DIR);
});

test('T42 une relance ne retélécharge rien et ne remplace jamais un logo déjà présent', async () => {
  const library = fakeLibrary(['roms/clone90-logos/amiga.svg', 'roms/clone90-logos/pcenginecd.svg']);
  const before = library.files.get('roms/clone90-logos/amiga.svg');
  const { calls, fetchBytes } = fakeFetch();
  const summary = await findLocalLogos({ systems: SYSTEMS, library, fetchBytes });
  assert.deepEqual(summary, { found: [], alreadyHave: 2, failed: [] });
  assert.equal(calls.length, 0);
  assert.equal(library.files.get('roms/clone90-logos/amiga.svg'), before);
});

test('T42 un logo arrivé pendant le téléchargement (autre onglet) n\'est pas remplacé', async () => {
  const library = fakeLibrary();
  const other = new Blob(['autre onglet']);
  const { fetchBytes } = fakeFetch((url) => { if (url.includes('/amiga/')) library.files.set('roms/clone90-logos/amiga.svg', other); return SVG; });
  const summary = await findLocalLogos({ systems: SYSTEMS.slice(0, 1), library, fetchBytes });
  assert.deepEqual(summary, { found: [], alreadyHave: 1, failed: [] });
  assert.equal(library.files.get('roms/clone90-logos/amiga.svg'), other);
});

test('T42 un SVG dangereux ou qui n\'en est pas un est refusé et rien n\'est écrit', async () => {
  for (const bad of ['<svg onload="alert(1)"></svg>', '<svg><script>x</script></svg>', '<html></html>', '']) {
    const library = fakeLibrary();
    const { fetchBytes } = fakeFetch(() => bad);
    const summary = await findLocalLogos({ systems: SYSTEMS.slice(0, 1), library, fetchBytes });
    assert.equal(summary.found.length, 0, bad);
    assert.equal(summary.failed.length, 1, bad);
    assert.equal(library.files.size, 0, bad);
  }
});

test('T42 sans réseau : aucune exception, chaque machine en échec, rien d\'écrit, et l\'essai suivant reprend', async () => {
  const library = fakeLibrary();
  const offline = fakeFetch(() => new Error('GitHub injoignable (pas de connexion à Internet ?)'));
  const summary = await findLocalLogos({ systems: SYSTEMS, library, fetchBytes: offline.fetchBytes });
  assert.deepEqual(summary.found, []);
  assert.deepEqual(summary.failed.map((f) => f.system), ['Amiga', 'PC Engine CD']);
  assert.match(summary.failed[0].reason, /injoignable/);
  assert.equal(library.files.size, 0);
  const again = await findLocalLogos({ systems: SYSTEMS, library, fetchBytes: fakeFetch().fetchBytes });
  assert.equal(again.found.length, 2);
});

test('T42 bibliothèque illisible ou écriture refusée : aucune exception', async () => {
  const broken = { list: async () => { throw new Error('refusé'); }, put: async () => { throw new Error('refusé'); } };
  assert.deepEqual(await findLocalLogos({ systems: SYSTEMS, library: broken, fetchBytes: fakeFetch().fetchBytes }), { found: [], alreadyHave: 0, failed: [] });
  const full = { list: async () => [], put: async () => { throw new Error('plus de place'); } };
  const summary = await findLocalLogos({ systems: SYSTEMS, library: full, fetchBytes: fakeFetch().fetchBytes });
  assert.deepEqual(summary.failed.map((f) => f.reason), ['plus de place', 'plus de place']);
});

test('T42 une machine à l\'identifiant ou au dossier de thème invalide est ignorée sans requête', async () => {
  const { calls, fetchBytes } = fakeFetch();
  const summary = await findLocalLogos({ systems: [{ id: '../x', name: 'X', logoTheme: 'amiga' }, { id: 'snes', name: 'SNES', logoTheme: '../x' }], library: fakeLibrary(), fetchBytes });
  assert.equal(calls.length, 0);
  assert.equal(summary.failed.length, 2);
});

test('T42 localLogoPath, isLocalLogoPath, localLogoPaths : chemins des logos de la bibliothèque', () => {
  assert.equal(localLogoPath('amiga'), 'roms/clone90-logos/amiga.svg');
  assert.throws(() => localLogoPath('../x'), /invalide/);
  assert.equal(isLocalLogoPath('roms/clone90-logos/amiga.svg'), true);
  assert.equal(isLocalLogoPath('roms/amiga/Gods.adf'), false);
  assert.equal(isLocalLogoPath(undefined), false);
  assert.deepEqual(localLogoPaths([...SYSTEMS, { id: 'A B' }], ['roms/clone90-logos/amiga.svg', 'roms/clone90-logos/snes.svg', 'roms/amiga/Gods.adf']), { amiga: 'roms/clone90-logos/amiga.svg' });
});

test('T42 loadLocalLogos lit la bibliothèque ; sans bibliothèque, aucun logo et aucune exception', async () => {
  const library = fakeLibrary(['roms/clone90-logos/nes.svg']);
  assert.deepEqual(await loadLocalLogos(SYSTEMS, { openLibrary: async () => library }), { nes: 'roms/clone90-logos/nes.svg' });
  assert.deepEqual(await loadLocalLogos(SYSTEMS, { openLibrary: async () => { throw new Error('pas d\'IndexedDB'); } }), {});
});

const SYSTEMS_JSON = {
  version: 1,
  emulatorjsVersion: 'stable',
  systems: [
    { id: 'amiga', name: 'Amiga', order: 1, emulatorjsCore: 'puae', extensions: ['adf'], logo: 'assets/logos/amiga.svg', accent: '--m-amiga', bios: [] },
    { id: 'nes', name: 'NES', order: 2, emulatorjsCore: 'fceumm', extensions: ['nes'], logo: 'assets/logos/nes.svg', accent: '--m-nes', bios: [] },
  ],
};
const fetchJsonWith = (games) => async (url) => {
  if (url.endsWith('systems.json')) return SYSTEMS_JSON;
  if (games) return games;
  const e = new Error('404'); e.status = 404; throw e;
};

test('T42 l\'accueil du téléphone affiche le vrai logo gardé dans le navigateur (logo maison en repli)', async () => {
  const data = await loadData(fetchJsonWith(null), null, async () => ({ amiga: 'roms/clone90-logos/amiga.svg' }));
  const amiga = data.systems.find((s) => s.id === 'amiga');
  assert.equal(amiga.downloadedLogo, 'roms/clone90-logos/amiga.svg');
  assert.deepEqual(machineLogoSources(amiga), { logo: 'roms/clone90-logos/amiga.svg', fallbackLogo: 'assets/logos/amiga.svg', downloaded: true });
  assert.equal(data.systems.find((s) => s.id === 'nes').downloadedLogo, undefined);
});

test('T42 le logo du Mac (games.json) garde la priorité ; un chemin inattendu ou une erreur de la bibliothèque est ignoré', async () => {
  const games = { version: 1, games: [], logos: { amiga: 'roms/clone90-logos/amiga.svg' } };
  let data = await loadData(fetchJsonWith(games), null, async () => ({ amiga: 'roms/clone90-logos/autre.svg', nes: 'https://exemple.com/x.svg' }));
  assert.equal(data.systems.find((s) => s.id === 'amiga').downloadedLogo, 'roms/clone90-logos/amiga.svg');
  assert.equal(data.systems.find((s) => s.id === 'nes').downloadedLogo, undefined);
  data = await loadData(fetchJsonWith(null), null, async () => { throw new Error('refusé'); });
  assert.equal(data.systems.every((s) => s.downloadedLogo === undefined), true);
});

test('T42 « Mes fichiers » ne liste pas les logos parmi les fichiers de la personne, et dit que les logos sont téléchargés', () => {
  const groups = groupLibraryEntries([
    { path: 'roms/clone90-logos/amiga.svg', size: 10 }, { path: 'roms/amiga/Gods.adf', size: 20 },
  ], [{ id: 'amiga', name: 'Amiga' }]);
  assert.deepEqual(groups.map((g) => [g.id, g.files.map((f) => f.path)]), [['amiga', ['roms/amiga/Gods.adf']]]);
  assert.match(COVERS_LIBRARY_INFO, /logos des machines/);
  assert.match(COVERS_LIBRARY_INFO, /aucun nom de jeu/);
});
