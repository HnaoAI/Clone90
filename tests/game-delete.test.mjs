// Tests T39, suppression sur le disque du Mac ou du PC : fichiers d'un jeu (gameFilePaths), effacement limité au dossier des jeux
// (scripts/game-delete.mjs), API locale (GET /api/games, POST /api/games/delete), client du navigateur, confirmation « disque ».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, writeFile, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gameFilePaths, deleteGameDialogOptions, confirmAndDeleteDiskGame } from '../js/local-game-delete.js';
import { deleteGameFromDisk, isGameDeleteEnabled } from '../scripts/game-delete.mjs';
import { createStaticServer } from '../scripts/serve.mjs';
import { createSettingsApi } from '../scripts/settings-api.mjs';
import { fetchGameDeleteSupport, requestGameDelete } from '../js/folders-client.js';

const exists = (p) => access(p).then(() => true, () => false);

/** Projet temporaire : roms/ (ou un dossier des jeux ailleurs), bios/, games.json. */
async function project(files, games, { romsElsewhere = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'clone90-suppr-'));
  const romsDir = romsElsewhere ? await mkdtemp(join(tmpdir(), 'clone90-jeux-')) : join(root, 'roms');
  for (const [rel, content] of Object.entries(files)) {
    const target = rel.startsWith('roms/') ? join(romsDir, rel.slice(5)) : join(root, rel);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, content);
  }
  await writeFile(join(root, 'games.json'), JSON.stringify({ version: 1, games }));
  return { root, romsDir, at: (rel) => (rel.startsWith('roms/') ? join(romsDir, rel.slice(5)) : join(root, rel)) };
}

test('gameFilePaths : jeu du disque, un niveau de sous-dossier (Mega-CD), jamais hors du dossier de sa machine', () => {
  assert.deepEqual(gameFilePaths({ file: 'roms/megacd/Sonic CD/Sonic CD.cue', extraFiles: [{ file: 'roms/megacd/Sonic CD/Sonic CD.bin' }], cover: 'roms/megacd/Sonic CD/Sonic CD.png' }),
    ['roms/megacd/Sonic CD/Sonic CD.cue', 'roms/megacd/Sonic CD/Sonic CD.bin', 'roms/megacd/Sonic CD/Sonic CD.png']);
  assert.deepEqual(gameFilePaths({ file: 'roms/nes/a.nes', cover: 'roms/snes/a.png', disks: ['bios/neogeo.zip', 'roms/nes/../../x', 'roms/nes', 'roms//a'] }), ['roms/nes/a.nes']);
  assert.deepEqual(gameFilePaths({ file: 'roms/a.nes' }), []);
  assert.deepEqual(gameFilePaths({ file: 'roms/nes/a\\b.nes' }), []);
  assert.deepEqual(gameFilePaths({ file: 'roms/amiga/g.m3u' }, { m3uText: 'g1.adf\n../neogeo/x.zip\n/abs.adf' }), ['roms/amiga/g.m3u', 'roms/amiga/g1.adf']);
});

test('deleteGameDialogOptions : sur le disque, le nom du jeu, « disque », définitive et pas de corbeille', () => {
  const o = deleteGameDialogOptions('Metal Slug', 1, 'disk');
  assert.equal(o.title, 'Supprimer Metal Slug ?');
  assert.match(o.message, /Metal Slug/);
  assert.match(o.message, /disque/);
  assert.match(o.message, /définitive/);
  assert.match(o.message, /corbeille/);
  assert.equal(o.confirmLabel, 'Supprimer');
});

test('deleteGameFromDisk : efface le jeu, sa jaquette et ses disquettes, puis rien d\'autre', async () => {
  const p = await project({
    'roms/amiga/L (Disk 1 of 2).adf': '1', 'roms/amiga/L (Disk 2 of 2).adf': '2', 'roms/amiga/L.png': 'P', 'roms/amiga/Autre.adf': 'A', 'bios/kick40068.A1200': 'K',
  }, [{ id: 'amiga/l', system: 'amiga', title: 'L', file: 'roms/amiga/L (Disk 1 of 2).adf', disks: ['roms/amiga/L (Disk 1 of 2).adf', 'roms/amiga/L (Disk 2 of 2).adf'], cover: 'roms/amiga/L.png' }]);
  const r = await deleteGameFromDisk({ root: p.root, romsDir: p.romsDir, gameId: 'amiga/l' });
  assert.equal(r.status, 'ok');
  assert.equal(r.removed.length, 3);
  assert.deepEqual(r.failed, []);
  for (const f of ['roms/amiga/L (Disk 1 of 2).adf', 'roms/amiga/L (Disk 2 of 2).adf', 'roms/amiga/L.png']) assert.equal(await exists(p.at(f)), false, f);
  assert.equal(await exists(p.at('roms/amiga/Autre.adf')), true);
  assert.equal(await exists(p.at('bios/kick40068.A1200')), true);
  assert.equal(await exists(p.at('roms/amiga')), true, 'le dossier de la machine reste');
});

test('deleteGameFromDisk : dossier des jeux choisi ailleurs (clone90.local.json) et disques d\'un .m3u', async () => {
  const p = await project({ 'roms/amiga/G.m3u': 'G-1.adf\nG-2.adf\n', 'roms/amiga/G-1.adf': '1', 'roms/amiga/G-2.adf': '2' },
    [{ id: 'amiga/g', system: 'amiga', title: 'G', file: 'roms/amiga/G.m3u', cover: null }], { romsElsewhere: true });
  const r = await deleteGameFromDisk({ root: p.root, romsDir: p.romsDir, gameId: 'amiga/g' });
  assert.deepEqual(r.removed.sort(), ['roms/amiga/G-1.adf', 'roms/amiga/G-2.adf', 'roms/amiga/G.m3u']);
  assert.equal(await exists(p.at('roms/amiga/G-1.adf')), false);
});

test('deleteGameFromDisk : jeu inconnu, id invalide, games.json absent : rien n\'est effacé', async () => {
  const p = await project({ 'roms/nes/a.nes': 'A' }, [{ id: 'nes/a', system: 'nes', title: 'A', file: 'roms/nes/a.nes', cover: null }]);
  assert.equal((await deleteGameFromDisk({ root: p.root, romsDir: p.romsDir, gameId: 'nes/b' })).status, 'not-found');
  assert.equal((await deleteGameFromDisk({ root: p.root, romsDir: p.romsDir, gameId: 42 })).status, 'not-found');
  assert.equal((await deleteGameFromDisk({ root: join(p.root, 'absent'), romsDir: p.romsDir, gameId: 'nes/a' })).status, 'not-found');
  assert.equal(await exists(p.at('roms/nes/a.nes')), true);
});

test('deleteGameFromDisk : jamais un dossier, jamais hors du dossier des jeux (lien vers l\'extérieur), fichier déjà absent signalé', async () => {
  const outside = await mkdtemp(join(tmpdir(), 'clone90-dehors-'));
  await writeFile(join(outside, 'precieux.nes'), 'X');
  const p = await project({ 'roms/nes/a.nes': 'A' }, [
    { id: 'nes/dossier', system: 'nes', title: 'D', file: 'roms/nes/sous', cover: null },
    { id: 'nes/lien', system: 'nes', title: 'L', file: 'roms/nes/ext/precieux.nes', cover: null },
    { id: 'nes/parti', system: 'nes', title: 'P', file: 'roms/nes/parti.nes', cover: null },
  ]);
  await mkdir(join(p.romsDir, 'nes', 'sous'));
  await symlink(outside, join(p.romsDir, 'nes', 'ext'));
  const dir = await deleteGameFromDisk({ root: p.root, romsDir: p.romsDir, gameId: 'nes/dossier' });
  assert.equal(dir.status, 'error');
  assert.equal(await exists(join(p.romsDir, 'nes', 'sous')), true);
  const link = await deleteGameFromDisk({ root: p.root, romsDir: p.romsDir, gameId: 'nes/lien' });
  assert.equal(link.status, 'error');
  assert.equal(await exists(join(outside, 'precieux.nes')), true);
  const gone = await deleteGameFromDisk({ root: p.root, romsDir: p.romsDir, gameId: 'nes/parti' });
  assert.equal(gone.status, 'ok');
  assert.deepEqual(gone.missing, ['roms/nes/parti.nes']);
});

test('isGameDeleteEnabled : serveur limité à cet ordinateur seulement, Mac comme PC ; ouvert au réseau local : jamais', () => {
  assert.equal(isGameDeleteEnabled('127.0.0.1'), true);
  assert.equal(isGameDeleteEnabled('localhost'), true);
  assert.equal(isGameDeleteEnabled('0.0.0.0'), false);
  assert.equal(isGameDeleteEnabled('192.168.1.10'), false);
  assert.equal(isGameDeleteEnabled(undefined), false);
});

/** API de test : vraie suppression dans un projet temporaire, générateur factice. */
async function apiSetup({ gamesEnabled = true } = {}) {
  const p = await project({ 'roms/nes/a.nes': 'A', 'roms/nes/b.nes': 'B' }, [{ id: 'nes/a', system: 'nes', title: 'A', file: 'roms/nes/a.nes', cover: null }]);
  const calls = { regenerate: 0 };
  let server;
  const api = createSettingsApi({
    root: p.root, enabled: false, gamesEnabled, getPort: () => server.address().port, applyFolders: () => {}, chooseFolder: async () => null,
    regenerate: async () => { calls.regenerate += 1; return { exitCode: 0 }; }, getRomsDir: async () => p.romsDir,
  });
  server = createStaticServer({ root: p.root, api });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const call = (method, path, { headers = {}, json } = {}) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path, headers: { ...(json !== undefined && { 'Content-Type': 'application/json' }), ...headers } }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(json !== undefined ? JSON.stringify(json) : undefined);
  });
  return { p, calls, call, close: () => server.close() };
}

test('API : GET /api/games dit que la suppression est possible ; POST /api/games/delete efface et régénère games.json', async () => {
  const t = await apiSetup();
  try {
    const support = await t.call('GET', '/api/games');
    assert.equal(support.status, 200);
    assert.deepEqual(support.json(), { deletable: true });
    const r = await t.call('POST', '/api/games/delete', { headers: { 'X-Clone90': '1' }, json: { id: 'nes/a' } });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json(), { status: 'ok', removed: 1, failed: 0 });
    assert.equal(await exists(t.p.at('roms/nes/a.nes')), false);
    assert.equal(await exists(t.p.at('roms/nes/b.nes')), true);
    assert.equal(t.calls.regenerate, 1);
  } finally { t.close(); }
});

test('API : refus (désactivée, sans X-Clone90, autre origine, chemin à la place d\'un id, jeu inconnu) : rien n\'est effacé', async () => {
  const off = await apiSetup({ gamesEnabled: false });
  try {
    assert.equal((await off.call('GET', '/api/games')).status, 404);
    assert.equal((await off.call('POST', '/api/games/delete', { headers: { 'X-Clone90': '1' }, json: { id: 'nes/a' } })).status, 404);
  } finally { off.close(); }
  const t = await apiSetup();
  try {
    assert.equal((await t.call('POST', '/api/games/delete', { json: { id: 'nes/a' } })).status, 403);
    assert.equal((await t.call('POST', '/api/games/delete', { headers: { Origin: 'http://evil.example' }, json: { id: 'nes/a' } })).status, 403);
    assert.equal((await t.call('POST', '/api/games/delete', { headers: { 'X-Clone90': '1' }, json: { path: '/etc/passwd' } })).status, 400);
    assert.equal((await t.call('POST', '/api/games/delete', { headers: { 'X-Clone90': '1' }, json: { id: 'nes/a', extra: 1 } })).status, 400);
    const unknown = await t.call('POST', '/api/games/delete', { headers: { 'X-Clone90': '1' }, json: { id: 'nes/zzz' } });
    assert.equal(unknown.json().status, 'not-found');
    assert.equal(await exists(t.p.at('roms/nes/a.nes')), true);
    assert.equal(t.calls.regenerate, 0);
  } finally { t.close(); }
});

test('client : fetchGameDeleteSupport et requestGameDelete (id seulement, en-tête X-Clone90), sans lever', async () => {
  const sent = [];
  const fetchOk = async (url, init = {}) => { sent.push({ url, init }); return { ok: true, status: 200, json: async () => (url === 'api/games' ? { deletable: true } : { status: 'ok', removed: 2, failed: 0 }) }; };
  assert.equal(await fetchGameDeleteSupport(fetchOk), true);
  assert.deepEqual(await requestGameDelete('nes/a', fetchOk), { status: 'ok', removed: 2, failed: 0 });
  assert.equal(sent[1].url, 'api/games/delete');
  assert.equal(sent[1].init.method, 'POST');
  assert.equal(sent[1].init.headers['X-Clone90'], '1');
  assert.deepEqual(JSON.parse(sent[1].init.body), { id: 'nes/a' });
  assert.equal(await fetchGameDeleteSupport(async () => ({ ok: false, status: 404, json: async () => ({}) })), false);
  assert.equal(await fetchGameDeleteSupport(async () => { throw new Error('hors ligne'); }), false);
  assert.equal((await requestGameDelete('nes/a', async () => { throw new Error('hors ligne'); })).status, 'error');
});

test('confirmAndDeleteDiskGame : confirmé = demande au serveur ; refusé = aucune demande ; échec = error', async () => {
  const asked = [];
  const request = async (id) => { asked.push(id); return { status: 'ok', removed: 1, failed: 0 }; };
  const game = { id: 'nes/a', title: 'A', file: 'roms/nes/a.nes', cover: null };
  const shown = [];
  assert.deepEqual(await confirmAndDeleteDiskGame({ game, confirm: async (o) => { shown.push(o); return false; }, request }), { status: 'cancelled' });
  assert.equal(asked.length, 0);
  assert.match(shown[0].message, /disque/);
  assert.equal((await confirmAndDeleteDiskGame({ game, confirm: async () => true, request })).status, 'deleted');
  assert.deepEqual(asked, ['nes/a']);
  assert.equal((await confirmAndDeleteDiskGame({ game, confirm: async () => true, request: async () => ({ status: 'error', message: 'non' }) })).status, 'error');
  assert.equal((await confirmAndDeleteDiskGame({ game, confirm: async () => true, request: async () => { throw new Error('x'); } })).status, 'error');
});
