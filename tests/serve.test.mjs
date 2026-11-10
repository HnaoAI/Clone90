// Tests de scripts/serve.mjs (T1) : serveur statique local sans dépendance.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, renameSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createStaticServer, PROJECT_ROOT } from '../scripts/serve.mjs';
import { assetUrl } from '../js/data.js';

let site; // racine servie
let sandbox; // dossier parent : contient "site/" (racine servie) et "secret.txt" (hors racine)
let server;
let port;

before(async () => {
  sandbox = mkdtempSync(join(tmpdir(), 'clone90-serve-'));
  site = join(sandbox, 'site');
  for (const d of ['assets', 'js', 'css', 'roms/amiga', '.git', 'config-equipe', 'tickets', 'docs', 'scripts']) {
    mkdirSync(join(site, d), { recursive: true });
  }
  writeFileSync(join(sandbox, 'secret.txt'), 'SECRET');
  writeFileSync(join(site, 'index.html'), '<h1>accueil</h1>');
  writeFileSync(join(site, 'assets', 'index.html'), '<h1>sous-dossier</h1>');
  writeFileSync(join(site, 'js', 'app.js'), 'export const a = 1;');
  writeFileSync(join(site, 'css', 'style.css'), 'body{}');
  writeFileSync(join(site, 'systems.json'), '{}');
  writeFileSync(join(site, 'manifest.webmanifest'), '{}');
  writeFileSync(join(site, 'assets', 'core.wasm'), Buffer.from([0, 0x61, 0x73, 0x6d]));
  writeFileSync(join(site, 'roms', 'amiga', 'jeu.adf'), Buffer.from('0123456789'));
  writeFileSync(join(site, 'assets', 'fichier avec espace.txt'), 'espace');
  for (const f of ['.git/config', 'config-equipe/x.md', 'tickets/T1.md', 'docs/a.md', 'scripts/serve.mjs', 'roms/.cache', '.env', 'package.json']) {
    writeFileSync(join(site, f), 'PRIVE');
  }
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
  const res = await get('/assets/');
  assert.equal(res.status, 200);
  assert.equal(await res.text(), '<h1>sous-dossier</h1>');
});

test('types MIME corrects pour js, css, json, webmanifest, wasm et inconnu', async () => {
  const expected = {
    '/js/app.js': /^(text|application)\/javascript/,
    '/css/style.css': /^text\/css/,
    '/systems.json': /^application\/json/,
    '/manifest.webmanifest': /^application\/manifest\+json/,
    '/assets/core.wasm': /^application\/wasm$/,
    '/roms/amiga/jeu.adf': /^application\/octet-stream$/,
  };
  for (const [path, pattern] of Object.entries(expected)) {
    const res = await get(path);
    assert.equal(res.status, 200, path);
    assert.match(res.headers.get('content-type'), pattern, path);
    await res.arrayBuffer();
  }
});

test('envoie Cache-Control: no-cache', async () => {
  const res = await get('/js/app.js');
  assert.equal(res.headers.get('cache-control'), 'no-cache');
  await res.arrayBuffer();
});

test('404 propre (page texte, pas de plantage) pour un fichier absent', async () => {
  const res = await get('/assets/absent.html');
  assert.equal(res.status, 404);
  assert.match(res.headers.get('content-type'), /^text\/plain/);
  assert.match(await res.text(), /404/);
});

test('404 pour un dossier sans index.html (pas de listing)', async () => {
  mkdirSync(join(sandbox, 'site', 'assets', 'vide'), { recursive: true });
  const res = await get('/assets/vide/');
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
  const a = await get('/js/app.js?v=3');
  assert.equal(a.status, 200);
  await a.text();
  const b = await get('/assets/fichier%20avec%20espace.txt');
  assert.equal(await b.text(), 'espace');
});

test('requêtes Range : 206 avec Content-Range, 416 hors limites', async () => {
  const partiel = await get('/roms/amiga/jeu.adf', { Range: 'bytes=2-4' });
  assert.equal(partiel.status, 206);
  assert.equal(partiel.headers.get('content-range'), 'bytes 2-4/10');
  assert.equal(await partiel.text(), '234');
  const fin = await get('/roms/amiga/jeu.adf', { Range: 'bytes=-3' });
  assert.equal(await fin.text(), '789');
  const hors = await get('/roms/amiga/jeu.adf', { Range: 'bytes=50-60' });
  assert.equal(hors.status, 416);
  await hors.text();
});

test('méthode autre que GET/HEAD : 405 ; HEAD sans corps', async () => {
  const post = await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' });
  assert.equal(post.status, 405);
  await post.text();
  const head = await fetch(`http://127.0.0.1:${port}/js/app.js`, { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('content-length'), String('export const a = 1;'.length));
  assert.equal(await head.text(), '');
});

test('liste blanche : 403 sur .git, config-equipe, tickets, docs, scripts, fichiers cachés et inconnus', async () => {
  const interdits = ['/.git/config', '/config-equipe/x.md', '/tickets/T1.md', '/docs/a.md',
    '/scripts/serve.mjs', '/roms/.cache', '/.env', '/package.json', '/%2egit/config'];
  for (const chemin of interdits) {
    const res = await get(chemin);
    assert.equal(res.status, 403, chemin);
    assert.doesNotMatch(await res.text(), /PRIVE/, chemin);
  }
});

test('la racine servie ne dépend pas du dossier courant (défaut : racine du projet)', async () => {
  const libre = createStaticServer({ root: sandbox });
  await new Promise((resolve) => libre.listen(0, '127.0.0.1', resolve));
  const portLibre = libre.address().port;
  await new Promise((resolve) => libre.close(resolve));
  const enfant = spawn(process.execPath, [join(PROJECT_ROOT, 'scripts', 'serve.mjs')],
    { cwd: sandbox, env: { ...process.env, PORT: String(portLibre) } });
  try {
    await new Promise((resolve, reject) => {
      enfant.stdout.on('data', (d) => { if (String(d).includes('Clone90')) resolve(); });
      enfant.on('error', reject);
      enfant.on('exit', () => reject(new Error('serveur arrêté')));
    });
    const res = await fetch(`http://127.0.0.1:${portLibre}/systems.json`);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).version, 1);
    const secret = await fetch(`http://127.0.0.1:${portLibre}/secret.txt`);
    assert.equal(secret.status, 403);
    await secret.text();
  } finally {
    enfant.kill();
  }
});

test('liste blanche sur le vrai projet : les pages et fichiers publics de l\'app sont servis (T7), les dossiers privés non', async () => {
  const realServer = createStaticServer({ root: PROJECT_ROOT });
  await new Promise((resolve) => realServer.listen(0, '127.0.0.1', resolve));
  const realPort = realServer.address().port;
  try {
    const status = async (path) => (await fetch(`http://127.0.0.1:${realPort}${path}`)).status;
    for (const path of ['/player.html', '/css/player.css', '/js/player/launcher.js', '/js/player/exit-guard.js', '/js/player/player-main.js']) {
      assert.equal(await status(path), 200, path);
    }
    for (const path of ['/tickets/T7-lancement.md', '/docs/architecture.md', '/tests/launcher.test.mjs', '/scripts/serve.mjs']) {
      assert.equal(await status(path), 403, path);
    }
  } finally {
    await new Promise((resolve) => realServer.close(resolve));
  }
});

test('liste blanche sur le vrai projet : manifest, service worker, icônes, polices, logos et js/pwa.js sont servis (T8, T5b)', async () => {
  const realServer = createStaticServer({ root: PROJECT_ROOT });
  await new Promise((resolve) => realServer.listen(0, '127.0.0.1', resolve));
  const realPort = realServer.address().port;
  try {
    for (const path of ['/manifest.webmanifest', '/sw.js', '/js/pwa.js', '/assets/icons/icon-192.png', '/assets/icons/icon-512.png',
      '/assets/fonts/PressStart2P-Regular.ttf', '/assets/fonts/OFL.txt', '/assets/logos/amiga.svg']) {
      assert.equal((await fetch(`http://127.0.0.1:${realPort}${path}`)).status, 200, path);
    }
    assert.equal((await fetch(`http://127.0.0.1:${realPort}/assets/fonts/PressStart2P-Regular.ttf`)).headers.get('content-type'), 'font/ttf');
    assert.equal((await fetch(`http://127.0.0.1:${realPort}/scripts/generate-icons.mjs`)).status, 403);
  } finally {
    await new Promise((resolve) => realServer.close(resolve));
  }
});

// T11 / A1 : le serveur doit retrouver les fichiers dont le nom contient # ? % & + etc., demandés avec les URL de assetUrl.
test('sert les fichiers aux noms spéciaux (# ? % & + espaces accents crochets japonais) via assetUrl', async () => {
  const names = ['Turrican II #1.adf', 'Quest? Part 1.adf', '100% Dynamite.adf', 'A&B.adf', 'a+b.adf', 'Lemmings [!].adf', 'Émile ça été.adf', '日本語.zip'];
  for (const name of names) {
    writeFileSync(join(site, 'roms', 'amiga', name), `contenu de ${name}`);
    const res = await get(`/${assetUrl(`roms/amiga/${name}`)}`);
    assert.equal(res.status, 200, name);
    assert.equal(await res.text(), `contenu de ${name}`, name);
    assert.equal((await get(`/${assetUrl(`roms/amiga/${name}`)}`, { Range: 'bytes=0-2' })).status, 206, `${name} (Range)`);
  }
});

// T11 / A7
test('refuse (403) un lien symbolique dont la cible réelle sort de la racine, sert un lien interne à la racine', async () => {
  symlinkSync(join(sandbox, 'secret.txt'), join(site, 'roms', 'amiga', 'dehors.adf'));
  const out = await get('/roms/amiga/dehors.adf');
  assert.equal(out.status, 403);
  assert.ok(!(await out.text()).includes('SECRET'));
  symlinkSync(join(site, 'roms', 'amiga', 'jeu.adf'), join(site, 'roms', 'amiga', 'copie.adf'));
  const inside = await get('/roms/amiga/copie.adf');
  assert.equal(inside.status, 200);
  assert.equal(await inside.text(), '0123456789');
});

test('refuse un dossier lien symbolique vers l\'extérieur de la racine', async () => {
  mkdirSync(join(sandbox, 'dehors'));
  writeFileSync(join(sandbox, 'dehors', 'index.html'), 'SECRET');
  symlinkSync(join(sandbox, 'dehors'), join(site, 'roms', 'lien-dossier'));
  assert.equal((await get('/roms/lien-dossier/')).status, 403);
  assert.equal((await get('/roms/lien-dossier/index.html')).status, 403);
});

test('lien symbolique cassé : 404 comme un fichier absent', async () => {
  symlinkSync(join(sandbox, 'nexiste-pas'), join(site, 'roms', 'amiga', 'casse.adf'));
  assert.equal((await get('/roms/amiga/casse.adf')).status, 404);
});

// T11 / A7
test('X-Content-Type-Options: nosniff sur toutes les réponses (200, 206, 403, 404, 400, 405, 416)', async () => {
  const responses = [
    await get('/'), await get('/roms/amiga/jeu.adf', { Range: 'bytes=0-1' }), await get('/docs/a.md'),
    await get('/roms/amiga/absent.adf'), await get('/%ZZ'), await fetch(`http://127.0.0.1:${port}/`, { method: 'POST' }),
    await get('/roms/amiga/jeu.adf', { Range: 'bytes=99-100' }), await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' }),
  ];
  assert.deepEqual(responses.map((r) => r.status), [200, 206, 403, 404, 400, 405, 416, 200]);
  for (const r of responses) assert.equal(r.headers.get('x-content-type-options'), 'nosniff', `statut ${r.status}`);
});

// T11 / A7, arbitrage PO : roms/ et bios/ peuvent être liés vers un autre emplacement ; leur realpath devient leur racine.
test('roms lié vers un dossier externe : fichiers servis, mais un lien sortant de ce dossier externe est refusé (403)', async () => {
  const ext = join(sandbox, 'disque-externe');
  mkdirSync(join(ext, 'roms', 'amiga'), { recursive: true });
  writeFileSync(join(ext, 'roms', 'amiga', 'ext.adf'), 'EXT');
  writeFileSync(join(ext, 'roms', 'amiga', 'interne.adf'), 'INTERNE');
  symlinkSync(join(ext, 'roms', 'amiga', 'interne.adf'), join(ext, 'roms', 'amiga', 'alias.adf'));
  symlinkSync(join(sandbox, 'secret.txt'), join(ext, 'roms', 'amiga', 'dehors.adf'));
  symlinkSync(join(site, 'docs', 'a.md'), join(ext, 'roms', 'amiga', 'projet.adf'));
  symlinkSync(join(ext, 'roms', 'amiga', 'nexiste-pas'), join(ext, 'roms', 'amiga', 'casse.adf'));
  mkdirSync(join(sandbox, 'ailleurs'));
  writeFileSync(join(sandbox, 'ailleurs', 'x.adf'), 'AILLEURS');
  symlinkSync(join(sandbox, 'ailleurs'), join(ext, 'roms', 'amiga', 'sous-lien'));

  const roms = join(site, 'roms');
  const saved = join(site, 'roms-origine');
  renameSync(roms, saved);
  symlinkSync(join(ext, 'roms'), roms);
  try {
    const ok = await get('/roms/amiga/ext.adf');
    assert.equal(ok.status, 200);
    assert.equal(await ok.text(), 'EXT');
    assert.equal((await get('/roms/amiga/alias.adf')).status, 200, 'lien interne au dossier externe');
    assert.equal((await get('/roms/amiga/dehors.adf')).status, 403, 'lien vers un fichier hors du dossier externe');
    assert.equal((await get('/roms/amiga/projet.adf')).status, 403, 'lien vers ailleurs dans le projet');
    assert.equal((await get('/roms/amiga/sous-lien/x.adf')).status, 403, 'sous-dossier lié ailleurs');
    assert.equal((await get('/roms/amiga/casse.adf')).status, 404, 'lien cassé');
  } finally {
    rmSync(roms);
    renameSync(saved, roms);
  }
});
