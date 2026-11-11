// Tests de scripts/local-settings.mjs (T23) et de son usage par le générateur : lecture, validation, fusion, repli sur le défaut.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLocalSettings, updateLocalSettings, describeFolders, LOCAL_SETTINGS_FILE } from '../scripts/local-settings.mjs';
import { generateGames } from '../scripts/generate-games.mjs';

const tmp = (prefix) => mkdtemp(join(tmpdir(), `clone90-${prefix}-`));
const writeSettings = (root, value) => writeFile(join(root, LOCAL_SETTINGS_FILE), typeof value === 'string' ? value : JSON.stringify(value));

test('réglages : sans fichier, roms/ et bios/ du projet', async () => {
  const root = await tmp('set');
  const s = await readLocalSettings(root);
  assert.equal(s.romsDir, join(root, 'roms'));
  assert.equal(s.biosDir, join(root, 'bios'));
  assert.deepEqual(s.warnings, []);
  assert.deepEqual(s.custom, { romsDir: false, biosDir: false });
});

test('réglages : dossiers absolus existants acceptés, chacun facultatif', async () => {
  const root = await tmp('set');
  const ext = await tmp('ext');
  await writeSettings(root, { romsDir: ext });
  const s = await readLocalSettings(root);
  assert.equal(s.romsDir, ext);
  assert.equal(s.biosDir, join(root, 'bios'));
  assert.deepEqual(s.custom, { romsDir: true, biosDir: false });
  assert.deepEqual(s.warnings, []);
});

test('réglages : chemin relatif, inexistant, fichier ou non texte : message clair en français et repli sur le défaut', async () => {
  const root = await tmp('set');
  await writeFile(join(root, 'fichier.txt'), 'x');
  for (const [valeur, attendu] of [['roms-externes', /chemin absolu/], [join(root, 'absent'), /n'est pas un dossier existant/],
    [join(root, 'fichier.txt'), /n'est pas un dossier existant/], [42, /chemin absolu/], ['', /chemin absolu/]]) {
    await writeSettings(root, { romsDir: valeur });
    const s = await readLocalSettings(root);
    assert.equal(s.romsDir, join(root, 'roms'), String(valeur));
    assert.equal(s.custom.romsDir, false);
    assert.match(s.warnings.join('\n'), attendu);
    assert.match(s.warnings[0], /Dossier roms\/ du projet utilisé\.$/);
  }
});

test('réglages : JSON invalide ou non objet : avertissement et défauts, sans exception', async () => {
  const root = await tmp('set');
  for (const contenu of ['{pas du json', '[1,2]', '"texte"']) {
    await writeSettings(root, contenu);
    const s = await readLocalSettings(root);
    assert.equal(s.romsDir, join(root, 'roms'));
    assert.match(s.warnings[0], /illisible/);
  }
});

test('réglages : caractères spéciaux et espaces dans le chemin', async () => {
  const root = await tmp('set');
  const ext = join(await tmp('ext'), 'Mes jeux é à (90s) #1');
  await mkdir(ext);
  await writeSettings(root, { romsDir: ext });
  assert.equal((await readLocalSettings(root)).romsDir, ext);
});

test('réglages : updateLocalSettings fusionne sans détruire une autre valeur, null retire la clé', async () => {
  const root = await tmp('set');
  await writeSettings(root, { biosDir: '/x/bios', autre: 1 });
  await updateLocalSettings(root, { romsDir: '/x/roms' });
  assert.deepEqual(JSON.parse(await readFile(join(root, LOCAL_SETTINGS_FILE), 'utf8')), { biosDir: '/x/bios', autre: 1, romsDir: '/x/roms' });
  await updateLocalSettings(root, { biosDir: null });
  assert.deepEqual(JSON.parse(await readFile(join(root, LOCAL_SETTINGS_FILE), 'utf8')), { autre: 1, romsDir: '/x/roms' });
});

test('réglages : updateLocalSettings crée le fichier, refuse une clé inconnue et n\'écrase pas un JSON invalide', async () => {
  const root = await tmp('set');
  await updateLocalSettings(root, { romsDir: '/x' });
  assert.equal(JSON.parse(await readFile(join(root, LOCAL_SETTINGS_FILE), 'utf8')).romsDir, '/x');
  await assert.rejects(updateLocalSettings(root, { motDePasse: 'x' }), /inconnu/);
  await writeSettings(root, '{casse');
  await assert.rejects(updateLocalSettings(root, { romsDir: '/y' }), /JSON valide/);
  assert.equal(await readFile(join(root, LOCAL_SETTINGS_FILE), 'utf8'), '{casse');
});

test('réglages : describeFolders indique le dossier du projet quand rien n\'est choisi', async () => {
  const root = await tmp('set');
  const lines = describeFolders(await readLocalSettings(root));
  assert.match(lines[0], /Dossier des ROMs : .*roms \(roms\/ du projet\)$/);
  assert.match(lines[1], /Dossier des BIOS : .*bios \(bios\/ du projet\)$/);
});

test('réglages : clone90.local.json est ignoré par git', async () => {
  const gitignore = await readFile(new URL('../.gitignore', import.meta.url), 'utf8');
  assert.ok(gitignore.split('\n').includes(LOCAL_SETTINGS_FILE));
});

test('générateur : scanne romsDir choisi, les chemins de games.json restent roms/<machine>/...', async () => {
  const root = await tmp('gen');
  const ext = await tmp('ext');
  await copyFile(new URL('../systems.json', import.meta.url), join(root, 'systems.json'));
  await mkdir(join(root, 'roms', 'amiga'), { recursive: true });
  await writeFile(join(root, 'roms', 'amiga', 'Projet.adf'), 'x'); // ignoré : romsDir est ailleurs
  await mkdir(join(ext, 'amiga'), { recursive: true });
  await writeFile(join(ext, 'amiga', 'Lemmings.adf'), 'x');
  await writeSettings(root, { romsDir: ext });
  const { games, folders } = await generateGames({ root });
  assert.deepEqual(games.map((g) => g.file), ['roms/amiga/Lemmings.adf']);
  assert.ok(games.every((g) => !g.file.includes(ext)));
  assert.match(folders[0], new RegExp(`Dossier des ROMs : ${ext}$`));
  await rm(root, { recursive: true });
});

test('générateur : BIOS requis cherché dans biosDir choisi, et réglage invalide : avertissement et roms/ du projet', async () => {
  const root = await tmp('gen');
  const biosExt = await tmp('bios');
  await copyFile(new URL('../systems.json', import.meta.url), join(root, 'systems.json'));
  await mkdir(join(root, 'roms', 'neogeo'), { recursive: true });
  await writeFile(join(root, 'roms', 'neogeo', 'mslug.zip'), 'x');
  await writeSettings(root, { biosDir: biosExt, romsDir: '/dossier/qui/n/existe/pas' });
  const r = await generateGames({ root });
  assert.equal(r.games.length, 1, 'repli sur roms/ du projet');
  assert.ok(r.warnings.some((w) => /romsDir n'est pas un dossier existant/.test(w)));
  assert.ok(r.warnings.some((w) => /BIOS requis absent/.test(w)), 'biosExt est vide');
  await rm(root, { recursive: true });
});
