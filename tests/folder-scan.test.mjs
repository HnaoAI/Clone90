// Tests de T38 (scan du dossier des jeux) : un dossier choisi sur l'appareil (un sous-dossier par machine, comme roms/ du Mac)
// est rangé automatiquement dans « Mes fichiers » ; neogeo.zip va dans bios/ et n'est jamais un jeu ; message de fin ; bouton de l'écran.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/project-root.mjs';
import { planFolderImport, describeFolderImport, summarizePlan, folderPickingSupported } from '../js/folder-scan.js';
import { buildLocalGames } from '../js/local-games.js';
import { buildSystemGames } from '../js/games-builder.js';
import { renderLibrary, SCAN_FOLDER_NAV_ID } from '../js/ui/library-screen.js';

const SYSTEMS = JSON.parse(readFileSync(join(PROJECT_ROOT, 'systems.json'), 'utf8')).systems;
const system = (id) => SYSTEMS.find((s) => s.id === id);
/** Fichier tel que le donne un sélecteur de dossier : `webkitRelativePath` commence par le dossier choisi. */
const file = (relativePath, size = 10) => ({ webkitRelativePath: relativePath, name: relativePath.split('/').pop(), size });
const paths = (plan) => plan.items.map((i) => i.path);

test('T38 critère 1 : chaque sous-dossier de machine est rangé sous roms/<machine>/, comme sur le Mac', () => {
  const plan = planFolderImport([
    file('roms/amiga/Gods.adf'), file('roms/neogeo/mslug.zip'), file('roms/nes/homebrew.nes'), file('roms/snes/Zelda.sfc'),
  ], SYSTEMS);
  assert.deepEqual(paths(plan), ['roms/amiga/Gods.adf', 'roms/neogeo/mslug.zip', 'roms/nes/homebrew.nes', 'roms/snes/Zelda.sfc']);
  assert.deepEqual(plan.items.map((i) => [i.kind, i.systemId]), [['rom', 'amiga'], ['rom', 'neogeo'], ['rom', 'nes'], ['rom', 'snes']]);
  assert.deepEqual(plan.items.map((i) => i.index), [0, 1, 2, 3], 'index = position du fichier choisi');
});

test('T38 critère 1 : le dossier choisi peut être roms/ lui-même, son parent (roms/ et bios/) ou un nom quelconque', () => {
  assert.deepEqual(paths(planFolderImport([file('Mes jeux/amiga/Gods.adf')], SYSTEMS)), ['roms/amiga/Gods.adf']);
  const parent = planFolderImport([file('emulateur/roms/amiga/Gods.adf'), file('emulateur/bios/kick40068.A1200')], SYSTEMS);
  assert.deepEqual(paths(parent), ['roms/amiga/Gods.adf', 'bios/kick40068.A1200']);
  assert.equal(parent.items[1].kind, 'bios');
  // Le dossier choisi est celui d'une machine : son nom suffit.
  assert.deepEqual(paths(planFolderImport([file('amiga/Gods.adf')], SYSTEMS)), ['roms/amiga/Gods.adf']);
});

test('T38 critère 1 : dossier de machine reconnu sans tenir compte de la casse (Amiga, NEOGEO)', () => {
  assert.deepEqual(paths(planFolderImport([file('roms/Amiga/Gods.adf'), file('roms/NEOGEO/mslug.zip')], SYSTEMS)),
    ['roms/amiga/Gods.adf', 'roms/neogeo/mslug.zip']);
});

test('T38 critère 2 : neogeo.zip reste dans bios/ (nom exact) et n\'apparaît jamais comme jeu', () => {
  const plan = planFolderImport([file('roms/neogeo/NeoGeo.zip'), file('roms/neogeo/mslug.zip'), file('roms/arcade/neogeo.zip'), file('bios/neogeo.zip')], SYSTEMS);
  assert.deepEqual(plan.items.map((i) => [i.path, i.kind]), [['bios/neogeo.zip', 'bios'], ['roms/neogeo/mslug.zip', 'rom']]);
  assert.equal(plan.duplicates, 2, 'le même BIOS trouvé trois fois n\'est copié qu\'une fois');
  // Une bibliothèque qui a déjà roms/neogeo/neogeo.zip (import manuel T27) ne montre pas non plus de jeu « neogeo ».
  const games = buildLocalGames({ systems: SYSTEMS, paths: ['roms/neogeo/neogeo.zip', 'roms/neogeo/mslug.zip'] });
  assert.deepEqual(games.map((g) => g.id), ['neogeo/mslug']);
});

test('T38 critère 2 : générateur du Mac, un BIOS déclaré rangé par erreur dans le dossier des jeux n\'est pas un jeu (avertissement)', () => {
  const { games, warnings } = buildSystemGames({ system: system('neogeo'), files: ['neogeo.zip', 'mslug.zip'], texts: {}, titles: null });
  assert.deepEqual(games.map((g) => g.id), ['neogeo/mslug']);
  assert.ok(warnings.some((w) => /neogeo\.zip/.test(w) && /bios\//.test(w)), warnings.join('\n'));
});

test('T38 critère 3 : bios/ importé avec le nom exact attendu ; nom inattendu gardé et signalé ; sous-dossier de bios/ ignoré', () => {
  const plan = planFolderImport([file('roms/bios/KICK40068.a1200'), file('roms/bios/Kickstart 3.1.rom'), file('roms/bios/samples/x.zip')], SYSTEMS);
  assert.deepEqual(plan.items.map((i) => [i.path, i.known]), [['bios/kick40068.A1200', true], ['bios/Kickstart 3.1.rom', false]]);
  assert.deepEqual(plan.skipped.map((s) => [s.relativePath, s.reason]), [['roms/bios/samples/x.zip', 'depth']]);
});

test('T38 critère 4 : formats non pris en charge et dossiers inconnus ignorés, avec leur raison', () => {
  const plan = planFolderImport([
    file('roms/amiga/notice.pdf'), file('roms/divers/jeu.zip'), file('Lisez-moi.txt'), file('roms/amiga/Gods.adf'),
  ], SYSTEMS);
  assert.deepEqual(paths(plan), ['roms/amiga/Gods.adf']);
  assert.deepEqual(plan.skipped.map((s) => s.reason), ['format', 'machine', 'machine']);
});

test('T38 critère 4 : fichiers cachés (.DS_Store, ._ de macOS, __MACOSX, dossier caché) ignorés sans être comptés', () => {
  const plan = planFolderImport([
    file('roms/amiga/.DS_Store'), file('roms/amiga/._Gods.adf'), file('roms/__MACOSX/amiga/Gods.adf'), file('roms/.cache/amiga/x.adf'), file('roms/amiga/Gods.adf'),
  ], SYSTEMS);
  assert.deepEqual(paths(plan), ['roms/amiga/Gods.adf']);
  assert.deepEqual(plan.skipped, []);
  assert.equal(plan.hidden, 4);
});

test('T38 critère 5 : jaquettes, .m3u, .bios et pistes d\'un .cue gardés ; un niveau de sous-dossier lu et rangé à plat', () => {
  const plan = planFolderImport([
    file('roms/amiga/Gods.png'), file('roms/amiga/Gods.bios'), file('roms/amiga/Leander.m3u'),
    file('roms/megacd/Sonic CD/Sonic CD.cue'), file('roms/megacd/Sonic CD/Sonic CD.bin'), file('roms/megacd/Sonic CD/Track 2.wav'),
    file('roms/megacd/a/b/trop.cue'),
  ], SYSTEMS);
  assert.deepEqual(paths(plan), ['roms/amiga/Gods.png', 'roms/amiga/Gods.bios', 'roms/amiga/Leander.m3u',
    'roms/megacd/Sonic CD.cue', 'roms/megacd/Sonic CD.bin', 'roms/megacd/Track 2.wav']);
  assert.deepEqual(plan.skipped.map((s) => s.reason), ['depth']);
  // Les pistes .bin/.wav ne sont gardées que pour une machine qui lit les .cue.
  assert.deepEqual(planFolderImport([file('roms/nes/x.wav')], SYSTEMS).skipped.map((s) => s.reason), ['format']);
  // Même nom dans deux sous-dossiers : le premier est gardé.
  const twice = planFolderImport([file('roms/megacd/A/Track 01.bin'), file('roms/megacd/B/Track 01.bin')], SYSTEMS);
  assert.deepEqual([paths(twice), twice.duplicates], [['roms/megacd/Track 01.bin'], 1]);
});

test('T38 critère 5 : un jeu Mega-CD rangé en sous-dossier devient un jeu jouable dans « Mes fichiers »', () => {
  const plan = planFolderImport([file('roms/megacd/Sonic CD/Sonic CD.cue'), file('roms/megacd/Sonic CD/Sonic CD.bin')], SYSTEMS);
  const games = buildLocalGames({ systems: SYSTEMS, paths: paths(plan), texts: { 'roms/megacd/Sonic CD.cue': 'FILE "Sonic CD.bin" BINARY\n' } });
  assert.equal(games.length, 1);
  assert.equal(games[0].file, 'roms/megacd/Sonic CD.cue');
  assert.deepEqual(games[0].extraFiles, [{ file: 'roms/megacd/Sonic CD.bin', as: 'Sonic CD.bin' }]);
});

test('T38 critère 6 : un nouveau scan ne recopie pas les fichiers déjà présents (même chemin, même taille)', () => {
  const existing = [{ path: 'roms/amiga/Gods.adf', size: 10 }, { path: 'roms/amiga/Leander.adf', size: 5 }];
  const plan = planFolderImport([file('roms/amiga/Gods.adf', 10), file('roms/amiga/Leander.adf', 99)], SYSTEMS, existing);
  assert.deepEqual(paths(plan), ['roms/amiga/Leander.adf'], 'taille différente = fichier remplacé');
  assert.equal(plan.already, 1);
});

test('T38 critère 7 : multi-disquettes Amiga regroupées comme sur le Mac après le scan', () => {
  const plan = planFolderImport(['1', '2', '3'].map((n) => file(`roms/amiga/Leander (Disk ${n} of 3).adf`)), SYSTEMS);
  const games = buildLocalGames({ systems: SYSTEMS, paths: paths(plan) });
  assert.equal(games.length, 1);
  assert.equal(games[0].disks.length, 3);
});

test('T38 cas limites : liste vide, noms illisibles, chemins hostiles, fichier sans chemin relatif', () => {
  assert.deepEqual(planFolderImport([], SYSTEMS), { items: [], skipped: [], already: 0, duplicates: 0, hidden: 0, flat: false });
  const hostile = planFolderImport([file('roms/amiga/../../etc/passwd'), file('roms/amiga/\u0000.adf'), file('roms/amiga/Été #1 ?.adf')], SYSTEMS);
  assert.deepEqual(paths(hostile), ['roms/amiga/Été #1 ?.adf']);
  assert.ok(hostile.items.every((i) => !i.path.includes('..')));
  // Navigateur qui ne donne pas les dossiers : rien n'est deviné, le message le dit.
  const flat = planFolderImport([{ name: 'Gods.adf', webkitRelativePath: '', size: 1 }], SYSTEMS);
  assert.equal(flat.flat, true);
  assert.deepEqual(flat.items, []);
  assert.throws(() => planFolderImport(null, SYSTEMS), /liste/);
});

test('T38 cas limites : 3000 fichiers analysés vite (pas de recherche quadratique)', () => {
  const many = Array.from({ length: 3000 }, (_, i) => file(`roms/amiga/Jeu ${i}.adf`));
  const start = Date.now();
  assert.equal(planFolderImport(many, SYSTEMS).items.length, 3000);
  assert.ok(Date.now() - start < 1000);
});

test('T38 critère 8 : message de fin par machine (ordre de systems.json), BIOS, déjà présents, ignorés', () => {
  const plan = planFolderImport([
    file('roms/neogeo/mslug.zip'), file('roms/amiga/Gods.adf'), file('roms/amiga/Leander.adf'), file('bios/neogeo.zip'), file('roms/amiga/notice.pdf'),
  ], SYSTEMS, [{ path: 'roms/amiga/Leander.adf', size: 10 }]);
  const summary = summarizePlan(plan, SYSTEMS);
  assert.deepEqual(summary.machines, [{ systemId: 'amiga', name: 'Amiga', count: 1 }, { systemId: 'neogeo', name: 'Neo Geo', count: 1 }]);
  assert.equal(describeFolderImport({ ...summary, copied: plan.items.length }),
    'Dossier importé : Amiga 1 fichier, Neo Geo 1 fichier ; 1 BIOS ; 1 déjà présent ; 1 fichier ignoré (format ou dossier non reconnu)');
});

test('T38 critère 8 : rien trouvé, navigateur sans dossiers, copie interrompue', () => {
  const empty = summarizePlan(planFolderImport([file('Photos/vacances.jpg')], SYSTEMS), SYSTEMS);
  assert.match(describeFolderImport({ ...empty, copied: 0 }), /^Aucun jeu trouvé/);
  assert.match(describeFolderImport({ ...empty, copied: 0 }), /un sous-dossier par machine/);
  const flat = summarizePlan(planFolderImport([{ name: 'a.adf', webkitRelativePath: '', size: 1 }], SYSTEMS), SYSTEMS);
  assert.match(describeFolderImport({ ...flat, copied: 0 }), /ne donne pas les dossiers/);
  const all = summarizePlan(planFolderImport([file('roms/amiga/Gods.adf')], SYSTEMS, [{ path: 'roms/amiga/Gods.adf', size: 10 }]), SYSTEMS);
  assert.equal(describeFolderImport({ ...all, copied: 0 }), 'Rien de nouveau : 1 fichier déjà présent');
  const cut = summarizePlan(planFolderImport([file('roms/amiga/A.adf'), file('roms/amiga/B.adf')], SYSTEMS), SYSTEMS);
  assert.match(describeFolderImport({ ...cut, copied: 1 }), /^Copie interrompue après 1 fichier sur 2/);
});

test('T38 support : choix de dossier proposé seulement si le navigateur le permet (webkitdirectory)', () => {
  assert.equal(folderPickingSupported({ HTMLInputElement: { prototype: { webkitdirectory: false } } }), true);
  assert.equal(folderPickingSupported({ HTMLInputElement: { prototype: {} } }), false);
  assert.equal(folderPickingSupported({}), false);
});

// --- Écran « Mes fichiers » ---
class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...items) { this.children.push(...items); }
  addEventListener(t, f) { this.listeners[t] = f; }
  walk(fn) { fn(this); this.children.forEach((c) => c.walk?.(fn)); }
}
const doc = { createElement: (t) => new FakeNode(t), createTextNode: (s) => ({ text: s }) };
const find = (root, pred) => { const out = []; root.walk((n) => pred(n) && out.push(n)); return out; };
const base = { systems: [system('amiga'), system('neogeo')], entries: [], supported: true, onAddGames() {}, onAddBios() {}, onRemove() {} };

test('T38 critère 9 : « Mes fichiers » propose « Choisir le dossier des jeux », en premier, navigable, action transmise', () => {
  let scanned = 0;
  const root = renderLibrary({ ...base, folderPicking: true, onScanFolder: () => { scanned += 1; } }, doc);
  const buttons = find(root, (n) => n.tag === 'button');
  const scan = buttons.find((b) => b.dataset.navId === SCAN_FOLDER_NAV_ID);
  assert.ok(scan, 'bouton présent');
  assert.equal(buttons[0], scan, 'premier bouton de l\'écran');
  assert.equal(scan.textContent, 'Choisir le dossier des jeux');
  assert.equal(scan.dataset.nav, '');
  scan.listeners.click();
  assert.equal(scanned, 1);
  const texts = find(root, (n) => n.textContent).map((n) => n.textContent);
  assert.ok(texts.some((t) => /un sous-dossier par machine/.test(t) && /neogeo\.zip/.test(t)), 'explication du rangement attendu');
});

test('T38 critère 9 : sans choix de dossier (navigateur) le bouton est remplacé par une phrase ; copie en cours = désactivé', () => {
  const none = renderLibrary({ ...base, folderPicking: false, onScanFolder() {} }, doc);
  assert.equal(find(none, (n) => n.dataset?.navId === SCAN_FOLDER_NAV_ID).length, 0);
  assert.ok(find(none, (n) => n.textContent).some((n) => /ne permet pas de choisir un dossier/.test(n.textContent)));
  const busy = renderLibrary({ ...base, busy: true, folderPicking: true, onScanFolder() {} }, doc);
  assert.ok('disabled' in find(busy, (n) => n.dataset?.navId === SCAN_FOLDER_NAV_ID)[0].attrs);
});

test('T38 critère 8 : le résultat du scan reste affiché dans l\'écran (région status), pas pendant la copie', () => {
  const root = renderLibrary({ ...base, folderPicking: true, notice: 'Dossier importé : Amiga 1 fichier' }, doc);
  const notice = find(root, (n) => n.attrs.class === 'library-notice')[0];
  assert.equal(notice.textContent, 'Dossier importé : Amiga 1 fichier');
  assert.equal(notice.attrs.role, 'status');
  assert.equal(find(renderLibrary({ ...base, busy: true, notice: 'x' }, doc), (n) => n.attrs.class === 'library-notice').length, 0);
});

// --- T50 : Game Boy Advance ---
test('T50 scan du dossier : roms/gba/ rangé sous roms/gba/, gba_bios.bin trouvé avec les jeux va dans bios/, un .gb n\'est pas un jeu GBA', () => {
  const plan = planFolderImport([file('roms/gba/Homebrew.gba'), file('roms/GBA/Autre.zip'), file('roms/gba/gba_bios.bin'), file('roms/gba/Vieux.gb')], SYSTEMS);
  assert.deepEqual(paths(plan), ['roms/gba/Homebrew.gba', 'roms/gba/Autre.zip', 'bios/gba_bios.bin']);
  assert.deepEqual(plan.items.map((i) => i.kind), ['rom', 'rom', 'bios']);
  assert.deepEqual(plan.skipped.map((s) => [s.relativePath, s.reason]), [['roms/gba/Vieux.gb', 'format']]);
});
