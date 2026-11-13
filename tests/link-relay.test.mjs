// Tests du relais du Mac (T34, scripts/link-relay.mjs) : refus des adresses locales et privées (SSRF), DNS figé, redirections, limites, écriture sûre.
// Serveurs HTTP de test sur 127.0.0.1 : `allowAddress` est injecté pour les autoriser ; les tests de refus utilisent la règle par défaut.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/project-root.mjs';
import {
  isBlockedAddress, resolvePublicAddress, scanPage, downloadLinks, formatLinksSummary, openPublicUrl, RelayError, MAX_REDIRECTS,
} from '../scripts/link-relay.mjs';

const { systems } = JSON.parse(readFileSync(join(PROJECT_ROOT, 'systems.json'), 'utf8'));
const local = { allowAddress: (ip) => ip === '127.0.0.1' };

/** Serveur de test : `routes[path](req, res)`. Renvoie l'adresse de base et la liste des requêtes reçues. */
async function serve(routes) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, host: req.headers.host, cookie: req.headers.cookie, authorization: req.headers.authorization });
    const route = routes[req.url.split('?')[0]];
    if (route) route(req, res); else { res.writeHead(404); res.end(); }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { base: `http://127.0.0.1:${server.address().port}`, port: server.address().port, seen, close: () => server.close() };
}
const html = (body) => (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(body); };
const tmp = () => mkdtemp(join(tmpdir(), 'clone90-links-'));

test('T34 sécurité du relais : adresses locales, privées, réservées et IPv4 cachées dans IPv6 refusées ; adresses publiques acceptées', () => {
  for (const ip of ['127.0.0.1', '127.8.9.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.169.254', '100.64.0.1',
    '0.0.0.0', '224.0.0.1', '255.255.255.255', '198.18.0.1', '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:192.168.0.1', '64:ff9b::7f00:1', '2002:7f00:1::1', '2001:db8::1', 'pas-une-ip', '']) {
    assert.equal(isBlockedAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '172.32.0.1', '192.169.0.1', '2606:4700:4700::1111', '2a00:1450:4007::64', '::ffff:8.8.8.8']) {
    assert.equal(isBlockedAddress(ip), false, ip);
  }
});

test('T34 sécurité du relais : un nom dont UNE des adresses est privée est refusé ; nom introuvable : message clair', async () => {
  const lookup = async (host) => (host === 'mixte.test' ? [{ address: '93.184.216.34', family: 4 }, { address: '10.0.0.1', family: 4 }] : []);
  await assert.rejects(resolvePublicAddress('mixte.test', { lookup }), (e) => e instanceof RelayError && e.code === 'blocked-address');
  await assert.rejects(resolvePublicAddress('vide.test', { lookup }), (e) => e.code === 'dns');
  await assert.rejects(resolvePublicAddress('x.test', { lookup: async () => { throw new Error('ENOTFOUND'); } }), (e) => e.code === 'dns');
  await assert.rejects(resolvePublicAddress('[::1]'), (e) => e.code === 'blocked-address');
  assert.deepEqual(await resolvePublicAddress('8.8.8.8'), { address: '8.8.8.8', family: 4 });
});

test('T34 sécurité du relais : le serveur local du Mac (127.0.0.1) et localhost ne sont jamais contactés par défaut', async () => {
  const s = await serve({ '/': html('<a href="x.adf">x</a>') });
  try {
    await assert.rejects(scanPage(`${s.base}/`, systems), (e) => e.code === 'blocked-address');
    await assert.rejects(scanPage(`http://localhost:${s.port}/`, systems), (e) => e.code === 'blocked-address');
    assert.equal(s.seen.length, 0, 'aucune requête ne doit partir');
  } finally { s.close(); }
});

test('T34 sécurité du relais : connexion vers l\'adresse vérifiée, sans nouvelle résolution DNS (anti DNS rebinding)', async () => {
  const s = await serve({ '/': html('<a href="jeu.adf">j</a>') });
  let calls = 0;
  const lookup = async () => { calls += 1; return [{ address: '127.0.0.1', family: 4 }]; };
  try {
    const r = await scanPage(`http://site.test:${s.port}/`, systems, { ...local, lookup });
    assert.equal(calls, 1, 'une seule résolution, faite par le relais');
    assert.equal(s.seen[0].host, `site.test:${s.port}`);
    assert.deepEqual(r.files.map((f) => f.url), [`http://site.test:${s.port}/jeu.adf`]);
  } finally { s.close(); }
});

test('T34 sécurité du relais : chaque redirection est revérifiée (redirection vers une adresse privée refusée), 5 au plus', async () => {
  const s = await serve({
    '/vers-prive': (req, res) => { res.writeHead(302, { Location: 'http://10.0.0.1/' }); res.end(); },
    '/boucle': (req, res) => { res.writeHead(301, { Location: '/boucle' }); res.end(); },
    '/vers-page': (req, res) => { res.writeHead(307, { Location: '/page' }); res.end(); },
    '/page': html('<a href="a.sms">a</a>'),
  });
  try {
    await assert.rejects(scanPage(`${s.base}/vers-prive`, systems, local), (e) => e.code === 'blocked-address');
    await assert.rejects(scanPage(`${s.base}/boucle`, systems, local), (e) => e.code === 'redirects');
    assert.equal(s.seen.filter((r) => r.url === '/boucle').length, MAX_REDIRECTS + 1);
    const ok = await scanPage(`${s.base}/vers-page`, systems, local);
    assert.equal(ok.url, `${s.base}/page`);
    assert.deepEqual(ok.files.map((f) => f.url), [`${s.base}/a.sms`]);
  } finally { s.close(); }
});

test('T34 sécurité du relais : protocole autre que http(s) refusé, aucun cookie ni identifiant envoyé', async () => {
  await assert.rejects(scanPage('file:///etc/passwd', systems), (e) => e.code === 'invalid-url');
  await assert.rejects(openPublicUrl('ftp://exemple.org/', local), (e) => e.code === 'invalid-url');
  const s = await serve({ '/': html('') });
  try {
    await scanPage(`${s.base}/`, systems, local);
    assert.equal(s.seen[0].cookie, undefined);
    assert.equal(s.seen[0].authorization, undefined);
  } finally { s.close(); }
});

test('T34 analyse : page trop grande, réponse qui n\'est pas une page, erreur HTTP : refus avec un message français', async () => {
  const big = 'x'.repeat(2 * 1024 * 1024 + 10);
  const s = await serve({
    '/grande': html(big),
    '/grande-sans-taille': (req, res) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.write(big.slice(0, 1e6)); res.write(big.slice(1e6)); res.end(); },
    '/binaire': (req, res) => { res.writeHead(200, { 'Content-Type': 'application/zip' }); res.end('PK'); },
  });
  try {
    await assert.rejects(scanPage(`${s.base}/grande`, systems, local), (e) => e.code === 'too-big' && /trop grande/.test(e.message));
    await assert.rejects(scanPage(`${s.base}/grande-sans-taille`, systems, local), (e) => e.code === 'too-big');
    await assert.rejects(scanPage(`${s.base}/binaire`, systems, local), (e) => e.code === 'not-html');
    await assert.rejects(scanPage(`${s.base}/absente`, systems, local), (e) => e.code === 'http' && /404/.test(e.message));
  } finally { s.close(); }
});

test('T34 téléchargement : fichiers rangés dans roms/<machine>/ et bios/, déjà présents non écrasés, choix invalides refusés', async () => {
  const s = await serve({
    '/f/jeu.adf': (req, res) => { res.writeHead(200); res.end('ADF'); },
    '/f/neogeo.zip': (req, res) => { res.writeHead(200); res.end('BIOS'); },
    '/f/deja.sms': (req, res) => { res.writeHead(200); res.end('NOUVEAU'); },
  });
  const romsDir = await tmp();
  const biosDir = await tmp();
  await mkdir(join(romsDir, 'mastersystem'));
  await writeFile(join(romsDir, 'mastersystem', 'deja.sms'), 'ANCIEN');
  const progress = [];
  try {
    const summary = await downloadLinks([
      { url: `${s.base}/f/jeu.adf`, target: 'amiga' },
      { url: `${s.base}/f/neogeo.zip`, target: 'bios' },
      { url: `${s.base}/f/deja.sms`, target: 'mastersystem' },
      { url: `${s.base}/f/jeu.adf`, target: 'snes' },
      { url: 'http://10.0.0.1/x.adf', target: 'amiga' },
    ], { romsDir, biosDir, systems, onProgress: (p) => progress.push(p), ...local });
    assert.deepEqual(summary.downloaded, ['amiga/jeu.adf', 'bios/neogeo.zip']);
    assert.deepEqual(summary.present, ['mastersystem/deja.sms']);
    assert.equal(summary.failed.length, 2);
    assert.match(summary.failed[1].message, /local ou privé/);
    assert.equal(await readFile(join(romsDir, 'amiga', 'jeu.adf'), 'utf8'), 'ADF');
    assert.equal(await readFile(join(biosDir, 'neogeo.zip'), 'utf8'), 'BIOS');
    assert.equal(await readFile(join(romsDir, 'mastersystem', 'deja.sms'), 'utf8'), 'ANCIEN');
    assert.deepEqual(progress.at(-1), { phase: 'downloading', done: 5, total: 5 });
    assert.deepEqual(formatLinksSummary(summary).slice(0, 3), ['Fichiers téléchargés : 2', 'Déjà présents : 1', 'Échecs : 2']);
  } finally { s.close(); }
});

test('T34 téléchargement : fichier trop gros ou coupé : refusé, aucun fichier ni fichier temporaire laissé', async () => {
  const s = await serve({
    '/gros.adf': (req, res) => { res.writeHead(200, { 'Content-Length': '5000' }); res.end('x'.repeat(5000)); },
    '/gros-sans-taille.adf': (req, res) => { res.writeHead(200); res.write('x'.repeat(3000)); res.end('x'.repeat(3000)); },
    '/coupe.adf': (req, res) => { res.writeHead(200, { 'Content-Length': '1000' }); res.write('x'.repeat(100)); setTimeout(() => res.destroy(), 20); },
  });
  const romsDir = await tmp();
  try {
    const summary = await downloadLinks(['gros', 'gros-sans-taille', 'coupe'].map((n) => ({ url: `${s.base}/${n}.adf`, target: 'amiga' })),
      { romsDir, biosDir: romsDir, systems, maxFileBytes: 4096, ...local });
    assert.equal(summary.downloaded.length, 0);
    assert.equal(summary.failed.length, 3);
    assert.match(summary.failed[0].message, /trop gros/);
    assert.deepEqual(await readdir(join(romsDir, 'amiga')), []);
  } finally { s.close(); }
});

test('T34 téléchargement : nom de fichier piégé (../, point initial) ramené à un nom simple dans le dossier de la machine', async () => {
  const s = await serve({ '/..%2F..%2Fpiege.adf': (req, res) => { res.writeHead(200); res.end('P'); } });
  const romsDir = await tmp();
  try {
    const summary = await downloadLinks([{ url: `${s.base}/..%2F..%2Fpiege.adf`, target: 'amiga' }], { romsDir, biosDir: romsDir, systems, ...local });
    assert.deepEqual(summary.downloaded, ['amiga/piege.adf']);
    assert.deepEqual(await readdir(romsDir), ['amiga']);
  } finally { s.close(); }
});
