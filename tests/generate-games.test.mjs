// Tests de scripts/generate-games.mjs (T2) sur de faux fichiers dans un dossier temporaire (aucune ROM réelle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  cleanTitle, makeId, resolveTitle, parseM3u, readSystems, generateGames, runGenerate,
} from '../scripts/generate-games.mjs';

const FIXED_DATE = new Date('2026-11-09T21:00:00.000Z');

/** Crée un projet factice : systems.json réel copié, plus les fichiers donnés (chemin -> contenu). */
async function makeProject(files = {}, { withSystems = true } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'clone90-gen-'));
  if (withSystems) await copyFile(new URL('../systems.json', import.meta.url), join(root, 'systems.json'));
  for (const [rel, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, rel)), { recursive: true });
    await writeFile(join(root, rel), content);
  }
  return root;
}
const gamesOf = async (root, options = {}) => (await generateGames({ root, now: FIXED_DATE, ...options })).games;
const withProject = async (files, fn, opts) => {
  const root = await makeProject(files, opts);
  try { return await fn(root); } finally { await rm(root, { recursive: true, force: true }); }
};

test('cleanTitle : retire extension, étiquettes entre parenthèses ou crochets, _ devient espace', () => {
  assert.equal(cleanTitle('Lemmings (Europe) [!]'), 'Lemmings');
  assert.equal(cleanTitle('Super_Mario_World'), 'Super Mario World');
  assert.equal(cleanTitle('  Sonic   the  Hedgehog  (USA)'), 'Sonic the Hedgehog');
});

test('cleanTitle : si tout est retiré, retombe sur le nom d\'origine', () => {
  assert.equal(cleanTitle('(Europe)'), '(Europe)');
  assert.equal(cleanTitle(''), '');
});

test('makeId : machine/nom en minuscules, espaces remplacés par _', () => {
  assert.equal(makeId('amiga', 'Lemmings 2'), 'amiga/lemmings_2');
  assert.equal(makeId('neogeo', 'MSLUG'), 'neogeo/mslug');
});

test('resolveTitle : surcharge titles.json (insensible à la casse), sinon titre nettoyé', () => {
  const titles = { mslug: 'Metal Slug' };
  assert.equal(resolveTitle('mslug', titles), 'Metal Slug');
  assert.equal(resolveTitle('MSLUG', titles), 'Metal Slug');
  assert.equal(resolveTitle('kof98', titles), 'kof98');
  assert.equal(resolveTitle('Lemmings (Europe)', titles), 'Lemmings');
  assert.equal(resolveTitle('x', null), 'x');
});

test('resolveTitle : clés dangereuses (__proto__, constructor) sans effet', () => {
  assert.equal(resolveTitle('constructor', {}), 'constructor');
  assert.equal(resolveTitle('__proto__', {}), 'proto'); // _ devient espace
  assert.equal(resolveTitle('__proto__', JSON.parse('{"__proto__":"Piégé"}')), 'Piégé'); // clé propre légitime
});

test('parseM3u : ignore commentaires, lignes vides, BOM ; accepte \\ comme séparateur', () => {
  const text = '﻿#EXTM3U\n\nDisk 1.adf\r\n  sub\\Disk 2.adf  \n# fin\n';
  assert.deepEqual(parseM3u(text), ['Disk 1.adf', 'sub/Disk 2.adf']);
});

test('readSystems : lit systems.json (seule source de vérité)', async () => {
  await withProject({}, async (root) => {
    const systems = await readSystems(root);
    assert.ok(systems.some((s) => s.id === 'amiga'));
  });
});

test('readSystems : systems.json absent ou invalide lève une erreur claire', async () => {
  await withProject({}, async (root) => {
    await assert.rejects(readSystems(root), /systems\.json/);
  }, { withSystems: false });
  await withProject({ 'systems.json': '{pas du json' }, async (root) => {
    await assert.rejects(readSystems(root), /systems\.json/);
  }, { withSystems: false });
  await withProject({ 'systems.json': '{"version":1}' }, async (root) => {
    await assert.rejects(readSystems(root), /systems\.json/);
  }, { withSystems: false });
});

test('games.json conforme au schéma 6.2 : id, system, title, file, cover', async () => {
  await withProject({
    'roms/neogeo/mslug.zip': 'x', 'roms/neogeo/mslug.png': 'x',
    'roms/amiga/Lemmings (Europe).adf': 'x',
    'data/titles.json': JSON.stringify({ mslug: 'Metal Slug' }),
  }, async (root) => {
    const out = await generateGames({ root, now: FIXED_DATE });
    assert.equal(out.version, 1);
    assert.equal(out.generatedAt, '2026-11-09T21:00:00.000Z');
    assert.deepEqual(out.games, [
      { id: 'amiga/lemmings_(europe)', system: 'amiga', title: 'Lemmings', file: 'roms/amiga/Lemmings (Europe).adf', cover: null },
      { id: 'neogeo/mslug', system: 'neogeo', title: 'Metal Slug', file: 'roms/neogeo/mslug.zip', cover: 'roms/neogeo/mslug.png' },
    ]);
  });
});

test('dossier roms absent : aucun jeu, aucune erreur', async () => {
  await withProject({}, async (root) => {
    assert.deepEqual(await gamesOf(root), []);
  });
});

test('machine sans dossier : ignorée ; machine inconnue de systems.json : ignorée', async () => {
  await withProject({ 'roms/amiga/a.adf': 'x', 'roms/dreamcast/b.gdi': 'x' }, async (root) => {
    assert.deepEqual((await gamesOf(root)).map((g) => g.id), ['amiga/a']);
  });
});

test('extension inconnue : fichier ignoré avec avertissement ; extension insensible à la casse', async () => {
  await withProject({ 'roms/amiga/a.ADF': 'x', 'roms/amiga/notes.txt': 'x' }, async (root) => {
    const out = await generateGames({ root, now: FIXED_DATE });
    assert.deepEqual(out.games.map((g) => g.file), ['roms/amiga/a.ADF']);
    assert.ok(out.warnings.some((w) => w.includes('notes.txt')));
  });
});

test('extensions lues dans systems.json : zip accepté pour neogeo, adf refusé', async () => {
  await withProject({ 'roms/neogeo/a.zip': 'x', 'roms/neogeo/b.adf': 'x' }, async (root) => {
    assert.deepEqual((await gamesOf(root)).map((g) => g.id), ['neogeo/a']);
  });
});

test('fichiers cachés ignorés (fichier, dossier, ._ de macOS)', async () => {
  await withProject({
    'roms/amiga/.DS_Store': 'x', 'roms/amiga/._a.adf': 'x', 'roms/amiga/.cache/b.adf': 'x', 'roms/amiga/c.adf': 'x',
  }, async (root) => {
    assert.deepEqual((await gamesOf(root)).map((g) => g.id), ['amiga/c']);
  });
});

test('.m3u : les disques cités ne sont pas listés, le .m3u devient le jeu', async () => {
  await withProject({
    'roms/amiga/Mon Jeu.m3u': '#EXTM3U\nMon Jeu (Disk 1).adf\nMon Jeu (Disk 2).adf\n',
    'roms/amiga/Mon Jeu (Disk 1).adf': 'x', 'roms/amiga/Mon Jeu (Disk 2).adf': 'x',
    'roms/amiga/Autre.adf': 'x',
  }, async (root) => {
    const games = await gamesOf(root);
    assert.deepEqual(games.map((g) => g.file), ['roms/amiga/Autre.adf', 'roms/amiga/Mon Jeu.m3u']);
  });
});

test('.m3u dans un sous-dossier : chemins relatifs au .m3u, citation insensible à la casse', async () => {
  await withProject({
    'roms/amiga/jeu/jeu.m3u': 'DISK1.ADF\n',
    'roms/amiga/jeu/disk1.adf': 'x',
  }, async (root) => {
    assert.deepEqual((await gamesOf(root)).map((g) => g.file), ['roms/amiga/jeu/jeu.m3u']);
  });
});

test('.m3u citant un fichier absent ou vide : pas de plantage', async () => {
  await withProject({ 'roms/amiga/a.m3u': 'absent.adf\n', 'roms/amiga/b.m3u': '' }, async (root) => {
    assert.equal((await gamesOf(root)).length, 2);
  });
});

test('un seul niveau de sous-dossier est parcouru', async () => {
  await withProject({ 'roms/amiga/s/a.adf': 'x', 'roms/amiga/s/t/b.adf': 'x' }, async (root) => {
    assert.deepEqual((await gamesOf(root)).map((g) => g.id), ['amiga/a']);
  });
});

test('jaquette : image de même nom (png, jpg, jpeg, webp), sinon null ; png prioritaire', async () => {
  await withProject({
    'roms/amiga/a.adf': 'x', 'roms/amiga/a.webp': 'x', 'roms/amiga/a.JPG': 'x',
    'roms/amiga/b.adf': 'x', 'roms/amiga/c.adf': 'x', 'roms/amiga/c.png': 'x',
  }, async (root) => {
    const byId = Object.fromEntries((await gamesOf(root)).map((g) => [g.id, g.cover]));
    assert.equal(byId['amiga/a'], 'roms/amiga/a.JPG');
    assert.equal(byId['amiga/b'], null);
    assert.equal(byId['amiga/c'], 'roms/amiga/c.png');
  });
});

test('les images ne sont pas des jeux et ne déclenchent pas d\'avertissement', async () => {
  await withProject({ 'roms/amiga/a.adf': 'x', 'roms/amiga/a.png': 'x', 'bios/kick40068.A1200': 'x' }, async (root) => {
    const out = await generateGames({ root, now: FIXED_DATE });
    assert.equal(out.games.length, 1);
    assert.deepEqual(out.warnings, []);
  });
});

test('surcharge de BIOS : fichier <nom>.bios à côté du jeu (première ligne)', async () => {
  await withProject({
    'roms/amiga/a.adf': 'x', 'roms/amiga/a.bios': 'kick34005.A500\nignoré\n', 'roms/amiga/b.adf': 'x',
  }, async (root) => {
    const games = await gamesOf(root);
    assert.equal(games[0].bios, 'kick34005.A500');
    assert.equal('bios' in games[1], false);
  });
});

test('caractères spéciaux : accents, espaces, # % & apostrophe, emoji', async () => {
  await withProject({
    "roms/amiga/L'Île d'été #1 100% & co 🎮.adf": 'x', 'roms/amiga/Été.adf': 'x',
  }, async (root) => {
    const games = await gamesOf(root);
    assert.equal(games.length, 2);
    assert.ok(games.some((g) => g.file === "roms/amiga/L'Île d'été #1 100% & co 🎮.adf"));
    assert.ok(games.every((g) => !g.file.includes('\\') && g.id.startsWith('amiga/')));
    assert.ok(games.every((g) => !/\s/.test(g.id.slice('amiga/'.length))));
  });
});

test('titles.json absent : titres issus du nom de fichier ; invalide : avertissement', async () => {
  await withProject({ 'roms/neogeo/mslug.zip': 'x' }, async (root) => {
    assert.equal((await gamesOf(root))[0].title, 'mslug');
  });
  await withProject({ 'roms/neogeo/mslug.zip': 'x', 'data/titles.json': '{cassé' }, async (root) => {
    const out = await generateGames({ root, now: FIXED_DATE });
    assert.equal(out.games[0].title, 'mslug');
    assert.ok(out.warnings.some((w) => w.includes('titles.json')));
  });
});

test('data/titles.json livré : contient mslug -> Metal Slug et seulement des chaînes', async () => {
  const titles = JSON.parse(await readFile(new URL('../data/titles.json', import.meta.url), 'utf8'));
  assert.equal(titles.mslug, 'Metal Slug');
  assert.ok(Object.values(titles).every((v) => typeof v === 'string' && v.length > 0));
});

test('tri stable : par machine (order), puis titre (numérique, accents), puis fichier', async () => {
  await withProject({
    'roms/neogeo/zz.zip': 'x', 'roms/amiga/Jeu 10.adf': 'x', 'roms/amiga/Jeu 2.adf': 'x',
    'roms/amiga/Été.adf': 'x', 'roms/amiga/Zèbre.adf': 'x', 'roms/amiga/Ab.adf': 'x',
  }, async (root) => {
    assert.deepEqual((await gamesOf(root)).map((g) => g.title), ['Ab', 'Été', 'Jeu 2', 'Jeu 10', 'Zèbre', 'zz']);
  });
});

test('doublon d\'id : un seul jeu gardé (premier fichier dans l\'ordre alphabétique) et avertissement', async () => {
  await withProject({ 'roms/amiga/Jeu.adf': 'x', 'roms/amiga/jeu.zip': 'x' }, async (root) => {
    const out = await generateGames({ root, now: FIXED_DATE });
    assert.equal(out.games.length, 1);
    assert.ok(out.warnings.some((w) => w.includes('amiga/jeu')));
  });
});

test('sortie déterministe : deux générations identiques, octet pour octet', async () => {
  await withProject({ 'roms/amiga/b.adf': 'x', 'roms/amiga/a.adf': 'x', 'roms/neogeo/c.zip': 'x' }, async (root) => {
    await runGenerate({ root, now: FIXED_DATE, log: () => {} });
    const first = await readFile(join(root, 'games.json'), 'utf8');
    await runGenerate({ root, now: FIXED_DATE, log: () => {} });
    assert.equal(await readFile(join(root, 'games.json'), 'utf8'), first);
    assert.ok(first.endsWith('\n'));
  });
});

test('avertissement si BIOS requis absent de bios/ (seulement pour une machine qui a des jeux)', async () => {
  await withProject({ 'roms/amiga/a.adf': 'x' }, async (root) => {
    const out = await generateGames({ root, now: FIXED_DATE });
    assert.ok(out.warnings.some((w) => w.includes('kick40068.A1200')));
    assert.ok(!out.warnings.some((w) => w.includes('neogeo.zip')));
  });
  await withProject({ 'roms/amiga/a.adf': 'x', 'bios/kick40068.A1200': 'x' }, async (root) => {
    const out = await generateGames({ root, now: FIXED_DATE });
    assert.deepEqual(out.warnings, []);
  });
});

test('runGenerate : écrit games.json de façon atomique (aucun fichier temporaire restant)', async () => {
  await withProject({ 'roms/amiga/a.adf': 'x' }, async (root) => {
    const result = await runGenerate({ root, now: FIXED_DATE, log: () => {} });
    assert.equal(result.exitCode, 0);
    assert.deepEqual((await readdir(root)).filter((n) => n.includes('tmp')), []);
    assert.equal(JSON.parse(await readFile(join(root, 'games.json'), 'utf8')).games.length, 1);
  });
});

test('runGenerate --check : n\'écrit rien', async () => {
  await withProject({ 'roms/amiga/a.adf': 'x' }, async (root) => {
    const lines = [];
    const result = await runGenerate({ root, check: true, now: FIXED_DATE, log: (l) => lines.push(l) });
    assert.equal(result.exitCode, 0);
    assert.ok(!(await readdir(root)).includes('games.json'));
    assert.ok(lines.join('\n').includes('Amiga'));
  });
});

test('runGenerate : systems.json illisible donne le code de sortie 1 et n\'écrit rien', async () => {
  await withProject({}, async (root) => {
    const errors = [];
    const result = await runGenerate({ root, now: FIXED_DATE, log: () => {}, logError: (l) => errors.push(l) });
    assert.equal(result.exitCode, 1);
    assert.ok(errors.join('').includes('systems.json'));
    assert.ok(!(await readdir(root)).includes('games.json'));
  }, { withSystems: false });
});
