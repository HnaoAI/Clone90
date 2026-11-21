// Tests T52 « envoi vers le Mac bloqué sur un jeu » (bstars.zip, Neo Geo, 2026-11-21). Constat sur le Mac de Hicham : l'envoi avançait par
// à-coups (Chrome Android met l'envoi en pause en arrière-plan), sans aucune progression visible ; un téléphone disparu en plein envoi
// gardait le verrou du Mac jusqu'à 1 heure ; le BIOS neogeo.zip, rangé avec les jeux, partait comme un jeu.
// Couvre : règles pures (js/sync-plan.js), téléphone (js/sync-client.js, envoi surveillé), réception du Mac (vrai serveur HTTP local).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, mkdir, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { uploadTargetPath, planUpload, describeUploadResult, describeUploadProgress, declaredBiosFiles, UPLOAD_STALL_MS } from '../js/sync-plan.js';
import { sendGamesToMac, saveSyncPairing, readSyncPairing, keepScreenOn } from '../js/sync-client.js';
import { receiveUpload, UPLOAD_IDLE_MS } from '../scripts/sync-upload.mjs';
import { createSyncHandler } from '../scripts/sync-server.mjs';

const SYSTEMS = [{ id: 'neogeo', name: 'Neo Geo', bios: [{ file: 'neogeo.zip' }] }, { id: 'nes', name: 'NES', bios: [{ file: 'disksys.rom' }] }, { id: 'snes', name: 'SNES' }];
const IDS = SYSTEMS.map((s) => s.id);
const BIOS = declaredBiosFiles(SYSTEMS);
const TOKEN = 'b'.repeat(64);

// --- Règles pures ---

test('T52 BIOS déclaré rangé avec les jeux (roms/neogeo/neogeo.zip) : jamais envoyé ni accepté comme un jeu', () => {
  assert.deepEqual([...BIOS].sort(), ['neogeo/neogeo.zip', 'nes/disksys.rom']);
  assert.equal(uploadTargetPath('roms/neogeo/neogeo.zip', IDS, BIOS), null);
  assert.equal(uploadTargetPath('roms/neogeo/NeoGeo.ZIP', IDS, BIOS), null, 'sans tenir compte des majuscules');
  assert.equal(uploadTargetPath('roms/neogeo/bstars.zip', IDS, BIOS), 'roms/neogeo/bstars.zip');
  assert.equal(uploadTargetPath('roms/snes/neogeo.zip', IDS, BIOS), 'roms/snes/neogeo.zip', 'BIOS d\'une AUTRE machine : nom de jeu permis');
  assert.equal(uploadTargetPath('roms/neogeo/neogeo.zip', IDS), 'roms/neogeo/neogeo.zip', 'sans liste de BIOS : règle de T44 inchangée');
  const plan = planUpload({ remote: [], local: [{ path: 'roms/neogeo/neogeo.zip', size: 5 }, { path: 'roms/neogeo/bstars.zip', size: 9 }], synced: {}, systemIds: IDS, biosFiles: BIOS });
  assert.deepEqual(plan.send.map((e) => e.path), ['roms/neogeo/bstars.zip']);
  assert.deepEqual(declaredBiosFiles([{ id: 'x' }, { id: 'y', bios: [{ file: 42 }, {}] }, null]), new Set());
});

test('T52 progression par fichier en Mo, avec la consigne de garder Clone90 ouvert', () => {
  assert.equal(describeUploadProgress({ done: 14, total: 80, name: 'bstars.zip', sentBytes: 1258291, size: 3331946 }),
    'Envoi au Mac : 15 sur 80 (bstars.zip, 1,2 Mo sur 3,2 Mo)… Gardez Clone90 ouvert et l\'écran allumé jusqu\'à la fin.');
  assert.equal(describeUploadProgress({ done: 0, total: 2, name: 'Mario.png', sentBytes: 0, size: 51200 }),
    'Envoi au Mac : 1 sur 2 (Mario.png, 0 Ko sur 50 Ko)… Gardez Clone90 ouvert et l\'écran allumé jusqu\'à la fin.');
  assert.equal(describeUploadProgress({ done: 3, total: 3 }), 'Envoi au Mac : fin…');
  assert.equal(describeUploadProgress({ done: 0, total: 0 }), 'Envoi au Mac…');
  assert.equal(describeUploadProgress({ done: 4, total: 9, name: 'a.zip', sentBytes: 5, size: 5, retry: true }).includes('nouvel essai'), true);
});

test('T52 message de fin : fichiers interrompus et Mac occupé, sans masquer les autres comptes', () => {
  assert.equal(describeUploadResult({ sent: 3, interrupted: 1 }),
    'Envoi : 3 jeux envoyés au Mac ; 1 fichier interrompu (plus rien ne passait depuis 1 min ; rien n\'est gardé à moitié sur le Mac) : relancez l\'envoi pour le reprendre.');
  assert.match(describeUploadResult({ busy: 2 }), /2 fichiers non envoyés : le Mac recevait déjà un autre envoi/);
  assert.equal(UPLOAD_STALL_MS, 60000);
});

// --- Téléphone ---
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const paired = () => { const s = memoryStorage(); saveSyncPairing({ url: 'https://192.168.1.20:8443', token: TOKEN, files: {}, lastSync: null }, s); return s; };
const blobOf = (n) => new Blob([new Uint8Array(n)]);
const library = (files) => ({ list: async () => Object.entries(files).map(([path, blob]) => ({ path, size: blob.size })), get: async (p) => files[p] ?? null });
const manifest = (uploads = true, files = []) => async () => ({ ok: true, status: 200, json: async () => ({ version: 1, uploads, files }) });

/** Envoi simulé : `script[nom]` = suite de comportements par essai : 'stall' (ne répond jamais, ignore l'abandon), 'busy', 'ok', 'exists'. */
function fakeUpload(script, log) {
  return async (url, { blob, signal, onBytes }) => {
    const path = new URL(url).searchParams.get('path');
    const name = path.split('/').pop();
    const step = (script[name] ?? ['ok']).shift() ?? 'ok';
    log.push(`${name}:${step}`);
    assert.ok(signal instanceof AbortSignal);
    onBytes(Math.floor(blob.size / 2));
    if (step === 'stall') return new Promise(() => {});
    if (step === 'busy') return { status: 429, body: { error: 'busy' } };
    if (step === 'exists') return { status: 409, body: { error: 'exists' } };
    onBytes(blob.size);
    return { status: 201, body: { path, size: blob.size, mtime: 5 } };
  };
}

test('T52 téléphone : un jeu qui n\'avance plus est abandonné, réessayé une fois, puis l\'envoi passe au jeu suivant', async () => {
  const log = [];
  const progress = [];
  const lib = library({ 'roms/neogeo/superspy.zip': blobOf(3), 'roms/neogeo/bstars.zip': blobOf(4), 'roms/neogeo/burningf.zip': blobOf(5) });
  const out = await sendGamesToMac({ library: lib, systems: SYSTEMS, storage: paired(), fetchFn: manifest(), onProgress: (p) => progress.push(p),
    upload: fakeUpload({ 'bstars.zip': ['stall', 'stall'] }, log), stallMs: 20, isHidden: () => false });
  assert.deepEqual(log, ['superspy.zip:ok', 'bstars.zip:stall', 'bstars.zip:stall', 'burningf.zip:ok']);
  assert.equal(out.status, 'done');
  assert.equal(out.sent, 2);
  assert.match(out.text, /2 jeux envoyés au Mac ; 1 fichier interrompu/);
  assert.ok(progress.some((p) => p.name === 'bstars.zip' && p.sentBytes === 2 && p.size === 4), 'progression en octets du jeu en cours');
  assert.ok(progress.some((p) => p.name === 'bstars.zip' && p.retry === true), 'nouvel essai annoncé');
});

test('T52 téléphone : un essai interrompu puis réussi compte comme envoyé ; le jeu interrompu n\'est pas noté « venu du Mac »', async () => {
  const log = [];
  const storage = paired();
  const out = await sendGamesToMac({ library: library({ 'roms/neogeo/bstars.zip': blobOf(4), 'roms/neogeo/kotm.zip': blobOf(6) }), systems: SYSTEMS, storage, fetchFn: manifest(),
    upload: fakeUpload({ 'bstars.zip': ['stall', 'ok'], 'kotm.zip': ['stall', 'stall'] }, log), stallMs: 20, isHidden: () => false });
  assert.equal(out.sent, 1);
  assert.deepEqual(Object.keys(readSyncPairing(storage).files), ['roms/neogeo/bstars.zip']);
});

test('T52 téléphone : Clone90 en arrière-plan (autre appli, écran éteint) -> pas d\'abandon tant que la page est cachée', async () => {
  let hidden = true;
  setTimeout(() => { hidden = false; }, 80);
  const log = [];
  const started = Date.now();
  const out = await sendGamesToMac({ library: library({ 'roms/neogeo/bstars.zip': blobOf(4) }), systems: SYSTEMS, storage: paired(), fetchFn: manifest(),
    upload: fakeUpload({ 'bstars.zip': ['stall', 'ok'] }, log), stallMs: 20, isHidden: () => hidden });
  assert.ok(Date.now() - started >= 80, 'attend le retour au premier plan avant de juger l\'envoi bloqué');
  assert.deepEqual(log, ['bstars.zip:stall', 'bstars.zip:ok']);
  assert.equal(out.sent, 1);
});

test('T52 téléphone : Mac occupé (ancien envoi pas encore libéré) -> attente puis nouvel essai ; toujours occupé -> compté, jeu suivant', async () => {
  const log = [];
  const waits = [];
  const out = await sendGamesToMac({ library: library({ 'roms/neogeo/a.zip': blobOf(1), 'roms/neogeo/b.zip': blobOf(2) }), systems: SYSTEMS, storage: paired(), fetchFn: manifest(),
    upload: fakeUpload({ 'a.zip': ['busy', 'busy', 'ok'], 'b.zip': Array(30).fill('busy') }, log), stallMs: 20, busyWaitMs: 7, busyTries: 4,
    wait: async (ms) => { waits.push(ms); } });
  assert.deepEqual(log.filter((l) => l.startsWith('a.zip')), ['a.zip:busy', 'a.zip:busy', 'a.zip:ok']);
  assert.equal(log.filter((l) => l.startsWith('b.zip')).length, 4);
  assert.ok(waits.every((ms) => ms === 7));
  assert.match(out.text, /1 jeu envoyé au Mac ; 1 fichier non envoyé : le Mac recevait déjà un autre envoi/);
});

test('T52 téléphone : le BIOS neogeo.zip rangé avec les jeux n\'est pas envoyé ; un jeu déjà sur le Mac est signalé et l\'envoi continue', async () => {
  const log = [];
  const out = await sendGamesToMac({ library: library({ 'roms/neogeo/neogeo.zip': blobOf(1), 'roms/neogeo/bstars.zip': blobOf(2), 'roms/neogeo/kotm.zip': blobOf(3) }),
    systems: SYSTEMS, storage: paired(), fetchFn: manifest(), upload: fakeUpload({ 'bstars.zip': ['exists'] }, log), stallMs: 1000 });
  assert.deepEqual(log, ['bstars.zip:exists', 'kotm.zip:ok']);
  assert.match(out.text, /1 jeu envoyé au Mac ; 1 jeu non envoyé : un fichier du même nom est déjà sur le Mac/);
});

test('T52 écran gardé allumé pendant l\'envoi (Wake Lock), redemandé au retour sur Clone90, rendu à la fin ; sans Wake Lock : rien', async () => {
  const events = [];
  const listeners = {};
  const doc = { visibilityState: 'visible', addEventListener: (t, f) => { listeners[t] = f; }, removeEventListener: (t) => { delete listeners[t]; } };
  const nav = { wakeLock: { request: async (type) => { events.push(`demande ${type}`); return { release: async () => { events.push('rendu'); } }; } } };
  const release = await keepScreenOn({ nav, doc });
  listeners.visibilitychange();
  await new Promise((r) => setTimeout(r, 0));
  await release();
  assert.deepEqual(events, ['demande screen', 'demande screen', 'rendu']);
  assert.equal(listeners.visibilitychange, undefined);
  const none = await keepScreenOn({ nav: {}, doc });
  await none();
  const refused = await keepScreenOn({ nav: { wakeLock: { request: async () => { throw new Error('refusé'); } } }, doc });
  await refused();
});

// --- Mac ---
async function macServer({ idleMs }) {
  const roms = await mkdtemp(join(tmpdir(), 'clone90-t52-'));
  await mkdir(join(roms, 'neogeo'));
  const pairing = { acceptUploads: true, isValidToken: (t) => t === TOKEN };
  const handler = createSyncHandler({ pairing, getDirs: async () => ({ romsDir: roms, biosDir: join(roms, 'bios') }), getSystemIds: async () => IDS,
    getBiosFiles: async () => BIOS, getCa: () => '', getFreeBytes: async () => Infinity, idleMs });
  const server = http.createServer(handler);
  const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
  return { roms, server, port };
}
/** Envoie `send` octets d'un fichier annoncé à `length` octets, puis ne dit plus rien (téléphone en pause) sauf si `send === length`. */
function post(port, path, { length, send }) {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: `/sync/upload?path=${encodeURIComponent(path)}`,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Length': length } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(Buffer.concat(chunks).toString() || 'null') }));
    });
    req.on('error', () => resolve({ status: 0, body: null }));
    req.write(Buffer.alloc(send, 1));
    if (send === length) req.end();
  });
}

test('T52 Mac : un envoi qui n\'avance plus est abandonné après le délai : rien de gardé à moitié, verrou libéré, envoi suivant reçu', async () => {
  const { roms, server, port } = await macServer({ idleMs: 150 });
  try {
    const stalled = post(port, 'roms/neogeo/bstars.zip', { length: 4000, send: 1000 });
    await new Promise((r) => setTimeout(r, 40));
    assert.equal((await post(port, 'roms/neogeo/kotm.zip', { length: 10, send: 10 })).status, 429, 'pendant l\'envoi en pause : occupé');
    const first = await stalled;
    assert.notEqual(first.status, 201);
    // Le téléphone voit la connexion coupée juste avant que le Mac ait fini d'effacer son fichier temporaire : on lui laisse 1 s.
    for (let i = 0; i < 20 && (await readdir(join(roms, 'neogeo'))).length; i += 1) await new Promise((r) => setTimeout(r, 50));
    assert.deepEqual(await readdir(join(roms, 'neogeo')), [], 'ni jeu à moitié écrit ni fichier temporaire');
    const next = await post(port, 'roms/neogeo/kotm.zip', { length: 10, send: 10 });
    assert.equal(next.status, 201, 'verrou libéré');
    assert.equal((await readFile(join(roms, 'neogeo/kotm.zip'))).length, 10);
  } finally { server.close(); }
});

test('T52 Mac : le BIOS déclaré neogeo.zip est refusé dans roms/neogeo (message clair), un jeu lent mais qui avance est gardé', async () => {
  const { roms, server, port } = await macServer({ idleMs: 150 });
  try {
    const bios = await post(port, 'roms/neogeo/neogeo.zip', { length: 10, send: 10 });
    assert.equal(bios.status, 400);
    assert.match(bios.body.message, /BIOS/);
    const slow = await new Promise((resolve) => {
      const req = http.request({ host: '127.0.0.1', port, method: 'POST', path: '/sync/upload?path=roms%2Fneogeo%2Fbstars.zip',
        headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Length': 5 } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
      let n = 0;
      const tick = setInterval(() => { req.write(Buffer.from([n])); n += 1; if (n === 5) { clearInterval(tick); req.end(); } }, 100);
    });
    assert.equal(slow, 201, '5 morceaux espacés de 100 ms, délai de 150 ms entre deux morceaux : gardé');
    assert.deepEqual((await readdir(join(roms, 'neogeo'))).sort(), ['bstars.zip']);
  } finally { server.close(); }
  assert.equal(UPLOAD_IDLE_MS, 60000);
});

test('T52 Mac : receiveUpload seul refuse un BIOS déclaré sans rien lire', async () => {
  const roms = await mkdtemp(join(tmpdir(), 'clone90-t52b-'));
  const req = { headers: { 'content-length': '3' } };
  const out = await receiveUpload(req, { path: 'roms/neogeo/neogeo.zip', romsDir: roms, systemIds: IDS, biosFiles: BIOS });
  assert.equal(out.status, 400);
  assert.equal(out.body.error, 'bios');
});
