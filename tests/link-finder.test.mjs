// Tests de js/link-finder.js (T34) : adresse saisie, liens d'une page, fichiers reconnus, machine devinée, contrôle d'un choix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/project-root.mjs';
import {
  checkPageAddress, extractLinks, fileNameFromUrl, classifyFile, guessSystemFromPath, findDownloadableFiles, checkDownloadItem, decodeEntities, MAX_FILES,
} from '../js/link-finder.js';

const { systems } = JSON.parse(readFileSync(join(PROJECT_ROOT, 'systems.json'), 'utf8'));
const PAGE = 'https://exemple.org/dossier/page.html';

test('T34 adresse saisie : https ajouté si absent, ancre retirée, espaces ignorés', () => {
  assert.deepEqual(checkPageAddress('  exemple.org/jeux  '), { ok: true, url: 'https://exemple.org/jeux' });
  assert.deepEqual(checkPageAddress('http://exemple.org/a#b'), { ok: true, url: 'http://exemple.org/a' });
});

test('T34 adresse saisie : vide, trop longue, autre protocole, identifiants ou illisible : refusée avec un message', () => {
  for (const bad of ['', '   ', null, `https://a.org/${'x'.repeat(2100)}`, 'ftp://a.org/x', 'javascript:alert(1)', 'file:///etc/passwd',
    'data:text/html,x', 'https://moi:secret@a.org/', 'https://', 'http://[::1']) {
    const r = checkPageAddress(bad);
    assert.equal(r.ok, false, String(bad));
    assert.ok(r.message.length > 0);
  }
});

test('T34 parseur de liens : href et src, guillemets doubles, simples ou absents, adresses relatives résolues', () => {
  const html = `<a href="jeu1.adf">1</a><a href='/racine/jeu2.zip'>2</a><a href=jeu3.nes>3</a><img src="../img/x.png">
    <A HREF="https://autre.org/y.sms">y</A>`;
  assert.deepEqual(extractLinks(html, PAGE), [
    'https://exemple.org/dossier/jeu1.adf', 'https://exemple.org/racine/jeu2.zip', 'https://exemple.org/dossier/jeu3.nes',
    'https://exemple.org/img/x.png', 'https://autre.org/y.sms',
  ]);
});

test('T34 parseur de liens : entités décodées, ancres retirées, doublons supprimés, javascript:, mailto: et data: ignorés', () => {
  const html = '<a href="a.zip?x=1&amp;y=2">a</a><a href="a.zip?x=1&#38;y=2#haut">a</a><a href="javascript:void(0)">j</a>'
    + '<a href="mailto:a@b.c">m</a><a href="data:text/plain,x">d</a><a href="">vide</a><a href="#ancre">ancre</a>';
  assert.deepEqual(extractLinks(html, PAGE), ['https://exemple.org/dossier/a.zip?x=1&y=2', PAGE]);
  assert.equal(decodeEntities('&lt;&#x41;&unknown;&#0;'), '<A&unknown;&#0;');
});

test('T34 parseur de liens : la balise <base> change la racine des adresses relatives', () => {
  const html = '<base href="https://miroir.org/fichiers/"><a href="jeu.adf">j</a>';
  assert.deepEqual(extractLinks(html, PAGE), ['https://miroir.org/fichiers/jeu.adf']);
});

test('T34 parseur de liens : page vide, non HTML ou mal formée : aucune exception', () => {
  assert.deepEqual(extractLinks('', PAGE), []);
  assert.deepEqual(extractLinks(undefined, PAGE), []);
  assert.deepEqual(extractLinks('<a href="http://[bad">x</a><a href=', PAGE), []);
});

test('T34 nom de fichier : dernier segment décodé, sans point initial ni caractère de contrôle', () => {
  assert.equal(fileNameFromUrl('https://a.org/x/Mon%20Jeu%20(1990).zip?dl=1'), 'Mon Jeu (1990).zip');
  assert.equal(fileNameFromUrl('https://a.org/x/..%2F..%2Fetc%2Fpasswd'), 'etcpasswd');
  assert.equal(fileNameFromUrl('https://a.org/x/.cache.zip'), 'cache.zip');
  assert.equal(fileNameFromUrl('https://a.org/x/'), null);
  assert.equal(fileNameFromUrl('https://a.org/x/%E0%A4%A'), null);
});

test('T34 fichiers reconnus : seules les extensions de systems.json sont proposées (image, page, .exe ignorées)', () => {
  const html = '<a href="a.adf">a</a><a href="b.png">b</a><a href="c.html">c</a><a href="d.exe">d</a><a href="e.SFC">e</a><a href="dossier/">f</a>';
  const { files } = findDownloadableFiles(html, PAGE, systems);
  assert.deepEqual(files.map((f) => [f.name, f.kind, f.target]), [['a.adf', 'rom', 'amiga'], ['e.SFC', 'rom', 'snes']]);
});

test('T34 fichiers reconnus : un nom de BIOS déclaré est un BIOS, avec le nom exact attendu, même en .zip', () => {
  assert.deepEqual(classifyFile('https://a.org/NEOGEO.ZIP', systems), { name: 'neogeo.zip', kind: 'bios', target: 'bios', candidates: [] });
  assert.equal(classifyFile('https://a.org/bios/KICK40068.a1200', systems).name, 'kick40068.A1200');
});

test('T34 machine devinée : extension propre à une machine, sinon mot du chemin, sinon à choisir', () => {
  assert.equal(classifyFile('https://a.org/x/sonic.md', systems).target, 'megadrive');
  assert.equal(classifyFile('https://a.org/Amiga/Jeux/lemmings.zip', systems).target, 'amiga');
  assert.equal(classifyFile('https://a.org/roms/Game%20Boy%20Color/zelda.zip', systems).target, 'gameboycolor');
  assert.equal(classifyFile('https://a.org/neo-geo/mslug.zip', systems).target, 'neogeo');
  const unknown = classifyFile('https://a.org/telechargements/jeu.zip', systems);
  assert.equal(unknown.target, null);
  assert.ok(unknown.candidates.includes('amiga') && unknown.candidates.includes('snes'));
});

test('T34 machine devinée : mots entiers seulement (« genesis » ne donne pas la NES), le plus long gagne', () => {
  const zip = systems.filter((s) => s.extensions.includes('zip'));
  assert.equal(guessSystemFromPath('https://a.org/genesis/x.zip', zip), null);
  assert.equal(guessSystemFromPath('https://a.org/snes/x.zip', zip), 'snes');
  assert.equal(guessSystemFromPath('https://a.org/game-boy/x.zip', zip), 'gameboy');
  assert.equal(guessSystemFromPath('https://a.org/PC_Engine/x.zip', zip), 'pcengine');
  assert.equal(guessSystemFromPath('https://a.org/Mega-CD/x.zip', zip), 'megacd');
});

test('T34 fichiers reconnus : au plus MAX_FILES, avec l\'indication que la liste est coupée', () => {
  const html = Array.from({ length: MAX_FILES + 3 }, (_, i) => `<a href="j${i}.adf">`).join('');
  const r = findDownloadableFiles(html, PAGE, systems);
  assert.equal(r.files.length, MAX_FILES);
  assert.equal(r.truncated, true);
});

test('T34 choix de téléchargement : la machine doit accepter l\'extension, un BIOS doit porter un nom déclaré', () => {
  assert.deepEqual(checkDownloadItem({ url: 'https://a.org/x.adf', target: 'amiga' }, systems), { ok: true, url: 'https://a.org/x.adf', name: 'x.adf', target: 'amiga' });
  assert.equal(checkDownloadItem({ url: 'https://a.org/x.adf', target: 'snes' }, systems).ok, false);
  assert.equal(checkDownloadItem({ url: 'https://a.org/x.adf', target: 'bios' }, systems).ok, false);
  assert.equal(checkDownloadItem({ url: 'https://a.org/x.adf', target: 'inconnue' }, systems).ok, false);
  assert.equal(checkDownloadItem({ url: 'https://a.org/x.exe', target: 'amiga' }, systems).ok, false);
  assert.equal(checkDownloadItem({ url: 'a.org/x.adf', target: 'amiga' }, systems).ok, false, 'protocole explicite exigé');
  assert.equal(checkDownloadItem({ url: 'ftp://a.org/x.adf', target: 'amiga' }, systems).ok, false);
  assert.equal(checkDownloadItem(null, systems).ok, false);
  assert.deepEqual(checkDownloadItem({ url: 'https://a.org/GB_BIOS.BIN', target: 'bios' }, systems).name, 'gb_bios.bin');
});
