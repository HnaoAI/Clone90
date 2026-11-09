// Imite GitHub Pages : sert le dépôt sous /<REPO>/ (défaut /Clone90/), SANS roms/, bios/, games.json (gitignorés donc absents du dépôt publié).
// Usage : node tests/recette/subpath-server.mjs <racine du projet> [port=8766] [prefix=/Clone90/]. Hors du préfixe : 404.
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? '.');
const port = Number(process.argv[3] ?? 8766);
const prefix = process.argv[4] ?? '/Clone90/';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ttf': 'font/ttf', '.txt': 'text/plain' };
const EXCLUDED = (p) => /^(roms|bios)(\/|$)/.test(p) || p === 'games.json' || p.startsWith('.git');

http.createServer(async (req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0].split('#')[0]);
  const hits = (globalThis.__hits ??= []); hits.push(url);
  if (!url.startsWith(prefix)) { res.writeHead(404, { 'Content-Type': 'text/html' }); res.end('<h1>404</h1>'); return; }
  let rel = url.slice(prefix.length);
  if (rel === '' || rel.endsWith('/')) rel += 'index.html';
  if (EXCLUDED(rel) || rel.includes('..')) { res.writeHead(404); res.end('404'); return; }
  const file = join(root, rel);
  const info = await stat(file).catch(() => null);
  if (!info?.isFile()) { res.writeHead(404); res.end('404'); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream', 'Cache-Control': 'max-age=600' });
  res.end(await readFile(file));
}).listen(port, () => console.log(`GitHub Pages simulé : http://localhost:${port}${prefix}`));
