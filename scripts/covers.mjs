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
import { MAX_COVER_BYTES, githubUrl, normalizeTitle, chooseCover, coverTargetPath, isPng, fetchRepoListing, freshListing } from '../js/cover-match.js';

export const COVERS_CACHE_FILE = 'clone90.covers-cache.json';
export { MAX_COVER_BYTES, githubUrl, normalizeTitle, chooseCover, coverTargetPath, isPng, fetchRepoListing };

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
  return freshListing(Object.hasOwn(cache.repos, repo) ? cache.repos[repo] : null, now);
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
