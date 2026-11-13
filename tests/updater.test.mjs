// Tests T35 côté Mac : numéros de version, lecture de la dernière version (fetch factice), état de la copie git (git factice puis vrai git
// sur un dépôt temporaire), application par pull en avance rapide (vrai git, origine locale), API locale api/update..., relance du serveur.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EventEmitter } from 'node:events';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseAppVersion, compareVersions, fetchLatestVersion, checkRepository, checkForUpdate, applyUpdate, runGit, LATEST_VERSION_URL,
} from '../scripts/updater.mjs';
import { createStaticServer, createRestarter } from '../scripts/serve.mjs';
import { createSettingsApi } from '../scripts/settings-api.mjs';

const versionFile = (v) => `// Version\nexport const APP_VERSION = '${v}';\n`;
const textFetch = (status, text, calls = []) => async (url, init) => { calls.push({ url, init }); return { ok: status === 200, status, text: async () => text }; };

test('T35 numéros de version : lecture de js/version.js, comparaison x.y.z numérique ; texte vide ou sans numéro : null', () => {
  assert.equal(parseAppVersion(versionFile('0.35.0')), '0.35.0');
  assert.equal(parseAppVersion(''), null);
  assert.equal(parseAppVersion(undefined), null);
  assert.equal(parseAppVersion("export const APP_VERSION = 'v1';"), null);
  assert.ok(compareVersions('0.35.0', '0.34.1') > 0);
  assert.ok(compareVersions('0.9.0', '0.10.0') < 0, 'comparaison numérique, pas alphabétique');
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0);
});

test('T35 dernière version : une seule adresse fixe (github.com, main), sans cache ; réponse en erreur, trop grande ou sans numéro : erreur', async () => {
  const calls = [];
  assert.equal(await fetchLatestVersion(textFetch(200, versionFile('0.40.2'), calls)), '0.40.2');
  assert.equal(calls[0].url, LATEST_VERSION_URL);
  assert.match(LATEST_VERSION_URL, /^https:\/\/raw\.githubusercontent\.com\/HnaoAI\/Clone90\/main\/js\/version\.js$/);
  assert.equal(calls[0].init.cache, 'no-store');
  await assert.rejects(fetchLatestVersion(textFetch(404, '')), /404/);
  await assert.rejects(fetchLatestVersion(textFetch(200, '<html>')), /introuvable/);
  await assert.rejects(fetchLatestVersion(textFetch(200, versionFile('1.0.0') + ' '.repeat(70_000))), /introuvable/);
});

/** git factice : réponses par commande. */
const fakeGit = (answers, calls = []) => async (root, args) => {
  calls.push(args.join(' '));
  const a = answers[args[0] === 'rev-parse' ? args.join(' ') : args[0]];
  if (a instanceof Error) throw a;
  return a ?? '';
};
const GOOD = { 'rev-parse --is-inside-work-tree': 'true', remote: 'https://github.com/HnaoAI/Clone90.git', 'rev-parse --abbrev-ref HEAD': 'main', status: '' };

test('T35 copie git : acceptée seulement si dépôt officiel (https ou ssh), branche main, aucun fichier suivi modifié ; sinon message et commande à la main', async () => {
  assert.deepEqual(await checkRepository('/x', fakeGit(GOOD)), { ok: true });
  assert.equal((await checkRepository('/x', fakeGit({ ...GOOD, remote: 'git@github.com:HnaoAI/Clone90.git' }))).ok, true);
  const cases = [
    [{ ...GOOD, 'rev-parse --is-inside-work-tree': Object.assign(new Error('x'), { code: 'ENOENT' }) }, 'no-git'],
    [{ ...GOOD, 'rev-parse --is-inside-work-tree': new Error('fatal: not a git repository') }, 'not-a-repo'],
    [{ ...GOOD, remote: 'https://github.com/pirate/Clone90.git' }, 'other-origin'],
    [{ ...GOOD, remote: 'https://github.com/HnaoAI/Clone90.git.evil.test' }, 'other-origin'],
    [{ ...GOOD, 'rev-parse --abbrev-ref HEAD': 'ticket/T35' }, 'other-branch'],
    [{ ...GOOD, status: ' M js/app.js' }, 'local-changes'],
  ];
  for (const [answers, code] of cases) {
    const r = await checkRepository('/x', fakeGit(answers));
    assert.equal(r.code, code);
    assert.match(r.message, /git pull/);
  }
});

test('T35 vérification : à jour, disponible (applicable ou non, avec la raison), erreur réseau ou version installée illisible', async () => {
  const root = await mkdtemp(join(tmpdir(), 'clone90-maj-'));
  await mkdir(join(root, 'js'));
  await writeFile(join(root, 'js', 'version.js'), versionFile('0.34.1'));
  assert.deepEqual(await checkForUpdate({ root, fetchFn: textFetch(200, versionFile('0.34.1')), git: fakeGit(GOOD) }), { status: 'uptodate', current: '0.34.1' });
  assert.deepEqual(await checkForUpdate({ root, fetchFn: textFetch(200, versionFile('0.35.0')), git: fakeGit(GOOD) }),
    { status: 'available', current: '0.34.1', latest: '0.35.0', canApply: true });
  const blocked = await checkForUpdate({ root, fetchFn: textFetch(200, versionFile('0.35.0')), git: fakeGit({ ...GOOD, status: ' M sw.js' }) });
  assert.equal(blocked.canApply, false);
  assert.match(blocked.message, /modifiés/);
  const offline = await checkForUpdate({ root, fetchFn: async () => { throw new TypeError('fetch failed'); }, git: fakeGit(GOOD) });
  assert.equal(offline.status, 'error');
  assert.match(offline.message, /Internet/);
  assert.equal((await checkForUpdate({ root: join(root, 'absent'), fetchFn: textFetch(200, versionFile('9.0.0')) })).status, 'error');
});

// --- Vrai git : dépôt « officiel » local, copie de Hicham ; seul `remote get-url` est remplacé (l'origine réelle est un dossier local). ---
const sh = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });
async function gitSetup() {
  const base = await mkdtemp(join(tmpdir(), 'clone90-git-'));
  const upstream = join(base, 'officiel');
  await mkdir(join(upstream, 'js'), { recursive: true });
  sh(upstream, 'init', '-q', '-b', 'main');
  await writeFile(join(upstream, 'js', 'version.js'), versionFile('0.34.1'));
  await writeFile(join(upstream, '.gitignore'), 'roms/\nclone90.local.json\n');
  sh(upstream, 'add', '.'); sh(upstream, 'commit', '-q', '-m', 'v0.34.1');
  const local = join(base, 'emulateur');
  sh(base, 'clone', '-q', upstream, local);
  await mkdir(join(local, 'roms', 'amiga'), { recursive: true });
  await writeFile(join(local, 'roms', 'amiga', 'jeu.adf'), 'JEU');
  await writeFile(join(local, 'clone90.local.json'), '{"romsDir":"x"}');
  await writeFile(join(local, 'notes.txt'), 'non suivi');
  const publish = async (v) => { await writeFile(join(upstream, 'js', 'version.js'), versionFile(v)); sh(upstream, 'commit', '-q', '-am', v); };
  const git = (root, args) => (args[0] === 'remote' ? Promise.resolve('https://github.com/HnaoAI/Clone90.git') : runGit(root, args));
  return { local, upstream, publish, git };
}

test('T35 application (vrai git) : pull en avance rapide, version lue après ; jeux, réglages et fichiers non suivis intacts', async () => {
  const g = await gitSetup();
  assert.deepEqual(await checkRepository(g.local, g.git), { ok: true }, 'fichiers non suivis permis');
  await g.publish('0.35.0');
  assert.deepEqual(await applyUpdate({ root: g.local, git: g.git }), { ok: true, version: '0.35.0' });
  assert.equal(await readFile(join(g.local, 'roms', 'amiga', 'jeu.adf'), 'utf8'), 'JEU');
  assert.equal(await readFile(join(g.local, 'clone90.local.json'), 'utf8'), '{"romsDir":"x"}');
  assert.equal(await readFile(join(g.local, 'notes.txt'), 'utf8'), 'non suivi');
});

test('T35 application (vrai git) : fichier suivi modifié ou historique divergent : refus, rien n\'est changé, message en français', async () => {
  const g = await gitSetup();
  await g.publish('0.35.0');
  await writeFile(join(g.local, 'js', 'version.js'), versionFile('0.34.9'));
  const dirty = await applyUpdate({ root: g.local, git: g.git });
  assert.equal(dirty.ok, false);
  assert.match(dirty.message, /ne les écrase pas/);
  assert.match(await readFile(join(g.local, 'js', 'version.js'), 'utf8'), /0\.34\.9/);
  sh(g.local, 'commit', '-q', '-am', 'local');
  const head = sh(g.local, 'rev-parse', 'HEAD');
  const diverged = await applyUpdate({ root: g.local, git: g.git });
  assert.equal(diverged.ok, false);
  assert.match(diverged.message, /Rien n'a été changé/);
  assert.equal(sh(g.local, 'rev-parse', 'HEAD'), head, 'jamais de fusion');
});

// --- API locale ---
async function apiSetup({ enabled = true, checkUpdate, runUpdate, downloadCovers } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'clone90-uapi-'));
  await writeFile(join(root, 'index.html'), '<title>x</title>');
  const calls = { restart: 0, regenerate: 0, run: 0 };
  let server;
  const api = createSettingsApi({
    root, enabled, getPort: () => server.address().port, applyFolders: () => {}, chooseFolder: async () => null,
    regenerate: async () => { calls.regenerate += 1; return { exitCode: 0 }; },
    downloadCovers: downloadCovers ?? (async () => ({ exitCode: 0, summary: { found: [] } })),
    checkUpdate: checkUpdate ?? (async () => ({ status: 'uptodate', current: '0.35.0' })),
    runUpdate: async () => { calls.run += 1; return (runUpdate ?? (async () => ({ ok: true, version: '0.35.0' })))(); },
    restart: () => { calls.restart += 1; },
  });
  server = createStaticServer({ root, api });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const { port } = server.address();
  const call = (method, path, { headers = {}, json } = {}) => new Promise((resolve, reject) => {
    const h = { 'X-Clone90': '1', ...(json !== undefined && { 'Content-Type': 'application/json' }), ...headers };
    const req = http.request({ host: '127.0.0.1', port, method, path, headers: h }, (res) => {
      let text = '';
      res.on('data', (c) => { text += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: () => JSON.parse(text) }));
    });
    req.on('error', reject);
    req.end(json !== undefined ? JSON.stringify(json) : undefined);
  });
  return { calls, call, close: () => server.close() };
}
const until = async (fn) => { for (let i = 0; i < 400; i += 1) { const v = await fn(); if (v) return v; await new Promise((r) => setTimeout(r, 5)); } throw new Error('délai dépassé'); };

test('T35 API mise à jour : désactivée hors du Mac (404) ; sans X-Clone90, autre hôte ou corps non vide : refus, rien lancé', async () => {
  const off = await apiSetup({ enabled: false });
  try {
    assert.equal((await off.call('POST', '/api/update/check', { json: {} })).status, 404);
    assert.equal((await off.call('POST', '/api/update/apply', { json: {} })).status, 404);
  } finally { off.close(); }
  const t = await apiSetup();
  try {
    assert.equal((await t.call('POST', '/api/update/apply', { json: {}, headers: { 'X-Clone90': '' } })).status, 403);
    assert.equal((await t.call('POST', '/api/update/apply', { json: {}, headers: { Host: 'piege.test' } })).status, 403);
    assert.equal((await t.call('POST', '/api/update/apply', { json: { branch: 'pirate' } })).status, 400);
    assert.equal((await t.call('POST', '/api/update/check', { json: { url: 'https://x' } })).status, 400);
    assert.equal(t.calls.run, 0);
  } finally { t.close(); }
});

test('T35 API mise à jour : check rend le résultat ; apply 202 puis terminé avec la version, games.json régénéré, serveur relancé', async () => {
  const t = await apiSetup({ checkUpdate: async () => ({ status: 'available', current: '0.34.1', latest: '0.35.0', canApply: true }) });
  try {
    assert.deepEqual((await t.call('POST', '/api/update/check', { json: {} })).json(), { status: 'available', current: '0.34.1', latest: '0.35.0', canApply: true });
    assert.equal((await t.call('POST', '/api/update/apply', { json: {} })).status, 202);
    const done = await until(async () => { const s = (await t.call('GET', '/api/update')).json(); return s.status === 'done' && s; });
    assert.equal(done.version, '0.35.0');
    assert.equal(t.calls.regenerate, 1);
    await until(() => t.calls.restart === 1);
  } finally { t.close(); }
});

test('T35 API mise à jour : échec du pull : état erreur avec le message de l\'updater, pas de relance ; verrou partagé avec les pochettes', async () => {
  let release;
  const t = await apiSetup({
    runUpdate: async () => ({ ok: false, message: 'Des fichiers de Clone90 ont été modifiés.' }),
    downloadCovers: () => new Promise((r) => { release = () => r({ exitCode: 0, summary: { found: [] } }); }),
  });
  try {
    await t.call('POST', '/api/update/apply', { json: {} });
    const err = await until(async () => { const s = (await t.call('GET', '/api/update')).json(); return s.status === 'error' && s; });
    assert.equal(err.message, 'Des fichiers de Clone90 ont été modifiés.');
    await new Promise((r) => setTimeout(r, 350));
    assert.equal(t.calls.restart, 0);
    assert.equal((await t.call('POST', '/api/covers/download', { json: {} })).status, 202);
    const busy = await t.call('POST', '/api/update/apply', { json: {} });
    assert.equal(busy.status, 409);
    release();
  } finally { t.close(); }
});

test('T35 relance du serveur : écoute fermée, même commande relancée, signaux relayés, sortie avec le nouveau serveur, une seule fois', () => {
  const server = { closed: 0, close(cb) { this.closed += 1; cb(); }, closeAllConnections() { this.dropped = true; } };
  const child = Object.assign(new EventEmitter(), { killed: [], kill(sig) { this.killed.push(sig); } });
  const spawned = [];
  const proc = Object.assign(new EventEmitter(), { execPath: '/usr/bin/node', argv: ['/usr/bin/node', 'scripts/serve.mjs', '--host', '127.0.0.1'], exitCode: null, exit(c) { this.exitCode = c; } });
  const restart = createRestarter({ server, proc, spawnFn: (cmd, args) => { spawned.push([cmd, ...args]); return child; } });
  restart();
  restart();
  assert.equal(server.closed, 1);
  assert.equal(server.dropped, true);
  assert.deepEqual(spawned, [['/usr/bin/node', 'scripts/serve.mjs', '--host', '127.0.0.1']]);
  proc.emit('SIGTERM');
  assert.deepEqual(child.killed, ['SIGTERM']);
  child.emit('exit', 0, null);
  assert.equal(proc.exitCode, 0);
});
