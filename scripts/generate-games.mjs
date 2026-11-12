// Générateur de games.json (T2) : scanne roms/<machine>/ d'après systems.json. Docs : architecture.md sections 6.2 et 7.
// Usage : node scripts/generate-games.mjs [--check]. Node 18+, sans dépendance. Racine : project-root.mjs.
// Les fonctions pures (titres, disquettes, .m3u, .cue, buildSystemGames) sont dans js/games-builder.js (T27 : partagées avec le navigateur).
import { readFile, readdir, stat, writeFile, rename, rm, access } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT } from './project-root.mjs';
import { readLocalSettings, describeFolders } from './local-settings.mjs';
import { buildSystemGames, pickSystemDir, extOf } from '../js/games-builder.js';

export { cleanTitle, makeId, resolveTitle, parseM3u, parseCue, parseDiskTag, parseLooseDiskTag, buildSystemGames, pickSystemDir } from '../js/games-builder.js';


/**
 * Lit et valide systems.json.
 * @returns {Promise<object[]>} la liste des machines
 * @throws {Error} si le fichier est absent, n'est pas du JSON ou n'a pas la forme attendue
 */
export async function readSystems(root) {
  let config;
  try {
    config = JSON.parse(await readFile(join(root, 'systems.json'), 'utf8'));
  } catch (err) {
    throw new Error(`Lecture de systems.json impossible : ${err.message}`);
  }
  const valid = Array.isArray(config?.systems) && config.systems.every((s) =>
    s && typeof s.id === 'string' && Array.isArray(s.extensions));
  if (!valid) throw new Error('systems.json invalide : "systems" doit être une liste de machines avec id et extensions');
  return config.systems;
}

/** Fichiers visibles de `dir` (chemins relatifs, `/`), un niveau de sous-dossier toléré, triés. Dossier absent = []. */
async function listFiles(dir) {
  const files = [];
  const walk = async (rel, depth) => {
    const entries = await readdir(join(dir, rel), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = rel ? `${rel}/${entry.name}` : entry.name;
      const info = entry.isSymbolicLink() ? await stat(join(dir, path)).catch(() => null) : entry;
      if (info?.isFile()) files.push(path);
      else if (info?.isDirectory() && depth < 1) await walk(path, depth + 1);
    }
  };
  await walk('', 0);
  return files.sort();
}

async function readTitles(root, warnings) {
  let raw;
  try {
    raw = await readFile(join(root, 'data', 'titles.json'), 'utf8');
  } catch {
    return null; // absent : on retombe sur le nom des fichiers
  }
  try {
    const titles = JSON.parse(raw);
    if (titles && typeof titles === 'object' && !Array.isArray(titles)) return titles;
  } catch { /* traité ci-dessous */ }
  warnings.push('data/titles.json illisible ou invalide : titres tirés des noms de fichiers');
  return null;
}

const exists = (path) => access(path).then(() => true, () => false);
const isFile = (path) => stat(path).then((s) => s.isFile(), () => false);
/** Dossier des logos téléchargés, dans le dossier des ROMs (T29, scripts/machine-logos.mjs). Même valeur dans js/data.js (navigateur). */
export const LOGOS_DIR = 'clone90-logos';

/**
 * Scanne roms/ et construit le contenu de games.json (n'écrit rien).
 * @param {{root?: string, now?: Date}} options `now` injectable pour une sortie reproductible
 * @returns {Promise<{version: number, generatedAt: string, games: object[], logos: Record<string, string>, warnings: string[], counts: Record<string, number>, folders: string[]}>} `folders` : dossiers ROMs/BIOS utilisés (T23)
 * @throws {Error} si systems.json est illisible
 */
export async function generateGames({ root = PROJECT_ROOT, now = new Date() } = {}) {
  const systems = [...await readSystems(root)].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1));
  const warnings = [];
  const titles = await readTitles(root, warnings);
  const games = [];
  const counts = {};
  // T23 : dossiers choisis dans clone90.local.json. Les chemins écrits dans games.json restent `roms/<machine>/...` (adresse web).
  const settings = await readLocalSettings(root);
  warnings.push(...settings.warnings);
  const romFolders = await readdir(settings.romsDir).catch(() => []);
  for (const system of systems) {
    const dirName = pickSystemDir(romFolders, system.id);
    const dir = join(settings.romsDir, dirName);
    const files = await listFiles(dir);
    const texts = {};
    for (const f of files.filter((x) => ['m3u', 'cue', 'bios'].includes(extOf(x)))) {
      texts[f] = await readFile(join(dir, f), 'utf8').catch(() => '');
    }
    const result = buildSystemGames({ system, files, texts, titles, dirName });
    warnings.push(...result.warnings);
    counts[system.id] = result.games.length;
    games.push(...result.games);
    for (const bios of result.games.length ? system.bios ?? [] : []) {
      if (bios.required && !(await exists(join(settings.biosDir, bios.file)))) {
        warnings.push(`${system.id} : BIOS requis absent de bios/ : ${bios.file}`);
      }
    }
  }
  const logos = {};
  for (const system of systems) { // T29 : logos téléchargés par scripts/machine-logos.mjs, rangés dans le dossier des ROMs
    const rel = `${LOGOS_DIR}/${system.id}.svg`;
    if (/^[a-z0-9]+$/.test(system.id) && await isFile(join(settings.romsDir, rel))) logos[system.id] = `roms/${rel}`;
  }
  return { version: 1, generatedAt: now.toISOString(), games, logos, warnings, counts, systems, folders: describeFolders(settings) };
}

/**
 * Exécute la génération : écrit games.json (atomique) sauf en mode `check`, et affiche le diagnostic.
 * @returns {Promise<{exitCode: number}>} 1 seulement si systems.json est illisible
 */
export async function runGenerate({ root = PROJECT_ROOT, check = false, now = new Date(),
  log = console.log, logError = console.error } = {}) {
  let result;
  try {
    result = await generateGames({ root, now });
  } catch (err) {
    logError(err.message);
    return { exitCode: 1 };
  }
  const { systems, counts, warnings, games, folders, logos } = result;
  for (const line of folders) log(line);
  for (const s of systems) if (counts[s.id]) log(`${s.name} : ${counts[s.id]} jeu(x)`);
  log(`Total : ${games.length} jeu(x)`);
  for (const w of warnings) log(`Avertissement : ${w}`);
  if (check) {
    log('Mode --check : games.json non écrit.');
    return { exitCode: 0 };
  }
  const target = join(root, 'games.json');
  const temp = `${target}.tmp-${process.pid}`;
  try {
    await writeFile(temp, `${JSON.stringify({ version: result.version, generatedAt: result.generatedAt, games, logos }, null, 2)}\n`);
    await rename(temp, target);
  } catch (err) {
    await rm(temp, { force: true });
    logError(`Écriture de games.json impossible : ${err.message}`);
    return { exitCode: 1 };
  }
  log('games.json écrit.');
  return { exitCode: 0 };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const { exitCode } = await runGenerate({ check: process.argv.includes('--check') });
  process.exitCode = exitCode;
}
