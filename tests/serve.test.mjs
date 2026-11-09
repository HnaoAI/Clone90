// Tests de scripts/serve.mjs (T1) : serveur statique local sans dépendance.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { createStaticServer } from '../scripts/serve.mjs';

let sandbox; // dossier parent : contient "site/" (racine servie) et "secret.txt" (hors racine)
let server;
let port;

before(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'clone90-serve-'));
  const site = join(sandbox, 'site');
  mkdirSync(join(site, 'sub'), { recursive: true });
  writeFileSync(join(sandbox, 'secret.txt'), 'SECRET');
  writeFileSync(join(site, 'index.html'), '<h1>accueil</h1>');
  writeFileSync(join(site, 'sub', 'index.html'), '<h1>sous-dossier</h1>');
  writeFileSync(join(site, 'app.js'), 'export const a = 1;');
  writeFileSync(join(site, 'style.css'), 'body{}');
  writeFileSync(join(site, 'systems.json'), '{}');
  writeFileSync(join(site, 'manifest.webmanifest'), '{}');
  writeFileSync(join(site, 'core.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]));
  writeFileSync(join(site, 'jeu.adf'), Buffer.from('0123456789'));
  writeFileSync(join(site, 'fichier avec espace.txt'), 'espace');
  server = createStaticServer({ root: site });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  rmSync(sandbox, { recursive: true, force: true });
});

const get = (path, headers = {}) => fetch(`http://127.0.0.1:${port}${path}`, { headers });

/** Envoie une requête HTTP brute (fetch normalise "../" avant l'envoi, pas ce client). */
function rawRequest(requestTarget) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => {
      socket.write(`GET ${requestTarget} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n`);
    });
    let data = '';
    socket.on('data', (chunk) => { data += chunk; });
    socket.on('end', () => resolve(data));
    socket.on('error', reject);
  });
}

test('sert index.html pour la racine /', async () => {
  const res = await get('/');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '<h1>accueil</h1>');
  assert.match(res.headers.get('content-type'), /^text\/html/);
});

test('sert index.html d\'un sous-dossier', async () => {
  const res = await get('/sub/');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '<h1>sous-dossier</h1>');
});

test('types MIME corrects pour js, css, json, webmanifest, wasm et inconnu', async () => {
  const expected = {
    '/app.js': /^(text|application)\/javascript/,
    '/style.css': /^text\/css/,
    '/systems.json': /^application\/json/,
    '/manifest.webmanifest': /^application\/manifest\+json/,
    '/core.wasm': /^application\/wasm$/,
    '/jeu.adf': /^application\/octet-stream$/,
  };
  for (const [path, pattern] of Object.entries(expected)) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), pattern, path);
    await res.arrayBuffer();
  }
});

test('envoie Cache-Control: no-cache', async () => {
  const res = await get('/app.js');
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  await res.arrayBuffer();
});

test('404 propre (page texte, pas de plantage) pour un fichier absent', async () => {
  const res = await get('/absent.html');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  assert.match(await res.text(), /404/);
});

test('404 pour un dossier sans index.html (pas de listing)', async () => {
  mkdirSync(join(sandbox, 'site', 'vide'), { recursive: true });
  const res = await get('/vide/');
  assert.equal(res.status, 404);
  await res.text();
});

test('refuse de sortir du dossier avec ../ brut', async () => {
  const reponse = await rawRequest('/../secret.txt');
  assert.doesNotMatch(reponse, /SECRET/);
  assert.match(reponse, /^HTTP\/1\.1 (400|403|404)/);
});

test('refuse de sortir du dossier avec ../ encodé et variantes', async () => {
  for (const cible of ['/%2e%2e/secret.txt', '/..%2fsecret.txt', '/sub/../../secret.txt',
    '/%2e%2e%2fsecret.txt', '/..\\secret.txt']) {
    const reponse = await rawRequest(cible);
    assert.doesNotMatch(reponse, /SECRET/, cible);
    assert.match(reponse, /^HTTP\/1\.1 (400|403|404)/, cible);
  }
});

test('refuse un octet nul et un encodage invalide (400)', async () => {
  for (const cible of ['/index.html%00.png', '/%E0%A4%A']) {
    const reponse = await rawRequest(cible);
    assert.match(reponse, /^HTTP\/1\.1 400/, cible);
  }
});

test('ignore la query string et décode les espaces', async () => {
  const a = await get('/app.js?v=3');
  assert.equal(a.status, 200);
  await a.text();
  const b = await get('/fichier%20avec%20espace.txt');
  assert.equal(await b.text(), 'espace');
});

test('requêtes Range : 206 avec Content-Range, 416 hors limites', async () => {
  const partiel = await get('/jeu.adf', { Range: 'bytes=2-4' });
  assert.equal(partiel.status, 206);
  assert.equal(partiel.headers.get('content-range'), 'bytes 2-4/10');
  assert.equal(await partiel.text(), '234');
  const fin = await get('/jeu.adf', { Range: 'bytes=-3' });
  assert.equal(await fin.text(), '789');
  const hors = await get('/jeu.adf', { Range: 'bytes=50-60' });
  assert.equal(hors.status, 416);
  await hors.text();
});

test('méthode autre que GET/HEAD : 405 ; HEAD sans corps', async () => {
  const post = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' });
  assert.equal(post.status, 405);
  await post.text();
  const head = await fetch(`http://127.0.0.1:${port}/app.js`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String('export const a = 1;'.length));
  assert.equal(await head.text(), '');
});
