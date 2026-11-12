// Tests de scripts/covers.mjs (T28) : pochettes automatiques. AUCUN réseau : faux dépôts GitHub et faux téléchargements injectés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, copyFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  normalizeTitle, chooseCover, coverTargetPath, isPng, fetchRepoListing, githubUrl, runCovers, formatSummary,
  MAX_COVER_BYTES, COVERS_CACHE_FILE,
} from '../scripts/covers.mjs';

const FIXED_DATE = new Date('2026-11-12T10:00:00.000Z');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const exists = (p) => access(p).then(() => true, () => false);
let shaCounter = 0;
/** Fichier de base factice ; `sha` explicite pour simuler deux noms qui pointent la même image. */
const file = (name, extra = {}) => ({ name, sha: `sha${shaCounter += 1}`, size: 1000, ...extra });

/** Faux GitHub : `repos` = { nomDuDépôt: [fichiers] }. Enregistre les adresses demandées. */
function fakeGithub(repos, { bytes = () => PNG } = {}) {
  const calls = { json: [], bytes: [] };
  const fetchJson = async (url) => {
    calls.json.push(url);
    const m = /^https:\/\/api\.github\.com\/repos\/libretro-thumbnails\/([^/]+)\/git\/trees\/(.+)$/.exec(url);
    if (!m || !repos[m[1]]) throw new Error('GitHub a répondu 404');
    if (m[2] === 'HEAD') return { tree: [{ path: 'Named_Snaps', type: 'tree', sha: 'S' }, { path: 'Named_Boxarts', type: 'tree', sha: `B-${m[1]}` }] };
    return { truncated: false, tree: [...repos[m[1]].map((f) => ({ path: f.name, type: 'blob', sha: f.sha, size: f.size })), { path: 'sous-dossier', type: 'tree', sha: 'x' }] };
  };
  const fetchBytes = async (url, options) => {
    calls.bytes.push(url);
    assert.equal(options.maxBytes, MAX_COVER_BYTES);
    return bytes(url);
  };
  return { net: { fetchJson, fetchBytes }, calls };
}

const SYSTEMS = {
  version: 1,
  systems: [
    { id: 'amiga', name: 'Amiga', order: 10, extensions: ['adf', 'm3u', 'zip', 'cue'], diskSets: true, thumbnailsRepo: 'Fake_Amiga', bios: [] },
    { id: 'neogeo', name: 'Neo Geo', order: 20, extensions: ['zip'], thumbnailsRepo: 'Fake_NeoGeo', bios: [] },
    { id: 'arcade', name: 'Arcade', order: 30, extensions: ['zip'], thumbnailsRepo: 'Fake_Arcade', bios: [] },
    { id: 'nes', name: 'NES', order: 40, extensions: ['nes'], bios: [] },
  ],
};

async function withProject(files, fn, systems = SYSTEMS) {
  const root = await mkdtemp(join(tmpdir(), 'clone90-cov-'));
  try {
    await writeFile(join(root, 'systems.json'), JSON.stringify(systems));
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, rel)), { recursive: true });
      await writeFile(join(root, rel), content);
    }
    return await fn(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const gamesJson = async (root) => JSON.parse(await readFile(join(root, 'games.json'), 'utf8')).games;

// ---- Correspondance des titres ----

test('normalizeTitle : sans étiquettes entre parenthèses ou crochets, casse, accents et ponctuation ignorés', () => {
  assert.equal(normalizeTitle('Gods (Europe) [!]'), 'gods');
  assert.equal(normalizeTitle('GODS'), 'gods');
  assert.equal(normalizeTitle('Ms. Pac-Man'), normalizeTitle('MS Pacman'.replace('Pacman', 'Pac Man')));
  assert.equal(normalizeTitle('Pokémon'), normalizeTitle('Pokemon'));
});

test('normalizeTitle : « The » ignoré au début comme à la fin (No-Intro : « Legend of Zelda, The »), « & » et « and » équivalents', () => {
  assert.equal(normalizeTitle('The Legend of Zelda'), normalizeTitle('Legend of Zelda, The'));
  assert.equal(normalizeTitle('Rock & Roll Racing'), normalizeTitle('Rock and Roll Racing'));
});

test('normalizeTitle : caractères interdits remplacés par _ dans la base (Street Fighter II_ ...) équivalents au titre d\'origine', () => {
  assert.equal(normalizeTitle('Street Fighter II: The World Warrior'), normalizeTitle('Street Fighter II_ The World Warrior'));
  assert.equal(normalizeTitle('Rock & Roll'), normalizeTitle('Rock _ Roll'));
});

test('normalizeTitle : titre vide ou sans lettre donne une chaîne vide', () => {
  assert.equal(normalizeTitle(''), '');
  assert.equal(normalizeTitle('(Europe)'), '');
});

test('chooseCover : préfère Europe, puis USA, puis World, puis le reste', () => {
  const pick = (names) => chooseCover('Gods', names.map((n) => file(n)));
  assert.equal(pick(['Gods (USA).png', 'Gods (Europe).png', 'Gods (Japan).png']).file.name, 'Gods (Europe).png');
  assert.equal(pick(['Gods (World).png', 'Gods (USA).png', 'Gods (Japan).png']).file.name, 'Gods (USA).png');
  assert.equal(pick(['Gods (Japan).png', 'Gods (World).png']).file.name, 'Gods (World).png');
  assert.equal(pick(['Gods (Japan).png']).file.name, 'Gods (Japan).png');
});

test('chooseCover : un nom exact sans étiquette passe avant les variantes (Viewpoint.png avant Viewpoint (prototype).png)', () => {
  const r = chooseCover('Viewpoint', [file('Viewpoint (prototype).png'), file('Viewpoint.png')]);
  assert.equal(r.file.name, 'Viewpoint.png');
});

test('chooseCover : les versions Beta, Proto ou Compilation passent après les versions normales', () => {
  assert.equal(chooseCover('Viewpoint', [file('Viewpoint (USA) (Beta).png'), file('Viewpoint (USA).png')]).file.name, 'Viewpoint (USA).png');
  assert.equal(chooseCover('Powerplay', [file('Powerplay (Europe) (Compilation - Astra Pack).png'), file('Powerplay (USA).png')]).file.name, 'Powerplay (USA).png');
});

test('chooseCover : plusieurs candidats aussi bons mais images différentes = ambiguë, rien de choisi', () => {
  const r = chooseCover('Metal Slug 3', [file('Metal Slug 3 (NGH-2560).png'), file('Metal Slug 3 (NGM-2560).png')]);
  assert.equal(r.status, 'ambiguous');
  assert.equal(r.files.length, 2);
});

test('chooseCover : deux noms qui pointent la même image (même sha) ne sont pas ambigus', () => {
  const r = chooseCover('Leander', [file('Leander (Europe).png', { sha: 'same' }), file('Leander (Europe) (Alt).png', { sha: 'same' })]);
  assert.equal(r.status, 'found');
});

test('chooseCover : introuvable', () => {
  assert.equal(chooseCover('Zzz', [file('Gods.png')]).status, 'none');
  assert.equal(chooseCover('', [file('Gods.png')]).status, 'none');
  assert.equal(chooseCover('Gods', []).status, 'none');
});

test('chooseCover : à défaut de titre identique, un sous-titre (Metal Slug - Super Vehicle-001) est accepté si c\'est le seul', () => {
  const r = chooseCover('Metal Slug', [file('Metal Slug - Super Vehicle-001.png'), file('Metal Slug 2 - Super Vehicle-001_II (NGM-2410).png')]);
  assert.equal(r.file.name, 'Metal Slug - Super Vehicle-001.png');
});

test('chooseCover : un titre qui n\'est que le début d\'un autre (Gods contre War Gods) ne correspond pas', () => {
  assert.equal(chooseCover('Gods', [file('War Gods.png'), file('Asterix and the Power of the Gods (Europe).png')]).status, 'none');
});

test('chooseCover : ignore les fichiers qui ne sont pas des PNG', () => {
  assert.equal(chooseCover('Gods', [file('Gods.jpg'), file('Gods.txt')]).status, 'none');
});

// ---- Nom du fichier écrit ----

test('coverTargetPath : même dossier et même nom que le jeu, en .png (jeu simple, .m3u, .cue, sous-dossier)', () => {
  assert.equal(coverTargetPath({ file: 'roms/amiga/Gods.adf' }), 'amiga/Gods.png');
  assert.equal(coverTargetPath({ file: 'roms/amiga/Monkey Island.m3u' }), 'amiga/Monkey Island.png');
  assert.equal(coverTargetPath({ file: 'roms/megacd/Sonic CD/Sonic CD.cue' }), 'megacd/Sonic CD/Sonic CD.png');
  assert.equal(coverTargetPath({ file: 'roms/neogeo/viewpoin.zip' }), 'neogeo/viewpoin.png');
});

test('isPng : signature PNG exigée', () => {
  assert.equal(isPng(PNG), true);
  assert.equal(isPng(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0])), false);
  assert.equal(isPng(new TextEncoder().encode('<html>404</html>')), false);
  assert.equal(isPng(new Uint8Array()), false);
});

test('githubUrl : seulement api.github.com et raw.githubusercontent.com, nom de dépôt contrôlé, nom de fichier encodé', () => {
  assert.equal(githubUrl('api', 'SNK_-_Neo_Geo', 'HEAD'), 'https://api.github.com/repos/libretro-thumbnails/SNK_-_Neo_Geo/git/trees/HEAD');
  assert.equal(githubUrl('raw', 'SNK_-_Neo_Geo', 'Gods (Europe) & Co?.png'),
    'https://raw.githubusercontent.com/libretro-thumbnails/SNK_-_Neo_Geo/HEAD/Named_Boxarts/Gods%20(Europe)%20%26%20Co%3F.png');
  assert.throws(() => githubUrl('api', '../evil', 'HEAD'), /invalide/);
  assert.throws(() => githubUrl('raw', 'a/b', 'x.png'), /invalide/);
});

test('fetchRepoListing : deux requêtes (racine puis Named_Boxarts), seulement les PNG', async () => {
  const gh = fakeGithub({ R: [file('A.png'), file('B (Europe).png'), file('notes.txt')] });
  const list = await fetchRepoListing('R', gh.net.fetchJson);
  assert.deepEqual(list.map((f) => f.name), ['A.png', 'B (Europe).png']);
  assert.equal(gh.calls.json.length, 2);
});

test('fetchRepoListing : dossier absent ou liste tronquée = erreur claire', async () => {
  await assert.rejects(fetchRepoListing('R', async () => ({ tree: [] })), /Named_Boxarts/);
  const truncated = async (url) => (url.endsWith('HEAD') ? { tree: [{ path: 'Named_Boxarts', type: 'tree', sha: 'x' }] } : { truncated: true, tree: [] });
  await assert.rejects(fetchRepoListing('R', truncated), /incomplète/);
});

// ---- Parcours complet ----

test('runCovers : télécharge la pochette d\'un jeu sans jaquette, l\'écrit au nom attendu et la fait apparaître dans games.json', async () => {
  const gh = fakeGithub({ Fake_Amiga: [file('Gods.png'), file('Zaxxon.png')], Fake_NeoGeo: [], Fake_Arcade: [] });
  await withProject({ 'roms/amiga/Gods.adf': 'x' }, async (root) => {
    const out = await runCovers({ root, now: FIXED_DATE, net: gh.net });
    assert.equal(out.exitCode, 0);
    assert.deepEqual(out.summary.found.map((f) => f.file), ['amiga/Gods.png']);
    assert.deepEqual([...await readFile(join(root, 'roms/amiga/Gods.png'))], [...PNG]);
    assert.equal((await gamesJson(root))[0].cover, 'roms/amiga/Gods.png');
    assert.deepEqual(gh.calls.bytes, ['https://raw.githubusercontent.com/libretro-thumbnails/Fake_Amiga/HEAD/Named_Boxarts/Gods.png']);
  });
});

test('runCovers : toutes les requêtes vont vers api.github.com ou raw.githubusercontent.com (lecture seule, sans donnée de l\'utilisateur)', async () => {
  const gh = fakeGithub({ Fake_Amiga: [file('Gods.png')], Fake_NeoGeo: [], Fake_Arcade: [] });
  await withProject({ 'roms/amiga/Gods.adf': 'x' }, async (root) => {
    await runCovers({ root, net: gh.net });
    const urls = [...gh.calls.json, ...gh.calls.bytes];
    assert.ok(urls.length > 0);
    for (const url of urls) {
      assert.ok(url.startsWith('https://api.github.com/repos/libretro-thumbnails/') || url.startsWith('https://raw.githubusercontent.com/libretro-thumbnails/'), url);
      assert.ok(!/Gods\.adf|clone90|\?/.test(url), 'aucune donnée de l\'utilisateur dans les adresses');
    }
  });
});

test('runCovers : ne remplace JAMAIS une image existante (jeu avec jaquette = déjà présente, aucune requête de téléchargement)', async () => {
  const gh = fakeGithub({ Fake_Amiga: [file('Gods.png')], Fake_NeoGeo: [], Fake_Arcade: [] });
  await withProject({ 'roms/amiga/Gods.adf': 'x', 'roms/amiga/Gods.jpg': 'ma jaquette' }, async (root) => {
    const out = await runCovers({ root, net: gh.net });
    assert.equal(out.summary.alreadyHave, 1);
    assert.equal(out.summary.found.length, 0);
    assert.equal(await readFile(join(root, 'roms/amiga/Gods.jpg'), 'utf8'), 'ma jaquette');
    assert.equal(await exists(join(root, 'roms/amiga/Gods.png')), false);
    assert.equal(gh.calls.bytes.length, 0);
    assert.equal(gh.calls.json.length, 0); // rien à chercher : pas même la liste
  });
});

test('runCovers : si un fichier du même nom apparaît pendant le téléchargement, il n\'est pas écrasé', async () => {
  let root;
  const gh = fakeGithub({ Fake_Amiga: [file('Gods.png')], Fake_NeoGeo: [], Fake_Arcade: [] }, {
    bytes: () => { writeFileSync(join(root, 'roms/amiga/Gods.png'), 'arrivée entre-temps'); return PNG; },
  });
  await withProject({ 'roms/amiga/Gods.adf': 'x' }, async (r) => {
    root = r;
    const out = await runCovers({ root, net: gh.net });
    assert.equal(await readFile(join(root, 'roms/amiga/Gods.png'), 'utf8'), 'arrivée entre-temps');
    assert.equal(out.summary.found.length, 0);
    assert.equal(out.summary.failed.length, 0);
  });
});

test('runCovers : --dry-run n\'écrit aucune image, ne télécharge rien et ne touche pas à games.json', async () => {
  const gh = fakeGithub({ Fake_Amiga: [file('Gods.png')], Fake_NeoGeo: [], Fake_Arcade: [] });
  await withProject({ 'roms/amiga/Gods.adf': 'x' }, async (root) => {
    const out = await runCovers({ root, dryRun: true, net: gh.net });
    assert.equal(out.dryRun, true);
    assert.deepEqual(out.summary.found.map((f) => f.file), ['amiga/Gods.png']);
    assert.equal(gh.calls.bytes.length, 0);
    assert.deepEqual(await readdir(join(root, 'roms/amiga')), ['Gods.adf']);
    assert.equal(await exists(join(root, 'games.json')), false);
  });
});

test('runCovers : le fichier reçu n\'est écrit que si c\'est un vrai PNG (une page HTML d\'erreur est refusée)', async () => {
  const gh = fakeGithub({ Fake_Amiga: [file('Gods.png')], Fake_NeoGeo: [], Fake_Arcade: [] }, { bytes: () => new TextEncoder().encode('<html>Not found</html>') });
  await withProject({ 'roms/amiga/Gods.adf': 'x' }, async (root) => {
    const out = await runCovers({ root, net: gh.net });
    assert.equal(out.summary.found.length, 0);
    assert.match(out.summary.failed[0].reason, /PNG/);
    assert.equal(await exists(join(root, 'roms/amiga/Gods.png')), false);
  });
});

test('runCovers : image de plus de 2 Mo refusée (taille annoncée par la liste) sans la télécharger', async () => {
  const gh = fakeGithub({ Fake_Amiga: [file('Gods.png', { size: MAX_COVER_BYTES + 1 })], Fake_NeoGeo: [], Fake_Arcade: [] });
  await withProject({ 'roms/amiga/Gods.adf': 'x' }, async (root) => {
    const out = await runCovers({ root, net: gh.net });
    assert.match(out.summary.failed[0].reason, /2 Mo/);
    assert.equal(gh.calls.bytes.length, 0);
  });
});

test('runCovers : une erreur de téléchargement est signalée pour ce jeu et les autres continuent', async () => {
  const gh = fakeGithub({ Fake_Amiga: [file('Gods.png'), file('Zaxxon.png')], Fake_NeoGeo: [], Fake_Arcade: [] }, {
    bytes: (url) => { if (url.includes('Gods')) throw new Error('GitHub a répondu 500'); return PNG; },
  });
  await withProject({ 'roms/amiga/Gods.adf': 'x', 'roms/amiga/Zaxxon.adf': 'x' }, async (root) => {
    const out = await runCovers({ root, net: gh.net });
    assert.deepEqual(out.summary.found.map((f) => f.title), ['Zaxxon']);
    assert.equal(out.summary.failed[0].title, 'Gods');
  });
});

test('runCovers : plusieurs régions = Europe choisie ; ambiguïté ou introuvable = rien de téléchargé et signalé', async () => {
  const gh = fakeGithub({
    Fake_Amiga: [file('Leander (USA).png'), file('Leander (Europe).png'), file('Alpha (Europe).png'), file('Alpha (Europe) (Rev A).png', { sha: 'autre' }), file('Beta (USA).png'), file('Beta (USA) (Disk 2).png')],
    Fake_NeoGeo: [], Fake_Arcade: [],
  });
  await withProject({ 'roms/amiga/Leander.adf': 'x', 'roms/amiga/Alpha.adf': 'x', 'roms/amiga/Introuvable.adf': 'x' }, async (root) => {
    const out = await runCovers({ root, net: gh.net });
    assert.deepEqual(out.summary.found.map((f) => [f.title, f.source]), [['Leander', 'Leander (Europe).png']]);
    assert.deepEqual(out.summary.notFound, ['Introuvable']);
    assert.equal(out.summary.alreadyHave, 0);
    assert.equal(gh.calls.bytes.length, 1);
  });
});

test('runCovers : Neo Geo et arcade cherchent par le titre de data/titles.json (romset viewpoin devient Viewpoint) ; plusieurs sets = ambigu', async () => {
  const gh = fakeGithub({
    Fake_Amiga: [], Fake_NeoGeo: [file('Viewpoint.png'), file('Viewpoint (prototype).png')],
    Fake_Arcade: [file('Donkey Kong (US set 1).png'), file('Donkey Kong (US set 2).png'), file('Galaga (Namco).png')],
  });
  await withProject({
    'roms/neogeo/viewpoin.zip': 'x', 'roms/arcade/dkong.zip': 'x', 'roms/arcade/galaga.zip': 'x', 'roms/arcade/pacman.zip': 'x',
    'data/titles.json': JSON.stringify({ viewpoin: 'Viewpoint', dkong: 'Donkey Kong', galaga: 'Galaga', pacman: 'Pac-Man' }),
  }, async (root) => {
    const out = await runCovers({ root, net: gh.net });
    assert.deepEqual(out.summary.found.map((f) => [f.file, f.source]), [['neogeo/viewpoin.png', 'Viewpoint.png'], ['arcade/galaga.png', 'Galaga (Namco).png']]);
    assert.deepEqual(out.summary.ambiguous.map((a) => a.title), ['Donkey Kong']);
    assert.deepEqual(out.summary.notFound, ['Pac-Man']);
  });
});

test('runCovers : jeu à plusieurs disquettes = une seule pochette, au nom de sa première disquette', async () => {
  const gh = fakeGithub({ Fake_Amiga: [file('Monkey Island (Europe).png')], Fake_NeoGeo: [], Fake_Arcade: [] });
  await withProject({
    'roms/amiga/Monkey Island (Disk 1 of 2).adf': 'x', 'roms/amiga/Monkey Island (Disk 2 of 2).adf': 'x',
  }, async (root) => {
    const out = await runCovers({ root, net: gh.net });
    assert.deepEqual(out.summary.found.map((f) => f.file), ['amiga/Monkey Island (Disk 1 of 2).png']);
    const games = await gamesJson(root);
    assert.equal(games.length, 1);
    assert.equal(games[0].cover, 'roms/amiga/Monkey Island (Disk 1 of 2).png');
    assert.equal(gh.calls.bytes.length, 1);
  });
});

test('runCovers : jeu décrit par un .m3u = pochette au nom du .m3u', async () => {
  const gh = fakeGithub({ Fake_Amiga: [file('Zaxxon.png')], Fake_NeoGeo: [], Fake_Arcade: [] });
  await withProject({ 'roms/amiga/Zaxxon.m3u': 'Zaxxon 1.adf\nZaxxon 2.adf\n', 'roms/amiga/Zaxxon 1.adf': 'x', 'roms/amiga/Zaxxon 2.adf': 'x' }, async (root) => {
    const out = await runCovers({ root, net: gh.net });
    assert.deepEqual(out.summary.found.map((f) => f.file), ['amiga/Zaxxon.png']);
    assert.equal((await gamesJson(root))[0].cover, 'roms/amiga/Zaxxon.png');
  });
});

test('runCovers : machine sans thumbnailsRepo = ignorée et signalée ; erreur de liste d\'une machine = les autres continuent', async () => {
  const gh = fakeGithub({ Fake_Amiga: [file('Gods.png')], Fake_Arcade: [] }); // Fake_NeoGeo absent : 404
  await withProject({ 'roms/amiga/Gods.adf': 'x', 'roms/nes/Mario.nes': 'x', 'roms/neogeo/viewpoin.zip': 'x' }, async (root) => {
    const out = await runCovers({ root, net: gh.net });
    assert.deepEqual(out.summary.noRepo, ['NES']);
    assert.equal(out.summary.listingErrors[0].system, 'Neo Geo');
    assert.equal(out.summary.found.length, 1);
  });
});

test('runCovers : la liste d\'un dépôt est mise en cache dans un fichier local (pas de nouvelle requête de liste au 2e passage), --refresh la relit', async () => {
  const gh = fakeGithub({ Fake_Amiga: [file('Gods.png')], Fake_NeoGeo: [], Fake_Arcade: [] });
  await withProject({ 'roms/amiga/Gods.adf': 'x', 'roms/amiga/Zaxxon.adf': 'x' }, async (root) => {
    await runCovers({ root, now: FIXED_DATE, net: gh.net });
    assert.equal(gh.calls.json.length, 2);
    assert.equal(await exists(join(root, COVERS_CACHE_FILE)), true);
    await runCovers({ root, now: new Date(FIXED_DATE.getTime() + 3600e3), net: gh.net });
    assert.equal(gh.calls.json.length, 2);
    await runCovers({ root, now: new Date(FIXED_DATE.getTime() + 3600e3), net: gh.net, refresh: true });
    assert.equal(gh.calls.json.length, 4);
    await runCovers({ root, now: new Date(FIXED_DATE.getTime() + 30 * 24 * 3600e3), net: gh.net });
    assert.equal(gh.calls.json.length, 6, 'cache périmé après 7 jours');
  });
});

test('le fichier de cache est ignoré par git', async () => {
  const ignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.ok(ignore.split('\n').includes(COVERS_CACHE_FILE));
});

test('runCovers : la progression est signalée (liste puis jeux traités sur total)', async () => {
  const gh = fakeGithub({ Fake_Amiga: [file('Gods.png')], Fake_NeoGeo: [], Fake_Arcade: [] });
  await withProject({ 'roms/amiga/Gods.adf': 'x', 'roms/amiga/Zaxxon.adf': 'x' }, async (root) => {
    const events = [];
    await runCovers({ root, net: gh.net, onProgress: (e) => events.push(e) });
    assert.equal(events[0].phase, 'listing');
    assert.equal(events[0].system, 'Amiga');
    assert.deepEqual(events.at(-1), { phase: 'downloading', system: undefined, done: 2, total: 2 });
  });
});

test('runCovers : aucun jeu, ou dossier des ROMs vide : rien à faire, aucune requête', async () => {
  const gh = fakeGithub({});
  await withProject({}, async (root) => {
    const out = await runCovers({ root, net: gh.net });
    assert.equal(out.exitCode, 0);
    assert.equal(gh.calls.json.length, 0);
  });
});

test('formatSummary : résumé en français (trouvées, déjà présentes, introuvables, ambiguës)', () => {
  const summary = {
    found: [{ title: 'Gods', file: 'amiga/Gods.png', source: 'Gods.png' }], alreadyHave: 2, notFound: ['X'],
    ambiguous: [{ title: 'Y', options: ['Y (a).png', 'Y (b).png'] }], failed: [{ title: 'Z', reason: 'image de plus de 2 Mo' }],
    listingErrors: [{ system: 'Neo Geo', reason: 'limite de requêtes de GitHub atteinte' }], noRepo: ['NES'],
  };
  const text = formatSummary({ summary, dryRun: false }).join('\n');
  assert.match(text, /Pochettes téléchargées : 1/);
  assert.match(text, /Déjà présentes : 2/);
  assert.match(text, /Introuvables : 1/);
  assert.match(text, /Ambiguës \(rien téléchargé\) : 1/);
  assert.match(text, /Ambiguë : Y/);
  assert.match(text, /Neo Geo/);
  assert.match(formatSummary({ summary, dryRun: true }).join('\n'), /qui seraient téléchargées : 1/);
  assert.ok(!formatSummary({ summary, dryRun: false }, { details: false }).join('\n').includes('Ambiguë : Y'));
});
