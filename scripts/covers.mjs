// Pochettes automatiques (T28) : pour chaque jeu SANS jaquette, cherche une image dans la base libre libretro-thumbnails (dossier Named_Boxarts
// du dépôt `thumbnailsRepo` de la machine, systems.json) et l'écrit à côté du jeu, sous le nom que le générateur reconnaît. Docs : architecture.md section 7.4.
// Dépend de generate-games.mjs (liste des jeux, régénération), local-settings.mjs (dossier des ROMs) et js/games-builder.js. Sans dépendance, Node 18+.
// INVARIANT : les SEULES requêtes réseau sont des lectures vers api.github.com et raw.githubusercontent.com (`githubUrl`) ; rien de Clone90 n'est envoyé.
// INVARIANT : on ne remplace jamais une image existante (écriture exclusive `wx`) et on n'écrit que des fichiers PNG vérifiés, de 2 Mo au plus.
// INVARIANT : on ne devine pas. Plusieurs candidats aussi bons (images différentes) = ambigu, rien n'est téléchargé.
// Usage : node scripts/covers.mjs [--dry-run] [--refresh]
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT } from './project-root.mjs';
import { readLocalSettings } from './local-settings.mjs';
import { generateGames, runGenerate } from './generate-games.mjs';
import { extname } from '../js/posix-path.js';

export const MAX_COVER_BYTES = 2 * 1024 * 1024;
export const COVERS_CACHE_FILE = 'clone90.covers-cache.json';
const CACHE_MAX_AGE_MS = 7 * 24 * 3600 * 1000;
const ORG = 'libretro-thumbnails';
const BOXARTS = 'Named_Boxarts';
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const REPO_NAME = /^[A-Za-z0-9._-]+$/;
const TAG = /\s*[(\[][^)\]]*[)\]]/g;
const UNWANTED_TAG = /\b(beta|proto|prototype|demo|sample|unl|pirate|aftermarket|hack|bootleg|compilation)\b/i;

/** Seule fabrique d'adresses : hôtes GitHub fixes, nom de dépôt contrôlé. @param {'api'|'raw'} kind */
export function githubUrl(kind, repo, rest) {
  if (!REPO_NAME.test(repo)) throw new Error(`Nom de dépôt de pochettes invalide : ${repo}`);
  return kind === 'api'
    ? `https://api.github.com/repos/${ORG}/${repo}/git/trees/${rest}`
    : `https://raw.githubusercontent.com/${ORG}/${repo}/HEAD/${BOXARTS}/${encodeURIComponent(rest)}`;
}

/** Titre comparable : sans étiquettes (…) […], sans accents, casse, ponctuation, « the » et « and » (aussi « & » et « _ ») ignorés. */
export function normalizeTitle(title) {
  const words = title.replace(TAG, ' ').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.filter((w) => w !== 'the' && w !== 'and').join(' ');
}

/** Rang de région d'un nom de candidat : 0 sans étiquette (nom exact), 1 Europe, 2 USA, 3 World, 4 le reste. Moins = meilleur. */
function regionRank(tags) {
  if (!tags.length) return 0;
  const all = tags.join(',').replace(/[()\[\]]/g, ' ').toLowerCase().split(/[,\s]+/);
  return ['europe', 'usa', 'world'].map((r) => all.includes(r)).indexOf(true) + 1 || 4;
}

/** Nom d'un fichier de la base, `Gods (Europe).png`, séparé en titre (sans étiquettes) et étiquettes. */
function parseCandidateName(name) {
  const stem = name.replace(/\.png$/i, '');
  return { stem, title: stem.replace(TAG, '').trim(), tags: stem.match(/[(\[][^)\]]*[)\]]/g) ?? [] };
}

/**
 * Choisit l'image d'un titre parmi les fichiers d'une base.
 * Correspondance sur le titre normalisé ; à défaut, sur le titre qui précède un sous-titre (` - ` ou ` _ `). Parmi les candidats : les versions
 * « Beta », « Proto », « Compilation »... passent après, puis l'ordre nom exact, Europe, USA, World, autre. Images identiques (même sha) = un seul candidat.
 * @param {string} title titre du jeu
 * @param {{name: string, sha: string, size: number}[]} files fichiers de Named_Boxarts
 * @returns {{status: 'found', file: object}|{status: 'none'}|{status: 'ambiguous', files: object[]}}
 */
export function chooseCover(title, files) {
  const wanted = normalizeTitle(title);
  if (!wanted) return { status: 'none' };
  const parsed = files.filter((f) => /\.png$/i.test(f.name)).map((f) => ({ file: f, ...parseCandidateName(f.name) }));
  let matches = parsed.filter((p) => normalizeTitle(p.title) === wanted);
  if (!matches.length) matches = parsed.filter((p) => normalizeTitle(p.title.split(/\s[-_]\s/)[0]) === wanted);
  if (!matches.length) return { status: 'none' };
  const score = (p) => [UNWANTED_TAG.test(p.tags.join(' ')) ? 1 : 0, regionRank(p.tags)];
  const compare = (a, b) => score(a)[0] - score(b)[0] || score(a)[1] - score(b)[1];
  matches.sort((a, b) => compare(a, b) || (a.file.name < b.file.name ? -1 : 1));
  const best = matches.filter((p) => compare(p, matches[0]) === 0);
  const distinct = [...new Map(best.map((p) => [p.file.sha, p.file])).values()];
  return distinct.length === 1 ? { status: 'found', file: distinct[0] } : { status: 'ambiguous', files: distinct };
}

/**
 * Chemin de l'image à écrire, relatif au dossier des ROMs : celui du jeu, avec son nom sans extension (celui de sa première disquette
 * pour un jeu à plusieurs disquettes, du .m3u ou du .cue sinon) et l'extension .png. C'est un des noms que cherche le générateur (games-builder.js, `covers`).
 * @param {{file: string}} game jeu de games.json (`roms/<dossier>/<fichier>`)
 */
export function coverTargetPath(game) {
  const rel = game.file.replace(/^roms\//, '');
  return `${rel.slice(0, rel.length - extname(rel).length)}.png`;
}

/** Vrai si les octets commencent par la signature PNG. */
export function isPng(bytes) {
  return bytes.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/**
 * Liste des images de Named_Boxarts d'un dépôt : deux requêtes (racine puis dossier), car l'arbre récursif de gros dépôts (FBNeo) est refusé par GitHub (erreur 500).
 * @param {string} repo
 * @param {(url: string) => Promise<any>} fetchJson
 * @returns {Promise<{name: string, sha: string, size: number}[]>}
 * @throws {Error} si le dossier est absent ou la liste tronquée
 */
export async function fetchRepoListing(repo, fetchJson) {
  const root = await fetchJson(githubUrl('api', repo, 'HEAD'));
  const folder = root?.tree?.find((e) => e.path === BOXARTS && e.type === 'tree');
  if (!folder) throw new Error(`dossier ${BOXARTS} introuvable dans ${repo}`);
  const list = await fetchJson(githubUrl('api', repo, folder.sha));
  if (!Array.isArray(list?.tree) || list.truncated) throw new Error(`liste incomplète pour ${repo}`);
  return list.tree.filter((e) => e.type === 'blob' && /\.png$/i.test(e.path)).map((e) => ({ name: e.path, sha: e.sha, size: e.size ?? 0 }));
}

/** Cache lu sans jamais planter : fichier absent, illisible ou de mauvaise forme = cache vide. */
async function readCache(root) {
  try {
    const cache = JSON.parse(await readFile(join(root, COVERS_CACHE_FILE), 'utf8'));
    return cache && typeof cache === 'object' && !Array.isArray(cache) && cache.repos && typeof cache.repos === 'object' && !Array.isArray(cache.repos)
      ? cache : { repos: {} };
  } catch {
    return { repos: {} };
  }
}
/** Liste en cache de ce dépôt si elle est récente et bien formée, sinon null (elle sera relue sur GitHub). */
function cachedListing(cache, repo, now) {
  const entry = Object.hasOwn(cache.repos, repo) ? cache.repos[repo] : null;
  const valid = entry && Array.isArray(entry.files) && entry.files.every((f) => f && typeof f.name === 'string' && typeof f.sha === 'string' && Number.isFinite(f.size))
    && now - Date.parse(entry.fetchedAt) < CACHE_MAX_AGE_MS; // NaN (date absente ou fausse) : comparaison fausse, donc périmé
  return valid ? entry.files : null;
}
async function writeCache(root, cache) {
  const target = join(root, COVERS_CACHE_FILE);
  await writeFile(`${target}.tmp`, JSON.stringify(cache)).then(() => rename(`${target}.tmp`, target)).catch(() => {}); // le cache n'est qu'un confort
}

/** Réponse JSON de GitHub (lecture seule). @throws {Error} message en français, dont la limite de débit */
export async function defaultFetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'clone90-covers' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (res.status === 403 || res.status === 429) throw new Error('limite de requêtes de GitHub atteinte, réessayez dans une heure');
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
  return res.json();
}

/**
 * Octets d'une image (lecture seule), en refusant plus de `maxBytes` : d'après Content-Length AVANT de lire le corps, puis pendant la lecture.
 * @param {string} url
 * @param {{maxBytes: number, fetchFn?: typeof fetch}} options `fetchFn` injectable (tests)
 * @throws {Error} message en français
 */
export async function defaultFetchBytes(url, { maxBytes, fetchFn = fetch }) {
  const res = await fetchFn(url, { headers: { 'User-Agent': 'clone90-covers' }, redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}`);
  const tooBig = new Error('image trop volumineuse');
  if (Number(res.headers.get('content-length')) > maxBytes) { await res.body?.cancel(); throw tooBig; }
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body ?? []) {
    size += chunk.length;
    if (size > maxBytes) throw tooBig; // quitter la boucle annule la lecture du corps
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const errorText = (err) => err?.message ?? String(err);

/**
 * Cherche (et télécharge sauf `dryRun`) les pochettes des jeux sans jaquette, puis régénère games.json si des images ont été écrites.
 * @param {object} options
 * @param {string} [options.root] racine du projet
 * @param {boolean} [options.dryRun] n'écrit rien (ni image ni games.json)
 * @param {boolean} [options.refresh] ignore le cache des listes
 * @param {Date} [options.now]
 * @param {{fetchJson?: Function, fetchBytes?: Function}} [options.net] accès réseau injectable (tests)
 * @param {(event: {phase: 'listing'|'downloading', system?: string, done: number, total: number}) => void} [options.onProgress]
 * @returns {Promise<{exitCode: number, dryRun: boolean, summary: object}>} `summary` : found, alreadyHave, notFound, ambiguous, failed, listingErrors, noRepo
 */
export async function runCovers({ root = PROJECT_ROOT, dryRun = false, refresh = false, now = new Date(), net = {}, onProgress = () => {} } = {}) {
  const fetchJson = net.fetchJson ?? defaultFetchJson;
  const fetchBytes = net.fetchBytes ?? defaultFetchBytes;
  const summary = { found: [], alreadyHave: 0, notFound: [], ambiguous: [], failed: [], listingErrors: [], noRepo: [] };
  const { games, systems } = await generateGames({ root, now });
  const { romsDir } = await readLocalSettings(root);
  summary.alreadyHave = games.filter((g) => g.cover).length;
  const cache = await readCache(root);
  const todo = games.filter((g) => !g.cover);
  let done = 0;
  const step = (system) => onProgress({ phase: 'downloading', system, done, total: todo.length });
  for (const system of systems) {
    const missing = todo.filter((g) => g.system === system.id);
    if (!missing.length) continue;
    const repo = system.thumbnailsRepo;
    if (!repo) { summary.noRepo.push(system.name); done += missing.length; continue; }
    onProgress({ phase: 'listing', system: system.name, done, total: todo.length });
    let files = refresh ? null : cachedListing(cache, repo, now);
    try {
      if (!files) {
        files = await fetchRepoListing(repo, fetchJson);
        cache.repos[repo] = { fetchedAt: now.toISOString(), files };
        await writeCache(root, cache);
      }
    } catch (err) {
      summary.listingErrors.push({ system: system.name, reason: errorText(err) });
      done += missing.length;
      continue;
    }
    for (const game of missing) {
      step(system.name);
      await handleGame({ game, files, repo, romsDir, dryRun, fetchBytes, summary });
      done += 1;
    }
  }
  step();
  const wrote = !dryRun && summary.found.length > 0;
  const exitCode = wrote ? (await runGenerate({ root, now, log: () => {}, logError: () => {} })).exitCode : 0;
  return { exitCode, dryRun, summary };
}

/** Traite un jeu : choix, vérifications, écriture exclusive. Remplit `summary`. */
async function handleGame({ game, files, repo, romsDir, dryRun, fetchBytes, summary }) {
  const choice = chooseCover(game.title, files);
  if (choice.status === 'none') { summary.notFound.push(game.title); return; }
  if (choice.status === 'ambiguous') { summary.ambiguous.push({ title: game.title, options: choice.files.map((f) => f.name) }); return; }
  const target = resolve(romsDir, coverTargetPath(game));
  const entry = { title: game.title, file: coverTargetPath(game), source: choice.file.name };
  if (!target.startsWith(resolve(romsDir) + sep)) { summary.failed.push({ title: game.title, reason: 'chemin refusé' }); return; }
  if (choice.file.size > MAX_COVER_BYTES) { summary.failed.push({ title: game.title, reason: 'image de plus de 2 Mo' }); return; }
  if (dryRun) { summary.found.push(entry); return; }
  try {
    const bytes = await fetchBytes(githubUrl('raw', repo, choice.file.name), { maxBytes: MAX_COVER_BYTES });
    if (!isPng(bytes)) throw new Error('le fichier reçu n\'est pas une image PNG');
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
    summary.found.push(entry);
  } catch (err) {
    if (err.code === 'EEXIST') summary.alreadyHave += 1; // une image de ce nom est apparue entre-temps : on n'y touche pas
    else summary.failed.push({ title: game.title, reason: errorText(err) });
  }
}

/**
 * Résumé en français, une ligne par résultat, compteurs à 0 omis (rien du tout : « Aucune pochette à chercher. »).
 * @param {{summary: object, dryRun: boolean}} result
 * @param {{details?: boolean}} [options] `details` : ajoute une ligne par jeu (ligne de commande)
 * @returns {string[]}
 */
export function formatSummary({ summary, dryRun }, { details = true } = {}) {
  const s = summary;
  const counts = [
    [s.found.length, `Pochettes ${dryRun ? 'qui seraient téléchargées' : 'téléchargées'}`],
    [s.alreadyHave, 'Déjà présentes'],
    [s.notFound.length, 'Introuvables'],
    [s.ambiguous.length, 'Plusieurs correspondances, ignorées'],
    [s.failed.length, 'Échecs'],
  ];
  const lines = counts.filter(([n]) => n > 0).map(([n, label]) => `${label} : ${n}`);
  for (const e of s.listingErrors) lines.push(`Liste indisponible pour ${e.system} : ${e.reason}`);
  if (s.noRepo.length) lines.push(`Machines sans base de pochettes : ${s.noRepo.join(', ')}`);
  if (!lines.length) lines.push('Aucune pochette à chercher.');
  if (!details) return lines;
  if (dryRun) lines.push(...s.found.map((e) => `  À télécharger : ${e.file} (depuis ${e.source})`));
  lines.push(...s.notFound.map((t) => `  Introuvable : ${t}`));
  lines.push(...s.ambiguous.map((a) => `  Plusieurs correspondances : ${a.title} (${a.options.slice(0, 4).join(' ; ')}${a.options.length > 4 ? ' ; ...' : ''})`));
  lines.push(...s.failed.map((f) => `  Échec : ${f.title} (${f.reason})`));
  return lines;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const args = process.argv.slice(2);
  const result = await runCovers({
    dryRun: args.includes('--dry-run'), refresh: args.includes('--refresh'),
    onProgress: (e) => { if (e.phase === 'listing') console.log(`Lecture de la liste des pochettes : ${e.system}...`); },
  });
  for (const line of formatSummary(result)) console.log(line);
  if (result.dryRun) console.log('Mode --dry-run : rien n\'a été écrit.');
  else if (result.summary.found.length) console.log('games.json mis à jour.');
  console.log('Images de la base libre libretro-thumbnails, pour un usage personnel. Elles restent sur ce Mac et ne sont jamais publiées.');
  process.exitCode = result.exitCode;
}
