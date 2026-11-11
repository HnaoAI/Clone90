// Tests de scripts/generate-games.mjs (T2) sur de faux fichiers dans un dossier temporaire (aucune ROM réelle).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  cleanTitle, makeId, resolveTitle, parseM3u, parseCue, parseLooseDiskTag, parseDiskTag, readSystems, generateGames, runGenerate, pickSystemDir,
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

// --- T0 : casse du dossier de machine (Hicham a roms/Amiga/ ; macOS l'accepte, Linux non) et noms de style TOSEC ---
test('cleanTitle : nom TOSEC/No-Intro (année, éditeur, disque, crack) donne le titre seul', () => {
  assert.equal(cleanTitle('Leander (1991)(Psygnosis)(Disk 1 of 3)[cr Flashtro]'), 'Leander');
});

test('dossier de machine retrouvé sans tenir compte de la casse, chemins de games.json = chemins réels', async () => {
  await withProject({ 'roms/Amiga/Leander (1991)(Psygnosis)(Disk 1 of 3)[cr Flashtro].adf': 'x', 'roms/Amiga/Autre.adf': 'x' }, async (root) => {
    const games = await gamesOf(root);
    assert.deepEqual(games.map((g) => g.title), ['Autre', 'Leander']);
    const leander = games.find((g) => g.title === 'Leander');
    assert.equal(leander.system, 'amiga');
    assert.ok(leander.id.startsWith('amiga/'), 'l\'id garde l\'id de la machine en minuscules');
    assert.equal(leander.file, 'roms/Amiga/Leander (1991)(Psygnosis)(Disk 1 of 3)[cr Flashtro].adf');
    const dir = await readdir(join(root, 'roms'));
    assert.deepEqual(dir, ['Amiga'], 'le dossier de l\'utilisateur n\'est pas renommé');
  });
});

test('pickSystemDir : casse exacte préférée, sinon premier nom égal sans tenir compte de la casse (tri stable), sinon l\'id', () => {
  assert.equal(pickSystemDir(['Amiga', 'amiga'], 'amiga'), 'amiga');
  assert.equal(pickSystemDir(['neogeo', 'Amiga'], 'amiga'), 'Amiga');
  assert.equal(pickSystemDir(['b', 'AMIGA', 'Amiga'], 'amiga'), 'AMIGA');
  assert.equal(pickSystemDir(['neogeo'], 'amiga'), 'amiga');
  assert.equal(pickSystemDir([], 'amiga'), 'amiga');
});

// --- T10 : jeux multi-disquettes (convention TOSEC/No-Intro "Disk N of M") ---

const diskWarnings = (result) => result.warnings.filter((w) => !w.includes('BIOS requis')); // le BIOS Amiga n'existe pas dans le dossier factice
const LEANDER = (n, flag = '[cr Flashtro]') => `roms/amiga/Leander (1991)(Psygnosis)(Disk ${n} of 3)${flag}.adf`;

test('multi-disquettes : trois ADF TOSEC donnent UN jeu avec disks ordonnés et file = disquette 1', async () => {
  await withProject({ [LEANDER(3)]: 'x', [LEANDER(1)]: 'x', [LEANDER(2)]: 'x' }, async (root) => {
    const result = await generateGames({ root, now: FIXED_DATE });
    assert.equal(result.games.length, 1);
    const [game] = result.games;
    assert.equal(game.title, 'Leander');
    assert.equal(game.id, 'amiga/leander_(1991)(psygnosis)');
    assert.equal(game.file, LEANDER(1));
    assert.deepEqual(game.disks, [LEANDER(1), LEANDER(2), LEANDER(3)]);
    assert.deepEqual(diskWarnings(result), []);
  });
});

test('multi-disquettes : l\'ordre est numérique (Disk 10 après Disk 2) et "(Disk N)" sans total est accepté', async () => {
  const files = {};
  for (let n = 1; n <= 10; n++) files[`roms/amiga/Gros Jeu (Disk ${n}).adf`] = 'x';
  await withProject(files, async (root) => {
    const [game] = await gamesOf(root);
    assert.equal(game.disks.length, 10);
    assert.match(game.disks[1], /Disk 2\)/);
    assert.match(game.disks[9], /Disk 10\)/);
  });
});

test('multi-disquettes : forme "Disk N of M" sans parenthèses, jeux voisins non regroupés', async () => {
  await withProject({
    'roms/amiga/Alpha Disk 1 of 2.adf': 'x', 'roms/amiga/Alpha Disk 2 of 2.adf': 'x',
    'roms/amiga/Beta (Disk 1 of 2).adf': 'x', 'roms/amiga/Beta (Disk 2 of 2).adf': 'x', 'roms/amiga/Solo.adf': 'x',
  }, async (root) => {
    const games = await gamesOf(root);
    assert.deepEqual(games.map((g) => [g.title, g.disks?.length ?? 1]), [['Alpha', 2], ['Beta', 2], ['Solo', 1]]);
  });
});

test('multi-disquettes : groupe incomplet (disquette 2 manquante) = avertissement, jeu gardé, pas de plantage', async () => {
  await withProject({ [LEANDER(1)]: 'x', [LEANDER(3)]: 'x' }, async (root) => {
    const result = await generateGames({ root, now: FIXED_DATE });
    assert.equal(result.games.length, 1);
    assert.deepEqual(result.games[0].disks, [LEANDER(1), LEANDER(3)]);
    assert.equal(diskWarnings(result).length, 1);
    assert.match(diskWarnings(result)[0], /Leander.*incomplet.*2/);
  });
});

test('multi-disquettes : une seule disquette sur trois = jeu simple (sans disks) + avertissement', async () => {
  await withProject({ [LEANDER(2)]: 'x' }, async (root) => {
    const result = await generateGames({ root, now: FIXED_DATE });
    assert.equal(result.games[0].disks, undefined);
    assert.equal(result.games[0].file, LEANDER(2));
    assert.match(diskWarnings(result)[0], /incomplet/);
  });
});

test('multi-disquettes : "(Disk 1)" seul, sans total, n\'est pas un groupe incomplet', async () => {
  await withProject({ 'roms/amiga/Seul (Disk 1).adf': 'x' }, async (root) => {
    const result = await generateGames({ root, now: FIXED_DATE });
    assert.deepEqual(diskWarnings(result), []);
    assert.equal(result.games[0].disks, undefined);
  });
});

test('multi-disquettes : doublon de numéro de disquette = avertissement, première variante gardée', async () => {
  await withProject({ [LEANDER(1)]: 'x', [LEANDER(2)]: 'x', [LEANDER(2, '[a]')]: 'x', [LEANDER(3)]: 'x' }, async (root) => {
    const result = await generateGames({ root, now: FIXED_DATE });
    assert.equal(result.games.length, 1);
    assert.equal(result.games[0].disks.length, 3);
    assert.ok(result.warnings.some((w) => /disquette 2/.test(w) && /ignoré/.test(w)));
  });
});

test('multi-disquettes : un .m3u prime (ses disques ne sont pas regroupés), deux dossiers au même nom = doublon d identifiant habituel', async () => {
  await withProject({
    'roms/amiga/Jeu.m3u': 'Jeu (Disk 1 of 2).adf\nJeu (Disk 2 of 2).adf\n',
    'roms/amiga/Jeu (Disk 1 of 2).adf': 'x', 'roms/amiga/Jeu (Disk 2 of 2).adf': 'x',
    'roms/amiga/a/Zed (Disk 1 of 2).adf': 'x', 'roms/amiga/a/Zed (Disk 2 of 2).adf': 'x',
    'roms/amiga/b/Zed (Disk 1 of 2).adf': 'x', 'roms/amiga/b/Zed (Disk 2 of 2).adf': 'x',
  }, async (root) => {
    const result = await generateGames({ root, now: FIXED_DATE });
    assert.deepEqual(result.games.map((g) => g.file), ['roms/amiga/Jeu.m3u', 'roms/amiga/a/Zed (Disk 1 of 2).adf']);
    assert.equal(result.games[0].disks, undefined);
    assert.ok(result.warnings.some((w) => /doublon d'identifiant amiga\/zed/.test(w)));
  });
});

test('multi-disquettes : dossier Amiga (casse) et jaquette / .bios du groupe, titre surchargé par titles.json', async () => {
  await withProject({
    'roms/Amiga/Leander (1991)(Psygnosis)(Disk 1 of 2).adf': 'x', 'roms/Amiga/Leander (1991)(Psygnosis)(Disk 2 of 2).adf': 'x',
    'roms/Amiga/Leander (1991)(Psygnosis)(Disk 1 of 2).png': 'x',
    'roms/Amiga/Leander (1991)(Psygnosis).bios': 'kick34005.A500\n',
    'data/titles.json': JSON.stringify({ 'leander (1991)(psygnosis)': 'Leander (Amiga)' }),
  }, async (root) => {
    const [game] = await gamesOf(root);
    assert.equal(game.title, 'Leander (Amiga)');
    assert.equal(game.cover, 'roms/Amiga/Leander (1991)(Psygnosis)(Disk 1 of 2).png');
    assert.equal(game.bios, 'kick34005.A500');
    assert.equal(game.disks[1], 'roms/Amiga/Leander (1991)(Psygnosis)(Disk 2 of 2).adf');
  });
});

test('multi-disquettes : sortie de games.json inchangée (version 1) pour un jeu simple', async () => {
  await withProject({ 'roms/amiga/Lemmings.adf': 'x' }, async (root) => {
    const [game] = await gamesOf(root);
    assert.equal('disks' in game, false);
  });
});

// --- T15 : .cue et ses fichiers (Mega-CD) = UN jeu ---
const SONIC = 'Sonic CD (USA)';
const cueText = (...names) => `${names.map((n, i) => `FILE "${n}" BINARY\n  TRACK ${String(i + 1).padStart(2, '0')} ${i ? 'AUDIO' : 'MODE1/2352'}\n    INDEX 01 00:00:00`).join('\n')}\n`;

test('T15 parseCue : noms des lignes FILE (avec ou sans guillemets, \\ devient /), rien d\'autre', () => {
  assert.deepEqual(parseCue(cueText('a b.bin', 'Track 02.wav')), ['a b.bin', 'Track 02.wav']);
  assert.deepEqual(parseCue('REM x\r\nFILE disque.bin BINARY\r\nFILE "sous\\dossier.bin" BINARY\r\n'), ['disque.bin', 'sous/dossier.bin']);
  assert.deepEqual(parseCue(''), []);
  assert.deepEqual(parseCue('\uFEFFFILE "x.bin" BINARY'), ['x.bin']);
});

test('T15 cue+bin : un seul jeu, le .bin n\'est pas listé à part, extraFiles porte le .bin', async () => {
  await withProject({
    [`roms/megacd/${SONIC}.cue`]: cueText(`${SONIC}.bin`), [`roms/megacd/${SONIC}.bin`]: 'x', 'roms/megacd/Autre.chd': 'x',
  }, async (root) => {
    const result = await generateGames({ root, now: FIXED_DATE });
    assert.deepEqual(result.games.map((g) => g.file), ['roms/megacd/Autre.chd', `roms/megacd/${SONIC}.cue`]);
    const game = result.games[1];
    assert.equal(game.title, 'Sonic CD');
    assert.deepEqual(game.extraFiles, [{ file: `roms/megacd/${SONIC}.bin`, as: `${SONIC}.bin` }]);
    assert.equal('extraFiles' in result.games[0], false);
    assert.deepEqual(result.warnings, []);
  });
});

test('T15 cue+bin : plusieurs pistes (bin + audio), l\'ordre du .cue est gardé', async () => {
  await withProject({
    'roms/megacd/J.cue': cueText('J (Track 1).bin', 'J (Track 2).wav', 'J (Track 3).wav'),
    'roms/megacd/J (Track 1).bin': 'x', 'roms/megacd/J (Track 2).wav': 'x', 'roms/megacd/J (Track 3).wav': 'x',
  }, async (root) => {
    const games = await gamesOf(root);
    assert.equal(games.length, 1);
    assert.deepEqual(games[0].extraFiles.map((e) => e.as), ['J (Track 1).bin', 'J (Track 2).wav', 'J (Track 3).wav']);
  });
});

test('T15 cue+bin : casse différente et sous-dossier, le nom écrit dans le .cue est gardé dans `as`, le chemin est le vrai', async () => {
  await withProject({
    'roms/megacd/jeu/Jeu.cue': cueText('JEU.BIN'), 'roms/megacd/jeu/jeu.bin': 'x',
  }, async (root) => {
    const [game] = await gamesOf(root);
    assert.deepEqual(game.extraFiles, [{ file: 'roms/megacd/jeu/jeu.bin', as: 'JEU.BIN' }]);
  });
});

test('T15 cue+bin : .bin absent = jeu gardé avec avertissement (le lanceur le signalera), .bin orphelin = ignoré avec avertissement', async () => {
  await withProject({ 'roms/megacd/A.cue': cueText('A.bin'), 'roms/megacd/Orphelin.bin': 'x' }, async (root) => {
    const result = await generateGames({ root, now: FIXED_DATE });
    assert.deepEqual(result.games.map((g) => g.file), ['roms/megacd/A.cue']);
    assert.deepEqual(result.games[0].extraFiles, [{ file: 'roms/megacd/A.bin', as: 'A.bin' }]);
    assert.ok(result.warnings.some((w) => /A\.bin/.test(w) && /introuvable|manquant/.test(w)), result.warnings.join('|'));
    assert.ok(result.warnings.some((w) => /Orphelin\.bin/.test(w) && /non prise en charge/.test(w)));
    assert.equal(result.warnings.some((w) => /A\.bin.*non prise en charge/.test(w)), false);
  });
});

test('T15 cue : un .bin cité ne déclenche pas l\'avertissement « extension non prise en charge »', async () => {
  await withProject({ [`roms/megacd/${SONIC}.cue`]: cueText(`${SONIC}.bin`), [`roms/megacd/${SONIC}.bin`]: 'x' }, async (root) => {
    assert.deepEqual((await generateGames({ root, now: FIXED_DATE })).warnings, []);
  });
});

test('T15 cue : nom avec « Disk 1 » n\'est pas pris pour une disquette (pas de disks), .cue vide ou illisible ne plante pas', async () => {
  await withProject({
    'roms/megacd/X (Disk 1 of 2).cue': cueText('x1.bin'), 'roms/megacd/X (Disk 2 of 2).cue': cueText('x2.bin'),
    'roms/megacd/x1.bin': 'x', 'roms/megacd/x2.bin': 'x', 'roms/megacd/Vide.cue': '',
  }, async (root) => {
    const games = await gamesOf(root);
    assert.equal(games.length, 3);
    assert.ok(games.every((g) => !('disks' in g)));
    assert.equal('extraFiles' in games.find((g) => g.file.endsWith('Vide.cue')), false);
  });
});

test('T15 cue : chemin sortant du dossier (..) ou absolu ignoré, jamais de chemin hors roms/', async () => {
  await withProject({ 'roms/megacd/M.cue': cueText('../../secret.bin', '/etc/passwd') }, async (root) => {
    const [game] = await gamesOf(root);
    assert.equal('extraFiles' in game, false);
  });
});

// --- T18 : noms de disquette sans la forme TOSEC (Leander_Disk1.ipf ...) ---
const LEANDER_DIR = 'Leander (1991)(Psygnosis)[0496]';
const leanderIpf = (n, dir = `roms/Amiga/${LEANDER_DIR}`) => `${dir}/Leander_Disk${n}.ipf`;

test('T18 : les trois fichiers exacts de Hicham (Leander_Disk1..3.ipf dans un sous-dossier) donnent UN jeu « Leander »', async () => {
  await withProject({ [leanderIpf(1)]: 'x', [leanderIpf(2)]: 'x', [leanderIpf(3)]: 'x' }, async (root) => {
    const result = await generateGames({ root, now: FIXED_DATE });
    assert.equal(result.games.length, 1);
    const [game] = result.games;
    assert.equal(game.title, 'Leander');
    assert.equal(game.id, 'amiga/leander');
    assert.equal(game.file, leanderIpf(1));
    assert.deepEqual(game.disks, [leanderIpf(1), leanderIpf(2), leanderIpf(3)]);
    assert.deepEqual(diskWarnings(result).filter((w) => !/IPF/.test(w)), [], 'seul l\'avertissement IPF est attendu');
  });
});

test('T18 : parseLooseDiskTag reconnaît Disk1, Disk_1, Disk-1, Disk 1, _Disk1, Disque1, Disc1, D1 et rend la base', () => {
  for (const stem of ['Leander Disk1', 'Leander_Disk_1', 'Leander-Disk-1', 'Leander Disk 1', 'Leander_Disk1', 'Leander Disque1', 'Leander Disc1', 'Leander_D1', 'Leander D1', 'leander DISK1']) {
    const tag = parseLooseDiskTag(stem);
    assert.equal(tag?.number, 1, stem);
    assert.equal(tag.base.toLowerCase(), 'leander', stem);
  }
});

test('T18 : parseLooseDiskTag garde les parenthèses utiles, retire les [drapeaux], accepte une base vide (nom de dossier utilisé ensuite)', () => {
  assert.deepEqual(parseLooseDiskTag('Leander (1991)(Psygnosis)_Disk2 [a]'), { base: 'Leander (1991)(Psygnosis)', number: 2 });
  assert.deepEqual(parseLooseDiskTag('Disk3'), { base: '', number: 3 });
});

test('T18 contre-exemples : Disk Wars, Disk 0, DiskEditor, Disk1a, D1 collé, Disk 1 of 3 (TOSEC) ne sont pas des étiquettes libres', () => {
  for (const stem of ['Disk Wars', 'Disk 0', 'Leander Disk0', 'Disk Editor 1', 'Leander Disk1a', 'LeanderD1', 'Leander d1', 'Leander', 'Disk 2 Wars', 'Leander Disk 100']) {
    assert.equal(parseLooseDiskTag(stem), null, stem);
  }
});

test('T18 : « Disk Wars » seul ou avec un voisin « Disk Wars 2 » n\'est pas regroupé', async () => {
  await withProject({ 'roms/amiga/Disk Wars.adf': 'x', 'roms/amiga/Disk Wars 2.adf': 'x', 'roms/amiga/Disk Wars 3.adf': 'x' }, async (root) => {
    const games = await gamesOf(root);
    assert.equal(games.length, 3);
    assert.ok(games.every((g) => !('disks' in g)));
  });
});

test('T18 : un seul fichier Disk1 reste un jeu simple, sans avertissement ni disks', async () => {
  await withProject({ 'roms/amiga/Foo_Disk1.adf': 'x' }, async (root) => {
    const result = await generateGames({ root, now: FIXED_DATE });
    assert.equal(result.games.length, 1);
    assert.equal('disks' in result.games[0], false);
    assert.equal(result.games[0].id, 'amiga/foo_disk1');
    assert.deepEqual(diskWarnings(result), []);
  });
});

test('T18 : un seul fichier Disk2 (ne commence pas à 1) reste un jeu simple', async () => {
  await withProject({ 'roms/amiga/Foo_Disk2.adf': 'x' }, async (root) => {
    assert.equal('disks' in (await gamesOf(root))[0], false);
  });
});

test('T18 : numéros non consécutifs (Disk1 et Disk3) ou ne commençant pas à 1 : pas de regroupement, avertissement', async () => {
  for (const numbers of [[1, 3], [2, 3]]) {
    const files = Object.fromEntries(numbers.map((n) => [`roms/amiga/Foo_Disk${n}.adf`, 'x']));
    await withProject(files, async (root) => {
      const result = await generateGames({ root, now: FIXED_DATE });
      assert.equal(result.games.length, 2, numbers.join());
      assert.ok(result.games.every((g) => !('disks' in g)));
      assert.ok(diskWarnings(result).some((w) => /Foo.*non regroup/.test(w)), numbers.join());
    });
  }
});

test('T18 : extensions différentes ou dossiers différents ne sont pas regroupés', async () => {
  await withProject({
    'roms/amiga/Foo_Disk1.adf': 'x', 'roms/amiga/Foo_Disk2.ipf': 'x',
    'roms/amiga/a/Bar_Disk1.adf': 'x', 'roms/amiga/b/Bar_Disk2.adf': 'x',
  }, async (root) => {
    const games = await gamesOf(root);
    assert.equal(games.length, 4);
    assert.ok(games.every((g) => !('disks' in g)));
  });
});

test('T18 : noms de base différents ne sont pas regroupés (Foo_Disk1 + Bar_Disk2)', async () => {
  await withProject({ 'roms/amiga/Foo_Disk1.adf': 'x', 'roms/amiga/Bar_Disk2.adf': 'x' }, async (root) => {
    assert.equal((await gamesOf(root)).length, 2);
  });
});

test('T18 : toutes les écritures (Disk 1, Disk-1, Disque1, Disc1, D1) regroupent à la racine de la machine, ordre numérique, Disk 10 après Disk 2', async () => {
  const forms = { 'Foo Disk %n.adf': 'Foo', 'Foo-Disk-%n.adf': 'Foo', 'Foo_Disque%n.adf': 'Foo', 'Foo Disc%n.adf': 'Foo', 'Foo_D%n.adf': 'Foo' };
  for (const pattern of Object.keys(forms)) {
    const files = {};
    for (let n = 1; n <= 10; n++) files[`roms/amiga/${pattern.replace('%n', n)}`] = 'x';
    await withProject(files, async (root) => {
      const games = await gamesOf(root);
      assert.equal(games.length, 1, pattern);
      assert.equal(games[0].title, 'Foo');
      assert.equal(games[0].disks.length, 10);
      assert.equal(games[0].disks[9], `roms/amiga/${pattern.replace('%n', 10)}`);
    });
  }
});

test('T18 : « D1 » seul, collé au nom ou sans suite 1..n, n\'est pas regroupé', async () => {
  await withProject({ 'roms/amiga/Foo_D1.adf': 'x', 'roms/amiga/FooD2.adf': 'x', 'roms/amiga/Bar D1.adf': 'x', 'roms/amiga/Bar D3.adf': 'x' }, async (root) => {
    const games = await gamesOf(root);
    assert.equal(games.length, 4);
    assert.ok(games.every((g) => !('disks' in g)));
  });
});

test('T18 : nom vide après retrait du numéro (Disk1.adf, Disk2.adf dans un dossier) : titre = nom du dossier nettoyé', async () => {
  await withProject({ 'roms/amiga/Super Jeu (1992)(Editeur)/Disk1.adf': 'x', 'roms/amiga/Super Jeu (1992)(Editeur)/Disk2.adf': 'x' }, async (root) => {
    const [game] = await gamesOf(root);
    assert.equal(game.title, 'Super Jeu');
    assert.equal(game.disks.length, 2);
  });
});

test('T18 : Disk1.adf, Disk2.adf directement à la racine de la machine (aucun dossier) : pas de regroupement (aucun titre possible)', async () => {
  await withProject({ 'roms/amiga/Disk1.adf': 'x', 'roms/amiga/Disk2.adf': 'x' }, async (root) => {
    const games = await gamesOf(root);
    assert.equal(games.length, 2);
    assert.ok(games.every((g) => !('disks' in g)));
  });
});

test('T18 : jaquette du groupe cherchée sous le nom de la disquette 1 ou de la base', async () => {
  await withProject({ 'roms/amiga/Foo_Disk1.adf': 'x', 'roms/amiga/Foo_Disk2.adf': 'x', 'roms/amiga/Foo.png': 'x' }, async (root) => {
    assert.equal((await gamesOf(root))[0].cover, 'roms/amiga/Foo.png');
  });
});

test('T18 : les règles existantes restent vraies : .m3u prioritaire, doublon de numéro avertit, TOSEC inchangé', async () => {
  await withProject({
    'roms/amiga/Foo.m3u': 'Foo_Disk1.adf\nFoo_Disk2.adf\n', 'roms/amiga/Foo_Disk1.adf': 'x', 'roms/amiga/Foo_Disk2.adf': 'x',
    'roms/amiga/Bar_Disk1.adf': 'x', 'roms/amiga/Bar_Disk1 [a].adf': 'x', 'roms/amiga/Bar_Disk2.adf': 'x',
    [LEANDER(1)]: 'x', [LEANDER(2)]: 'x', [LEANDER(3)]: 'x',
  }, async (root) => {
    const result = await generateGames({ root, now: FIXED_DATE });
    assert.deepEqual(result.games.map((g) => g.title), ['Bar', 'Foo', 'Leander']);
    assert.equal(result.games.find((g) => g.title === 'Bar').disks.length, 2);
    assert.equal('disks' in result.games.find((g) => g.title === 'Foo'), false);
    assert.equal(result.games.find((g) => g.title === 'Leander').disks.length, 3);
    assert.ok(result.warnings.some((w) => /disquette 1/.test(w) && /ignoré/.test(w)));
  });
});

test('T18 : un .cue nommé Disk1 / Disk2 n\'est jamais regroupé', async () => {
  await withProject({ 'roms/megacd/Foo_Disk1.cue': cueText('a.bin'), 'roms/megacd/Foo_Disk2.cue': cueText('b.bin'), 'roms/megacd/a.bin': 'x', 'roms/megacd/b.bin': 'x' }, async (root) => {
    const games = await gamesOf(root);
    assert.equal(games.length, 2);
    assert.ok(games.every((g) => !('disks' in g)));
  });
});

test('T18 : un jeu IPF (ou un groupe de disquettes IPF) est listé mais le générateur avertit que le cœur puae ne le lit pas', async () => {
  await withProject({ [leanderIpf(1)]: 'x', [leanderIpf(2)]: 'x', 'roms/amiga/Autre.ipf': 'x', 'roms/amiga/Bon.adf': 'x' }, async (root) => {
    const result = await generateGames({ root, now: FIXED_DATE });
    assert.equal(result.games.length, 3, 'les IPF restent listés');
    const ipf = diskWarnings(result).filter((w) => /IPF/.test(w));
    assert.equal(ipf.length, 2, 'un avertissement par jeu IPF, pas par fichier');
    assert.ok(ipf.every((w) => /ADF/.test(w)));
    assert.ok(!ipf.some((w) => /Bon/.test(w)));
  });
});

test('T18 diskSets : sur une machine sans diskSets (Master System), Foo_Disk1 / Foo_Disk2 et le format TOSEC ne sont jamais regroupés', async () => {
  await withProject({
    'roms/mastersystem/Foo_Disk1.sms': 'x', 'roms/mastersystem/Foo_Disk2.sms': 'x',
    'roms/mastersystem/Bar (Disk 1 of 2).sms': 'x', 'roms/mastersystem/Bar (Disk 2 of 2).sms': 'x',
  }, async (root) => {
    const result = await generateGames({ root, now: FIXED_DATE });
    assert.equal(result.games.length, 4);
    assert.ok(result.games.every((g) => !('disks' in g)));
    assert.deepEqual(result.warnings.filter((w) => /incomplet|non regroup/.test(w)), []);
  });
});

test('T18 performance : un nom de 5000 caractères est analysé en moins de 200 ms (pas de retour sur trace catastrophique)', () => {
  const started = Date.now();
  for (const stem of [`${'a'.repeat(5000)} Disk ${'1'.repeat(3000)}x`, `${'_ '.repeat(2500)}Disk`, `${'a '.repeat(2500)}Disk 1 ${'('.repeat(2000)}`, `${'(a)'.repeat(1700)}_Disk1`, `${'a'.repeat(5000)}`]) {
    parseLooseDiskTag(stem);
    parseDiskTag(stem);
  }
  assert.ok(Date.now() - started < 200, `trop lent : ${Date.now() - started} ms`);
});
