// Générateur de games.json (T2) : scanne roms/<machine>/ d'après systems.json. Docs : architecture.md sections 6.2 et 7.
// Usage : node scripts/generate-games.mjs [--check]. Node 18+, sans dépendance. Racine : project-root.mjs.
import { readFile, readdir, stat, writeFile, rename, rm, access } from 'node:fs/promises';
import { posix, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT } from './project-root.mjs';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']; // ordre = priorité de la jaquette
const TITLE_COLLATOR = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

const extOf = (name) => {
  const ext = posix.extname(name).slice(1).toLowerCase();
  return ext;
};
const stemOf = (name) => posix.basename(name, posix.extname(name));
const isHidden = (relPath) => relPath.split('/').some((s) => s.startsWith('.'));
const hasOwn = (obj, key) => obj != null && Object.hasOwn(obj, key);

/**
 * Titre lisible depuis un nom de fichier sans extension : retire (…) et […], remplace _ par un espace.
 * Si le résultat est vide, renvoie le nom d'origine.
 */
export function cleanTitle(stem) {
  const cleaned = stem.replace(/\s*[(\[][^)\]]*[)\]]/g, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return cleaned || stem;
}

/** Identifiant stable : `<machine>/<nom sans extension, minuscules, espaces remplacés par _>`. */
export function makeId(systemId, stem) {
  return `${systemId}/${stem.toLowerCase().replace(/\s+/g, '_')}`;
}

/**
 * Titre d'un jeu : surcharge de titles.json (clé exacte puis en minuscules), sinon `cleanTitle`.
 * INVARIANT : accès par Object.hasOwn, pour qu'une clé comme __proto__ n'ait aucun effet.
 * @param {string} stem nom de fichier sans extension
 * @param {Record<string, string>|null} titles contenu de data/titles.json (ou null)
 */
export function resolveTitle(stem, titles) {
  for (const key of [stem, stem.toLowerCase()]) {
    if (hasOwn(titles, key) && typeof titles[key] === 'string' && titles[key].trim()) return titles[key].trim();
  }
  return cleanTitle(stem);
}

/** Lignes utiles d'un .m3u (hors commentaires, lignes vides et BOM), avec `/` comme séparateur. */
export function parseM3u(text) {
  return text.replace(/^﻿/, '').split(/\r?\n/).map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#')).map((l) => l.replace(/\\/g, '/'));
}

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

/**
 * Jeux d'une machine (fonction pure : aucun accès disque).
 * @param {{system: object, files: string[], texts: Record<string, string>, titles: object|null}} input
 *   `files` = chemins relatifs à roms/<id>/ ; `texts` = contenu des .m3u et .bios.
 * @returns {{games: object[], warnings: string[]}}
 */
export function buildSystemGames({ system, files, texts, titles }) {
  const warnings = [];
  const visible = files.filter((f) => !isHidden(f));
  const accepted = new Set(system.extensions.map((e) => e.toLowerCase()));
  const covers = new Map();
  for (const f of visible) {
    const ext = extOf(f);
    if (!IMAGE_EXTENSIONS.includes(ext)) continue;
    const key = posix.join(posix.dirname(f), stemOf(f)).toLowerCase();
    const known = covers.get(key);
    if (!known || IMAGE_EXTENSIONS.indexOf(ext) < IMAGE_EXTENSIONS.indexOf(extOf(known))) covers.set(key, f);
  }
  const referenced = new Set(); // fichiers cités par un .m3u : ce sont des disques, pas des jeux
  for (const f of visible.filter((x) => extOf(x) === 'm3u')) {
    for (const line of parseM3u(texts[f] ?? '')) {
      referenced.add(posix.normalize(posix.join(posix.dirname(f), line)).toLowerCase());
    }
  }

  const byId = new Map();
  for (const f of visible) {
    const ext = extOf(f);
    if (!accepted.has(ext)) {
      if (!IMAGE_EXTENSIONS.includes(ext) && ext !== 'bios') {
        warnings.push(`${system.id} : extension non prise en charge, fichier ignoré : ${f}`);
      }
      continue;
    }
    if (ext !== 'm3u' && referenced.has(f.toLowerCase())) continue;
    const stem = stemOf(f);
    const id = makeId(system.id, stem);
    if (byId.has(id)) {
      warnings.push(`${system.id} : doublon d'identifiant ${id}, fichier ignoré : ${f} (gardé : ${byId.get(id).file})`);
      continue;
    }
    const cover = covers.get(posix.join(posix.dirname(f), stem).toLowerCase());
    const game = {
      id, system: system.id, title: resolveTitle(stem, titles),
      file: `roms/${system.id}/${f}`,
      cover: cover ? `roms/${system.id}/${cover}` : null,
    };
    const biosFile = posix.join(posix.dirname(f), `${stem}.bios`);
    const bios = (texts[biosFile] ?? '').split(/\r?\n/)[0].trim();
    if (bios) game.bios = bios;
    byId.set(id, game);
  }
  const games = [...byId.values()].sort((a, b) =>
    TITLE_COLLATOR.compare(a.title, b.title) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { games, warnings };
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

/**
 * Scanne roms/ et construit le contenu de games.json (n'écrit rien).
 * @param {{root?: string, now?: Date}} options `now` injectable pour une sortie reproductible
 * @returns {Promise<{version: number, generatedAt: string, games: object[], warnings: string[], counts: Record<string, number>}>}
 * @throws {Error} si systems.json est illisible
 */
export async function generateGames({ root = PROJECT_ROOT, now = new Date() } = {}) {
  const systems = [...await readSystems(root)].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1));
  const warnings = [];
  const titles = await readTitles(root, warnings);
  const games = [];
  const counts = {};
  for (const system of systems) {
    const dir = join(root, 'roms', system.id);
    const files = await listFiles(dir);
    const texts = {};
    for (const f of files.filter((x) => ['m3u', 'bios'].includes(extOf(x)))) {
      texts[f] = await readFile(join(dir, f), 'utf8').catch(() => '');
    }
    const result = buildSystemGames({ system, files, texts, titles });
    warnings.push(...result.warnings);
    counts[system.id] = result.games.length;
    games.push(...result.games);
    for (const bios of result.games.length ? system.bios ?? [] : []) {
      if (bios.required && !(await exists(join(root, 'bios', bios.file)))) {
        warnings.push(`${system.id} : BIOS requis absent de bios/ : ${bios.file}`);
      }
    }
  }
  return { version: 1, generatedAt: now.toISOString(), games, warnings, counts, systems };
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
  const { systems, counts, warnings, games } = result;
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
    await writeFile(temp, `${JSON.stringify({ version: result.version, generatedAt: result.generatedAt, games }, null, 2)}\n`);
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
