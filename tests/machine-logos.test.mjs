// Tests de scripts/machine-logos.mjs (T29) : logos des machines téléchargés. AUCUN réseau : faux téléchargements injectés.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  logoUrl, checkSvg, logoTargetPath, runLogos, formatLogosSummary, MAX_LOGO_BYTES, LOGOS_DIR, LOGO_THEME_COMMIT,
} from '../scripts/machine-logos.mjs';
import { generateGames } from '../scripts/generate-games.mjs';

const FIXED_DATE = new Date('2026-11-12T10:00:00.000Z');
const SVG = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="#fff"/></svg>';
const exists = (p) => access(p).then(() => true, () => false);

const SYSTEMS = {
  version: 1,
  systems: [
    { id: 'amiga', name: 'Amiga', order: 10, extensions: ['adf'], logoTheme: 'amiga', bios: [] },
    { id: 'megacd', name: 'Mega-CD', order: 20, extensions: ['cue'], logoTheme: 'segacd', bios: [] },
    { id: 'nes', name: 'NES', order: 30, extensions: ['nes'], bios: [] },
  ],
};

/** Faux GitHub : `bytes(url)` renvoie le contenu ; les adresses demandées sont enregistrées. */
function fakeNet(bytes = () => Buffer.from(SVG)) {
  const calls = [];
  return { calls, net: { fetchBytes: async (url, options) => { calls.push(url); assert.equal(options.maxBytes, MAX_LOGO_BYTES); return bytes(url); } } };
}

async function withProject(files, fn, systems = SYSTEMS) {
  const root = await mkdtemp(join(tmpdir(), 'clone90-logos-'));
  try {
    await writeFile(join(root, 'systems.json'), JSON.stringify(systems));
    for (const [rel, content] of Object.entries(files)) {
      await mkdir(dirname(join(root, rel)), { recursive: true });
      await writeFile(join(root, rel), content);
    }
    return await fn(root);
  } finally { await rm(root, { recursive: true, force: true }); }
}
const readGamesJson = async (root) => JSON.parse(await readFile(join(root, 'games.json'), 'utf8'));

test('logoUrl : seulement raw.githubusercontent.com, thème es-theme-carbon figé sur un commit, dossier contrôlé', () => {
  assert.match(LOGO_THEME_COMMIT, /^[0-9a-f]{40}$/);
  assert.equal(logoUrl('segacd'), `https://raw.githubusercontent.com/RetroPie/es-theme-carbon/${LOGO_THEME_COMMIT}/segacd/art/system.svg`);
  for (const bad of ['../x', 'a/b', 'A B', '', 'x?y', '%2e%2e']) assert.throws(() => logoUrl(bad), /invalide/);
});

test('logoTargetPath : dans le dossier des ROMs, sous clone90-logos/<machine>.svg', () => {
  assert.equal(LOGOS_DIR, 'clone90-logos');
  assert.equal(logoTargetPath('32x'), 'clone90-logos/32x.svg');
  assert.throws(() => logoTargetPath('../x'), /invalide/);
});

test('checkSvg : un vrai logo SVG est accepté (avec ou sans en-tête XML, commentaire, BOM)', () => {
  assert.equal(checkSvg(SVG), null);
  assert.equal(checkSvg('﻿<!-- Inkscape -->\n<svg xmlns="http://www.w3.org/2000/svg"><g id="a"><use xlink:href="#a"/></g></svg>'), null);
  assert.equal(checkSvg('<svg><image href="data:image/png;base64,AAAA"/></svg>'), null);
});

test('checkSvg : l\'en-tête d\'Adobe Illustrator (DOCTYPE et entités internes en texte simple, utilisés par les logos NES et 32X) est accepté', () => {
  const illustrator = '<?xml version="1.0" encoding="utf-8"?>\n<!-- Generator: Adobe Illustrator 13.0.0 -->\n'
    + '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [\n\t<!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">\n]>\n'
    + '<svg xmlns:i="&ns_ai;" xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>';
  assert.equal(checkSvg(illustrator), null);
  for (const bad of ['<!DOCTYPE svg [<!ENTITY a "&b;&b;">]><svg/>', '<!DOCTYPE svg [<!ENTITY % p "x">]><svg/>', '<!DOCTYPE svg [<!ENTITY x PUBLIC "a" "http://exemple.fr/x">]><svg/>']) {
    assert.match(checkSvg(bad) ?? 'accepté à tort', /refusé : entité/, bad);
  }
});

test('checkSvg : refuse ce qui n\'est pas un SVG (page HTML d\'erreur, texte vide)', () => {
  assert.match(checkSvg('<!DOCTYPE html><html><body>404</body></html>'), /SVG/);
  assert.match(checkSvg(''), /SVG/);
  assert.match(checkSvg('juste du texte'), /SVG/);
});

test('checkSvg : refuse script, gestionnaire d\'événement, javascript:, foreignObject, entités et liens externes', () => {
  for (const bad of [
    '<svg><script>alert(1)</script></svg>',
    '<svg><SCRIPT>x</SCRIPT></svg>',
    '<svg onload="alert(1)"></svg>',
    '<svg><rect\nonclick =\'x\'/></svg>',
    '<svg><a href="javascript:alert(1)"><text>x</text></a></svg>',
    '<svg><foreignObject><div/></foreignObject></svg>',
    '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>',
    '<svg><image href="https://exemple.fr/pixel.png"/></svg>',
    '<svg><use xlink:href="http://exemple.fr/a.svg#b"/></svg>',
    '<svg><style>@import url(https://exemple.fr/a.css);</style></svg>',
    '<svg><rect style="fill:url(https://exemple.fr/x)"/></svg>',
    '<svg><iframe src="x"/></svg>',
  ]) assert.match(checkSvg(bad) ?? 'accepté à tort', /refusé/, bad);
});

test('runLogos : télécharge le logo de chaque machine qui a un logoTheme, l\'écrit dans clone90-logos du dossier des ROMs, et games.json l\'indique', async () => {
  await withProject({ 'roms/amiga/Gods.adf': 'x' }, async (root) => {
    const { net, calls } = fakeNet();
    const result = await runLogos({ root, now: FIXED_DATE, net });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.summary.found, ['Amiga', 'Mega-CD']);
    assert.deepEqual(result.summary.noSource, ['NES']);
    assert.deepEqual(calls, [logoUrl('amiga'), logoUrl('segacd')]);
    assert.equal(await readFile(join(root, 'roms/clone90-logos/amiga.svg'), 'utf8'), SVG);
    assert.ok(await exists(join(root, 'roms/clone90-logos/megacd.svg')), 'nommé par l\'id de la machine, pas par le dossier du thème');
    assert.deepEqual((await readGamesJson(root)).logos, { amiga: 'roms/clone90-logos/amiga.svg', megacd: 'roms/clone90-logos/megacd.svg' });
  });
});

test('runLogos : toutes les requêtes vont vers raw.githubusercontent.com (lecture seule), aucun nom de jeu n\'est envoyé', async () => {
  await withProject({ 'roms/amiga/Mon Jeu Secret.adf': 'x' }, async (root) => {
    const { net, calls } = fakeNet();
    await runLogos({ root, now: FIXED_DATE, net });
    assert.ok(calls.length > 0);
    assert.ok(calls.every((u) => u.startsWith('https://raw.githubusercontent.com/RetroPie/es-theme-carbon/')));
    assert.ok(calls.every((u) => !/Secret|Jeu/.test(u)));
  });
});

test('runLogos : ne remplace JAMAIS un logo déjà présent (déjà présent, aucune requête pour lui)', async () => {
  await withProject({ 'roms/clone90-logos/amiga.svg': '<svg>le mien</svg>' }, async (root) => {
    const { net, calls } = fakeNet();
    const result = await runLogos({ root, now: FIXED_DATE, net });
    assert.equal(result.summary.alreadyHave, 1);
    assert.deepEqual(calls, [logoUrl('segacd')]);
    assert.equal(await readFile(join(root, 'roms/clone90-logos/amiga.svg'), 'utf8'), '<svg>le mien</svg>');
  });
});

test('runLogos : un fichier refusé (pas un SVG, script, trop gros) n\'est pas écrit, l\'échec est signalé et les autres continuent', async () => {
  await withProject({}, async (root) => {
    const { net } = fakeNet((url) => Buffer.from(url.includes('/amiga/') ? '<svg onload="x"></svg>' : SVG));
    const result = await runLogos({ root, now: FIXED_DATE, net });
    assert.deepEqual(result.summary.found, ['Mega-CD']);
    assert.equal(result.summary.failed.length, 1);
    assert.equal(result.summary.failed[0].system, 'Amiga');
    assert.match(result.summary.failed[0].reason, /refusé/);
    assert.ok(!(await exists(join(root, 'roms/clone90-logos/amiga.svg'))));
  });
  await withProject({}, async (root) => {
    const { net } = fakeNet(() => { throw new Error('image trop volumineuse'); });
    const result = await runLogos({ root, now: FIXED_DATE, net });
    assert.deepEqual(result.summary.found, []);
    assert.equal(result.summary.failed.length, 2);
    assert.ok(!(await exists(join(root, 'games.json'))), 'rien écrit : games.json pas régénéré');
  });
});

test('runLogos : dossier des ROMs choisi (clone90.local.json) : le logo y est écrit, jamais dans le projet', async () => {
  const romsDir = await mkdtemp(join(tmpdir(), 'clone90-logos-roms-'));
  try {
    await withProject({}, async (root) => {
      await writeFile(join(root, 'clone90.local.json'), JSON.stringify({ romsDir }));
      const { net } = fakeNet();
      await runLogos({ root, now: FIXED_DATE, net });
      assert.ok(await exists(join(romsDir, 'clone90-logos/amiga.svg')));
      assert.ok(!(await exists(join(root, 'roms/clone90-logos'))));
      assert.equal((await readGamesJson(root)).logos.amiga, 'roms/clone90-logos/amiga.svg');
    });
  } finally { await rm(romsDir, { recursive: true, force: true }); }
});

test('runLogos : avancement « n sur total » par machine', async () => {
  await withProject({}, async (root) => {
    const events = [];
    await runLogos({ root, now: FIXED_DATE, net: fakeNet().net, onProgress: (e) => events.push(e) });
    assert.deepEqual(events.map((e) => [e.phase, e.done, e.total]), [['downloading', 0, 2], ['downloading', 1, 2], ['downloading', 2, 2]]);
  });
});

test('generateGames : logos présents dans clone90-logos indiqués par machine connue seulement ; aucun dossier = pas de logos', async () => {
  await withProject({ 'roms/clone90-logos/amiga.svg': SVG, 'roms/clone90-logos/inconnue.svg': SVG, 'roms/clone90-logos/nes.png': 'x' }, async (root) => {
    const { logos, games } = await generateGames({ root, now: FIXED_DATE });
    assert.deepEqual(logos, { amiga: 'roms/clone90-logos/amiga.svg' });
    assert.equal(games.length, 0, 'le dossier clone90-logos n\'est pas une machine');
  });
  await withProject({}, async (root) => {
    assert.deepEqual((await generateGames({ root, now: FIXED_DATE })).logos, {});
  });
});

test('formatLogosSummary : une ligne par résultat, zéros omis, détail des échecs', () => {
  const s = (o) => ({ found: [], alreadyHave: 0, failed: [], noSource: [], ...o });
  assert.deepEqual(formatLogosSummary({ summary: s({ found: ['Amiga', 'NES'], alreadyHave: 3 }) }), ['Logos téléchargés : 2', 'Déjà présents : 3']);
  assert.deepEqual(formatLogosSummary({ summary: s({ failed: [{ system: 'Amiga', reason: 'GitHub a répondu 404' }] }) }),
    ['Échecs : 1', '  Échec : Amiga (GitHub a répondu 404)']);
  assert.deepEqual(formatLogosSummary({ summary: s({ failed: [{ system: 'Amiga', reason: 'x' }] }) }, { details: false }), ['Échecs : 1']);
  assert.deepEqual(formatLogosSummary({ summary: s({ noSource: ['NES'] }) }), ['Machines sans logo à télécharger : NES']);
  assert.deepEqual(formatLogosSummary({ summary: s() }), ['Aucun logo à télécharger.']);
});
