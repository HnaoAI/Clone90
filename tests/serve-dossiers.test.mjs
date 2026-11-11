// Tests du serveur local avec des dossiers de ROMs et de BIOS choisis (T23) : service, refus de sortie, réglage jamais servi.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStaticServer } from '../scripts/serve.mjs';

const base = realpathSync(mkdtempSync(join(tmpdir(), 'clone90-dossiers-')));
const site = join(base, 'site');
const romsExt = join(base, 'Mes jeux', 'ROMs');
const biosExt = join(base, 'BIOS externes');
const secret = join(base, 'secret.txt');
for (const d of [join(site, 'roms', 'amiga'), join(site, 'bios'), join(romsExt, 'amiga'), biosExt]) mkdirSync(d, { recursive: true });
writeFileSync(join(site, 'index.html'), '<title>Clone90</title>');
writeFileSync(join(site, 'clone90.local.json'), JSON.stringify({ romsDir: romsExt }));
writeFileSync(join(site, 'roms', 'amiga', 'projet.adf'), 'PROJET');
writeFileSync(join(site, 'bios', 'projet.rom'), 'BIOS-PROJET');
writeFileSync(join(romsExt, 'amiga', 'ext.adf'), 'EXT');
writeFileSync(join(biosExt, 'kick.rom'), 'KICK');
writeFileSync(secret, 'SECRET');
symlinkSync(secret, join(romsExt, 'amiga', 'dehors.adf'));
symlinkSync(base, join(romsExt, 'amiga', 'sous-lien'));
symlinkSync(secret, join(biosExt, 'dehors.rom'));
writeFileSync(join(romsExt, 'amiga', 'interne.adf'), 'INTERNE');
symlinkSync(join(romsExt, 'amiga', 'interne.adf'), join(romsExt, 'amiga', 'alias.adf'));

const server = createStaticServer({ root: site, romsDir: romsExt, biosDir: biosExt });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const { port } = server.address();
const get = (path, headers) => fetch(`http://127.0.0.1:${port}${path}`, { headers });
test.after(() => server.close());

test('serveur : roms/ est servi depuis le dossier choisi, pas depuis celui du projet', async () => {
  const ok = await get('/roms/amiga/ext.adf');
  assert.equal(ok.status, 200);
  assert.equal(await ok.text(), 'EXT');
  assert.equal((await get('/roms/amiga/projet.adf')).status, 404);
  assert.equal((await get('/roms/amiga/ext.adf', { Range: 'bytes=1-2' })).status, 206);
  assert.equal((await get('/roms/amiga/alias.adf')).status, 200, 'lien interne au dossier choisi');
});

test('serveur : bios/ est servi depuis le dossier choisi', async () => {
  assert.equal(await (await get('/bios/kick.rom')).text(), 'KICK');
  assert.equal((await get('/bios/projet.rom')).status, 404);
});

test('serveur : un lien qui sort du dossier choisi est refusé (403), fichier ou sous-dossier', async () => {
  assert.equal((await get('/roms/amiga/dehors.adf')).status, 403);
  assert.equal((await get('/roms/amiga/sous-lien/secret.txt')).status, 403);
  assert.equal((await get('/bios/dehors.rom')).status, 403);
});

test('serveur : ../ et chemins cachés restent refusés avec un dossier choisi', async () => {
  for (const p of ['/roms/../clone90.local.json', '/roms/%2e%2e/%2e%2e/secret.txt', '/roms/amiga/%2e%2e/%2e%2e/%2e%2e/secret.txt', '/bios/%2e%2e/site/index.html']) {
    const res = await get(p);
    assert.ok([400, 403, 404].includes(res.status), `${p} : ${res.status}`);
    assert.doesNotMatch(await res.text(), /SECRET|romsDir/);
  }
  assert.equal((await get('/roms/.cache')).status, 403);
});

test('serveur : clone90.local.json n\'est jamais servi (403)', async () => {
  for (const p of ['/clone90.local.json', '/Clone90.local.json', '/%63lone90.local.json', '/roms/clone90.local.json']) {
    const res = await get(p);
    assert.notEqual(res.status, 200, p);
    assert.doesNotMatch(await res.text(), /romsDir/);
  }
  assert.equal((await get('/clone90.local.json')).status, 403);
});

test('serveur : dossier choisi inexistant ou machine sans dossier : 404 propre', async () => {
  assert.equal((await get('/roms/neogeo/x.zip')).status, 404);
  assert.equal((await get('/roms/')).status, 404);
  const sans = createStaticServer({ root: site, romsDir: join(base, 'absent') });
  await new Promise((r) => sans.listen(0, '127.0.0.1', r));
  try {
    assert.equal((await fetch(`http://127.0.0.1:${sans.address().port}/roms/amiga/ext.adf`)).status, 404);
  } finally { sans.close(); }
});

test('serveur : sans romsDir ni biosDir, roms/ et bios/ du projet comme avant', async () => {
  const defaut = createStaticServer({ root: site });
  await new Promise((r) => defaut.listen(0, '127.0.0.1', r));
  try {
    const url = (p) => `http://127.0.0.1:${defaut.address().port}${p}`;
    assert.equal(await (await fetch(url('/roms/amiga/projet.adf'))).text(), 'PROJET');
    assert.equal(await (await fetch(url('/bios/projet.rom'))).text(), 'BIOS-PROJET');
  } finally { defaut.close(); }
});
