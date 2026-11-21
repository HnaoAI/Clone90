// Tests T51 : le téléphone trouve le Mac seul (js/sync-discovery.js, discoveryCandidates et readHello de js/sync-plan.js) et le retrouve s'il a
// changé d'adresse (js/sync-client.js). Sans réseau : fetch factice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoveryCandidates, readHello, macNameUrl } from '../js/sync-plan.js';
import { findMac, probeMac } from '../js/sync-discovery.js';
import { pairWithMac, syncFromMac, readSyncPairing, saveSyncPairing } from '../js/sync-client.js';

const TOKEN = 'a'.repeat(64);
const OTHER_TOKEN = 'b'.repeat(64);
function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}
const json = (body, status = 200) => ({ ok: status < 300, status, json: async () => body });
/** Réseau factice : `macs` = {origine: {name, token}} ; toute autre adresse ne répond pas. */
function fakeNetwork(macs, log = []) {
  return async (url, init = {}) => {
    log.push(url);
    const origin = new URL(url).origin;
    const mac = macs[origin];
    if (!mac) throw new TypeError('Failed to fetch');
    if (url.endsWith('/sync/hello')) return json({ app: 'clone90', version: 1, name: mac.name });
    if (url.endsWith('/sync/manifest')) return init.headers?.Authorization === `Bearer ${mac.token}` ? json({ version: 1, files: [] }) : json({}, 401);
    if (url.endsWith('/sync/pair')) return json({ token: mac.token });
    return json({}, 404);
  };
}

test('T51 recherche : adresses connues d\'abord (dernière adresse, nom .local), puis balayage de son réseau, de 192.168.1.x et 192.168.0.x', () => {
  const first = discoveryCandidates();
  assert.deepEqual(first.priority, []);
  assert.equal(first.scan.length, 508);
  assert.equal(first.scan[0], 'https://192.168.1.1:8443');
  assert.equal(first.scan[254], 'https://192.168.0.1:8443');
  const known = discoveryCandidates({ saved: 'https://10.0.0.12:8443', name: 'mac-de-hicham.local' });
  assert.deepEqual(known.priority, ['https://10.0.0.12:8443', 'https://mac-de-hicham.local:8443']);
  assert.equal(known.scan[0], 'https://10.0.0.1:8443');
  assert.equal(known.scan.includes('https://10.0.0.12:8443'), false, 'pas deux fois la même adresse');
  assert.equal(known.scan.length, 254 * 3 - 1);
  assert.deepEqual(discoveryCandidates({ manual: '192.168.1.93' }), { priority: ['https://192.168.1.93:8443'], scan: [] });
  assert.equal(discoveryCandidates({ manual: 'http://192.168.1.93' }), null);
  assert.equal(discoveryCandidates({ manual: 'exemple.com' }), null);
  for (const u of [...first.scan, ...known.scan, ...known.priority]) assert.match(u, /^https:\/\/(192\.168\.|10\.|[a-z0-9-]+\.local:)/);
});

test('T51 recherche : réponse « je suis un Mac Clone90 » contrôlée ; nom .local seulement', () => {
  assert.deepEqual(readHello({ app: 'clone90', name: 'mac.local' }), { name: 'mac.local' });
  assert.deepEqual(readHello({ app: 'clone90', name: 'evil.com' }), { name: null });
  for (const b of [null, {}, { app: 'autre' }, 'clone90', []]) assert.equal(readHello(b), null);
  assert.equal(macNameUrl('mac.local'), 'https://mac.local:8443');
  assert.equal(macNameUrl('mac'), null);
});

test('T51 recherche : le Mac est trouvé par balayage ; aucune donnée envoyée (pas de cookie ni d\'adresse du site) ; arrêt au premier trouvé', async () => {
  const log = [];
  const inits = [];
  const net = fakeNetwork({ 'https://192.168.1.93:8443': { name: 'mac-de-hicham.local', token: TOKEN } }, log);
  const found = await findMac({ ...discoveryCandidates(), fetchFn: async (u, i) => { inits.push(i); return net(u, i); }, concurrency: 8 });
  assert.deepEqual(found, { url: 'https://192.168.1.93:8443', name: 'mac-de-hicham.local' });
  assert.ok(log.length < 120, `balayage arrêté tôt (${log.length} essais)`);
  assert.ok(log.every((u) => u.endsWith('/sync/hello')));
  assert.ok(inits.every((i) => i.credentials === 'omit' && i.referrerPolicy === 'no-referrer' && !i.headers && !i.body));
});

test('T51 recherche : aucun Mac -> null ; une adresse qui ne répond pas est abandonnée après le délai ; un autre serveur n\'est pas pris pour le Mac', async () => {
  assert.equal(await findMac({ priority: [], scan: ['https://192.168.1.1:8443', 'https://192.168.1.2:8443'], fetchFn: fakeNetwork({}) }), null);
  const hang = (url, init) => new Promise((_, reject) => { init.signal?.addEventListener('abort', () => reject(new Error('abort'))); });
  const t0 = Date.now();
  assert.equal(await probeMac('https://192.168.1.5:8443', { fetchFn: hang, timeoutMs: 50 }), null);
  assert.ok(Date.now() - t0 < 1000);
  const notClone90 = async () => json({ hello: 'routeur' });
  assert.equal(await probeMac('https://192.168.1.1:8443', { fetchFn: notClone90 }), null);
  const progress = [];
  await findMac({ priority: ['https://192.168.1.9:8443'], scan: ['https://192.168.1.1:8443'], fetchFn: fakeNetwork({}), onProgress: (p) => progress.push(p) });
  assert.deepEqual(progress.at(-1), { done: 2, total: 2 });
});

test('T51 recherche : le premier essai attend plus longtemps (demande d\'accès au réseau local de Chrome), les suivants non', async () => {
  const timeouts = [];
  const fetchFn = (url, init) => new Promise((_, reject) => {
    const t0 = Date.now();
    init.signal.addEventListener('abort', () => { timeouts.push(Date.now() - t0); reject(new Error('abort')); });
  });
  await findMac({ priority: [], scan: ['https://192.168.1.1:8443', 'https://192.168.1.2:8443'], fetchFn, timeoutMs: 30, firstTimeoutMs: 200 });
  assert.equal(timeouts.length, 2);
  assert.ok(timeouts[0] >= 150, `premier : ${timeouts[0]} ms`);
  assert.ok(timeouts[1] < 150, `suivant : ${timeouts[1]} ms`);
});

test('T51 synchro : le Mac a changé d\'adresse -> retrouvé par son nom .local même à l\'ouverture, nouvelle adresse gardée', async () => {
  const storage = memoryStorage();
  saveSyncPairing({ url: 'https://192.168.1.93:8443', name: 'mac-de-hicham.local', token: TOKEN, files: {}, lastSync: null }, storage);
  const fetchFn = fakeNetwork({ 'https://mac-de-hicham.local:8443': { name: 'mac-de-hicham.local', token: TOKEN } });
  const out = await syncFromMac({ library: { list: async () => [] }, systems: [], fetchFn, storage, quiet: true, find: async () => assert.fail('pas de balayage à l\'ouverture') });
  assert.equal(out.status, 'done');
  assert.equal(readSyncPairing(storage).url, 'https://mac-de-hicham.local:8443');
});

test('T51 synchro : « Synchroniser maintenant » balaie le réseau si besoin ; un autre Mac Clone90 (jeton refusé) n\'est jamais retenu', async () => {
  const storage = memoryStorage();
  saveSyncPairing({ url: 'https://192.168.1.93:8443', name: null, token: TOKEN, files: {}, lastSync: null }, storage);
  const moved = fakeNetwork({ 'https://192.168.1.40:8443': { name: 'mac.local', token: TOKEN } });
  const quiet = await syncFromMac({ library: { list: async () => [] }, systems: [], fetchFn: moved, storage, quiet: true });
  assert.deepEqual(quiet, { status: 'unreachable', text: null, changed: false }, 'à l\'ouverture : rien de plus, aucun message');
  const out = await syncFromMac({ library: { list: async () => [] }, systems: [], fetchFn: moved, storage, find: findMac });
  assert.equal(out.status, 'done');
  assert.equal(readSyncPairing(storage).url, 'https://192.168.1.40:8443');
  const storage2 = memoryStorage();
  saveSyncPairing({ url: 'https://192.168.1.93:8443', name: null, token: TOKEN, files: {}, lastSync: null }, storage2);
  const stranger = fakeNetwork({ 'https://192.168.1.50:8443': { name: 'autre.local', token: OTHER_TOKEN } });
  const refused = await syncFromMac({ library: { list: async () => [] }, systems: [], fetchFn: stranger, storage: storage2, find: findMac });
  assert.equal(refused.status, 'unreachable');
  assert.match(refused.text, /Mac introuvable/);
  assert.equal(readSyncPairing(storage2).url, 'https://192.168.1.93:8443');
});

test('T51 association : mot de passe ressaisi pour le même Mac -> fichiers venus du Mac gardés ; autre Mac -> liste vide', async () => {
  const storage = memoryStorage();
  saveSyncPairing({ url: 'https://192.168.1.93:8443', name: 'mac.local', token: null, files: { 'roms/nes/A.nes': { size: 1, mtime: 1 } }, lastSync: 5 }, storage);
  let searched = null;
  await pairWithMac({ password: 'mot-de-passe', storage, find: async (c) => { searched = c; return { url: 'https://192.168.1.93:8443', name: 'mac.local' }; },
    fetchFn: async () => json({ token: TOKEN }) });
  assert.deepEqual(searched.priority, ['https://192.168.1.93:8443', 'https://mac.local:8443'], 'dernière adresse essayée d\'abord');
  assert.deepEqual(Object.keys(readSyncPairing(storage).files), ['roms/nes/A.nes']);
  await pairWithMac({ password: 'mot-de-passe', storage, find: async () => ({ url: 'https://192.168.1.50:8443', name: 'autre.local' }), fetchFn: async () => json({ token: OTHER_TOKEN }) });
  assert.deepEqual(readSyncPairing(storage).files, {});
});
