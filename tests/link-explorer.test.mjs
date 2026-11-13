// Tests de l'analyse améliorée (T36) : nouvelles formes de liens, Content-Disposition, pages à explorer, exploration du site (pure),
// et relais du Mac sur un faux site local à deux niveaux (sous-pages, liens sans nom de fichier, autre site jamais exploré).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { mkdtemp, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/project-root.mjs';
import { extractLinks, fileNameFromDisposition, isPageLink, isDownloadLike, checkDownloadItem, sanitizeName } from '../js/link-finder.js';
import { exploreSite, describeEmptyScan, describeScanProgress } from '../js/link-explorer.js';
import { scanPage, downloadLinks } from '../scripts/link-relay.mjs';

const { systems } = JSON.parse(readFileSync(join(PROJECT_ROOT, 'systems.json'), 'utf8'));
const PAGE = 'https://exemple.org/liste/';

test('T36 nouvelles formes de liens : data-url/data-file, <meta refresh>, adresses en clair et échappées dans un script', () => {
  const html = '<div data-url="/a.adf"></div><button data-download-link=\'b.nes\'>b</button><div data-id="12"></div>'
    + '<meta http-equiv="refresh" content="0; url=/redir.html">'
    + '<script>var f = {"u":"https:\\/\\/cdn.exemple.org\\/c.sms"}; var g = "https://exemple.org/d.gb";</script>';
  const links = extractLinks(html, PAGE);
  for (const l of ['https://exemple.org/a.adf', 'https://exemple.org/liste/b.nes', 'https://exemple.org/redir.html', 'https://cdn.exemple.org/c.sms', 'https://exemple.org/d.gb']) {
    assert.ok(links.includes(l), l);
  }
  assert.ok(!links.includes('https://exemple.org/liste/12'), 'data-id n\'est pas une adresse');
});

test('T36 Content-Disposition : filename*= UTF-8 d\'abord, sinon filename=, nom nettoyé ; absent ou vide : null', () => {
  assert.equal(fileNameFromDisposition('attachment; filename="Mon Jeu.zip"'), 'Mon Jeu.zip');
  assert.equal(fileNameFromDisposition("attachment; filename=x.zip; filename*=UTF-8''Caf%C3%A9.adf"), 'Café.adf');
  assert.equal(fileNameFromDisposition('attachment; filename=../../piege.nes'), 'piege.nes');
  assert.equal(fileNameFromDisposition('attachment; filename=".cache"'), 'cache');
  assert.equal(fileNameFromDisposition('inline'), null);
  assert.equal(fileNameFromDisposition(undefined), null);
  assert.equal(sanitizeName('a'.repeat(300)), null);
});

test('T36 pages à explorer : même site (www. ignoré), pages sans extension ou .html/.php ; jamais images, styles, autre site', () => {
  assert.equal(isPageLink('https://www.exemple.org/jeux/page2', PAGE), true);
  assert.equal(isPageLink('https://exemple.org/jeu.php?id=3', PAGE), true);
  assert.equal(isPageLink('https://exemple.org/a/b.html', PAGE), true);
  for (const no of ['https://autre.org/page', 'https://exemple.org/style.css', 'https://exemple.org/logo.png', 'https://exemple.org/notice.pdf', 'pas une adresse']) {
    assert.equal(isPageLink(no, PAGE), false, no);
  }
});

test('T36 liens de téléchargement sans nom : download, dl, get, file reconnus ; mot entier seulement', () => {
  for (const yes of ['https://a.org/download?id=12', 'https://a.org/dl/34', 'https://a.org/get.php?f=1', 'https://a.org/files/9', 'https://a.org/x?telecharger=1']) assert.equal(isDownloadLike(yes), true, yes);
  for (const no of ['https://a.org/getaway', 'https://a.org/profile', 'https://a.org/forget', 'https://a.org/']) assert.equal(isDownloadLike(no), false, no);
});

test('T36 choix avec nom lu à l\'analyse : extension vérifiée sur le nom, nom invalide refusé', () => {
  assert.deepEqual(checkDownloadItem({ url: 'https://a.org/download?id=1', target: 'amiga', name: 'jeu.adf' }, systems), { ok: true, url: 'https://a.org/download?id=1', name: 'jeu.adf', target: 'amiga' });
  assert.equal(checkDownloadItem({ url: 'https://a.org/download?id=1', target: 'amiga', name: 'jeu.exe' }, systems).ok, false);
  assert.equal(checkDownloadItem({ url: 'https://a.org/download?id=1', target: 'amiga', name: '' }, systems).ok, false);
  assert.equal(checkDownloadItem({ url: 'https://a.org/download?id=1', target: 'amiga' }, systems).ok, false, 'sans nom ni extension');
});

/** Faux site en mémoire pour exploreSite. */
function fakeSite(pages, names = {}) {
  const fetched = [];
  return {
    fetched,
    fetchPage: async (url) => { fetched.push(url); if (!(url in pages)) throw new Error('404'); return { url, html: pages[url] }; },
    probe: async (url) => names[url] ?? null,
  };
}
const S = 'https://site.test';

test('T36 exploration : profondeur 0, 1, 2 ; même site seulement ; fichiers trouvés avec la page d\'origine', async () => {
  const site = fakeSite({
    [`${S}/`]: `<a href="/cat/amiga">Amiga</a><a href="https://autre.test/x">autre</a><a href="/racine.adf">r</a>`,
    [`${S}/cat/amiga`]: '<a href="/jeu/1">Jeu 1</a><a href="/files/j0.adf">j0</a>',
    [`${S}/jeu/1`]: '<a href="/files/j1.adf">télécharger</a>',
    'https://autre.test/x': '<a href="/pas-pour-nous.adf">x</a>',
  });
  const names = async (depth) => (await exploreSite({ start: `${S}/`, systems, depth, ...site })).files.map((f) => f.name);
  assert.deepEqual(await names(0), ['racine.adf']);
  assert.deepEqual(await names(1), ['racine.adf', 'j0.adf']);
  const r = await exploreSite({ start: `${S}/`, systems, depth: 2, ...site });
  assert.deepEqual(r.files.map((f) => [f.name, f.page]), [['racine.adf', `${S}/`], ['j0.adf', `${S}/cat/amiga`], ['j1.adf', `${S}/jeu/1`]]);
  assert.ok(!site.fetched.includes('https://autre.test/x'), 'un autre site n\'est jamais exploré');
  assert.deepEqual(r.stats, { pages: 3, links: 6, probes: 0, failedPages: 0 });
});

test('T36 exploration : lien sans nom interrogé (Content-Disposition), nom reconnu gardé, 60 interrogations au plus', async () => {
  const links = Array.from({ length: 70 }, (_, i) => `<a href="/download?id=${i}">${i}</a>`).join('');
  const site = fakeSite({ [`${S}/`]: links }, { [`${S}/download?id=0`]: 'Demo.adf', [`${S}/download?id=1`]: 'notice.pdf' });
  let probes = 0;
  const r = await exploreSite({ start: `${S}/`, systems, depth: 0, fetchPage: site.fetchPage, probe: async (u) => { probes += 1; return site.probe(u); } });
  assert.deepEqual(r.files.map((f) => [f.name, f.url, f.named]), [['Demo.adf', `${S}/download?id=0`, true]]);
  assert.equal(probes, 60);
});

test('T36 exploration : limites de pages et de durée, arrêt demandé (rend ce qui est trouvé), sous-page en échec ignorée', async () => {
  const many = { [`${S}/`]: Array.from({ length: 80 }, (_, i) => `<a href="/p${i}">p</a>`).join('') };
  for (let i = 0; i < 80; i++) many[`${S}/p${i}`] = `<a href="/f${i}.adf">f</a>`;
  const site = fakeSite(many);
  const limited = await exploreSite({ start: `${S}/`, systems, depth: 1, ...site });
  assert.equal(limited.stats.pages, 40, 'page de départ comprise');
  const stop = new AbortController();
  const stopped = await exploreSite({ start: `${S}/`, systems, depth: 1, ...site, signal: stop.signal, onProgress: (p) => { if (p.pages === 3) stop.abort(); } });
  assert.equal(stopped.stopped, true);
  assert.equal(stopped.files.length, 2);
  let t = 0;
  const timed = await exploreSite({ start: `${S}/`, systems, depth: 1, ...site, now: () => { t += 10_000; return t; } });
  assert.ok(timed.stats.pages < 40, `${timed.stats.pages} pages`);
  const broken = await exploreSite({ start: `${S}/`, systems, depth: 1, fetchPage: async (u) => { if (u !== `${S}/`) throw new Error('404'); return { url: u, html: '<a href="/x">x</a>' }; } });
  assert.equal(broken.stats.failedPages, 1);
  await assert.rejects(exploreSite({ start: `${S}/`, systems, fetchPage: async () => { throw new Error('page de départ'); } }), /page de départ/);
});

test('T36 messages : analyse vide expliquée (liens et pages lus, causes probables), avancement', () => {
  const text = describeEmptyScan({ pages: 12, links: 85 });
  assert.match(text, /^85 liens lus sur 12 pages, aucun fichier/);
  assert.match(text, /JavaScript/);
  assert.match(describeEmptyScan({ pages: 1, links: 1 }), /^1 lien lu sur 1 page,/);
  assert.equal(describeScanProgress({ pages: 3, queued: 10, files: 2 }), 'Analyse : 3 pages lues sur 10, 2 fichiers trouvés...');
});

test('T36 relais du Mac sur un faux site : sous-pages, lien sans nom nommé par Content-Disposition, puis téléchargé sous ce nom', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, ua: req.headers['user-agent'] });
    const html = (b) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(b); };
    if (req.url === '/') return html('<a href="/jeux/demo">Demo</a><a href="http://10.0.0.1/interne">interne</a>');
    if (req.url === '/jeux/demo') return html('<a href="/download?id=7">Télécharger</a>');
    if (req.url === '/download?id=7') { res.writeHead(200, { 'Content-Disposition': 'attachment; filename="Demo Disk.adf"' }); return res.end('ADF'); }
    res.writeHead(404); return res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const net = { allowAddress: (ip) => ip === '127.0.0.1' };
  try {
    const r = await scanPage(`${base}/`, systems, { depth: 1, ...net });
    assert.deepEqual(r.files.map((f) => [f.name, f.target, f.url]), [['Demo Disk.adf', 'amiga', `${base}/download?id=7`]]);
    assert.ok(!seen.some((s) => s.url === '/interne'));
    assert.match(seen[0].ua, /^Mozilla\/5\.0/, 'identifiant de navigateur courant');
    const romsDir = await mkdtemp(join(tmpdir(), 'clone90-t36-'));
    const summary = await downloadLinks([{ url: r.files[0].url, target: 'amiga', name: r.files[0].name }], { romsDir, biosDir: romsDir, systems, ...net });
    assert.deepEqual(summary.downloaded, ['amiga/Demo Disk.adf']);
    assert.deepEqual(await readdir(join(romsDir, 'amiga')), ['Demo Disk.adf']);
  } finally { server.close(); }
});
