// Générateur de games.json (T2) : scanne roms/<machine>/ d'après systems.json. Docs : architecture.md sections 6.2 et 7.
// Usage : node scripts/generate-games.mjs [--check]. Node 18+, sans dépendance. Racine : project-root.mjs.
import { readFile, readdir, stat, writeFile, rename, rm, access } from 'node:fs/promises';
import { posix, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT } from './project-root.mjs';
import { compareTitles } from '../js/sort.js';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']; // ordre = priorité de la jaquette

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
 * Fichiers cités par un .cue (lignes FILE, entre guillemets ou non), avec `/` comme séparateur, dans l'ordre du .cue (T15, Mega-CD).
 * @param {string} text contenu du .cue
 * @returns {string[]}
 */
export function parseCue(text) {
  const names = [];
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const match = /^\s*FILE\s+(?:"([^"]+)"|(\S+))/i.exec(line);
    if (match) names.push((match[1] ?? match[2]).replace(/\\/g, '/'));
  }
  return names;
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

// Convention TOSEC/No-Intro des jeux à plusieurs disquettes : `Jeu (1991)(Editeur)(Disk 2 of 3)[flag].adf`, ou `Disk 2 of 3` sans parenthèses.
const DISK_TAG = /\s*\(\s*Disk\s*(\d+)(?:\s*of\s*(\d+))?\s*\)|\s*\bDisk\s*(\d+)\s*of\s*(\d+)\b/i;

/**
 * Lit l'étiquette de disquette d'un nom sans extension.
 * @returns {{base: string, number: number, total: number|null}|null} `base` = nom sans étiquette de disquette ni [drapeaux] ; null si pas d'étiquette
 */
export function parseDiskTag(stem) {
  const m = DISK_TAG.exec(stem);
  if (!m) return null;
  const number = Number(m[1] ?? m[3]);
  if (!(number >= 1)) return null;
  const total = m[2] ?? m[4];
  const base = stem.replace(DISK_TAG, ' ').replace(/\s*\[[^\]]*\]/g, '').replace(/\s+/g, ' ').trim();
  return base ? { base, number, total: total ? Number(total) : null } : null;
}

/**
 * Sépare les fichiers en jeux simples et en groupes de disquettes (même dossier, même extension, même nom de base).
 * @param {string[]} files chemins relatifs au dossier de la machine
 * @returns {{singles: string[], groups: {base: string, total: number|null, disks: {file: string, number: number}[]}[]}}
 */
function groupDiskSets(files) {
  const singles = [];
  const byKey = new Map();
  for (const file of files) {
    const tag = ['m3u', 'cue'].includes(extOf(file)) ? null : parseDiskTag(stemOf(file));
    if (!tag) { singles.push(file); continue; }
    const key = `${posix.dirname(file)}|${extOf(file)}|${tag.base.toLowerCase()}`;
    if (!byKey.has(key)) byKey.set(key, { base: tag.base, total: null, disks: [] });
    const group = byKey.get(key);
    group.total = Math.max(group.total ?? 0, tag.total ?? 0) || null;
    group.disks.push({ file, number: tag.number });
  }
  return { singles, groups: [...byKey.values()] };
}

/** Trie par numéro de disquette et garde un seul fichier par numéro (le premier par nom), avec avertissement pour les autres. */
function keepOneFilePerDisk(group, systemId, warnings) {
  const sorted = [...group.disks].sort((a, b) => a.number - b.number || (a.file < b.file ? -1 : 1));
  return sorted.filter((disk, i) => {
    const previous = sorted[i - 1];
    if (previous?.number !== disk.number) return true;
    warnings.push(`${systemId} : disquette ${disk.number} de ${group.base} en double, fichier ignoré : ${disk.file} (gardé : ${previous.file})`);
    return false;
  });
}

/** Texte décrivant les disquettes manquantes (numéros de 1 au total annoncé, à défaut au plus grand numéro présent), ou null. */
function describeMissingDisks(kept, total) {
  const expected = Math.max(total ?? 0, kept.at(-1).number);
  const present = new Set(kept.map((d) => d.number));
  const missing = Array.from({ length: expected }, (_, i) => i + 1).filter((n) => !present.has(n));
  return missing.length ? `disquette(s) manquante(s) : ${missing.join(', ')} sur ${expected}` : null;
}

/**
 * Jeux d'une machine (fonction pure : aucun accès disque).
 * @param {{system: object, files: string[], texts: Record<string, string>, titles: object|null}} input
 *   `files` = chemins relatifs au dossier de la machine ; `dirName` = nom réel de ce dossier sous roms/ (défaut : l'id) ; `texts` = contenu des .m3u et .bios.
 * @returns {{games: object[], warnings: string[]}}
 */
export function buildSystemGames({ system, files, texts, titles, dirName = system.id }) {
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

  // T15 : un .cue (Mega-CD) possède les fichiers de ses lignes FILE : ils ne sont pas des jeux. `cueFiles` : .cue -> {file (vrai chemin), as (nom écrit dans le .cue)}.
  const visibleByLowerPath = new Map(visible.map((f) => [f.toLowerCase(), f]));
  const cueFiles = new Map();
  for (const cue of visible.filter((x) => extOf(x) === 'cue' && accepted.has('cue'))) {
    const owned = [];
    for (const name of parseCue(texts[cue] ?? '')) {
      const path = posix.normalize(posix.join(posix.dirname(cue), name));
      if (name.startsWith('/') || path.startsWith('..') || posix.isAbsolute(path)) {
        warnings.push(`${system.id} : ${cue} cite un chemin non autorisé, ignoré : ${name}`);
        continue;
      }
      const real = visibleByLowerPath.get(path.toLowerCase());
      if (!real) warnings.push(`${system.id} : fichier introuvable cité par ${cue} : ${name}`);
      owned.push({ file: real ?? path, as: name });
      referenced.add(path.toLowerCase());
    }
    cueFiles.set(cue, owned);
  }

  const byId = new Map();
  const addGame = (id, game, file) => {
    if (byId.has(id)) {
      warnings.push(`${system.id} : doublon d'identifiant ${id}, fichier ignoré : ${file} (gardé : ${byId.get(id).file})`);
      return;
    }
    byId.set(id, game);
  };
  /** Jeu pour un fichier (ou un groupe : `stem` sert à l'id et au titre, `lookupStems` à la jaquette et au .bios). */
  const buildGame = (f, stem, lookupStems) => {
    const dir = posix.dirname(f);
    const cover = lookupStems.map((s) => covers.get(posix.join(dir, s).toLowerCase())).find(Boolean);
    const game = {
      id: makeId(system.id, stem), system: system.id, title: resolveTitle(stem, titles),
      file: `roms/${dirName}/${f}`,
      cover: cover ? `roms/${dirName}/${cover}` : null,
    };
    if (cueFiles.get(f)?.length) game.extraFiles = cueFiles.get(f).map((o) => ({ file: `roms/${dirName}/${o.file}`, as: o.as }));
    const bios = lookupStems.map((s) => (texts[posix.join(dir, `${s}.bios`)] ?? '').split(/\r?\n/)[0].trim()).find(Boolean);
    if (bios) game.bios = bios;
    return game;
  };

  const candidates = [];
  for (const f of visible) {
    const ext = extOf(f);
    if (!accepted.has(ext)) {
      if (!IMAGE_EXTENSIONS.includes(ext) && ext !== 'bios' && !referenced.has(f.toLowerCase())) {
        warnings.push(`${system.id} : extension non prise en charge, fichier ignoré : ${f}`);
      }
      continue;
    }
    if (ext !== 'm3u' && referenced.has(f.toLowerCase())) continue;
    candidates.push(f);
  }
  const { singles, groups } = groupDiskSets(candidates);
  for (const f of singles) addGame(makeId(system.id, stemOf(f)), buildGame(f, stemOf(f), [stemOf(f)]), f);
  for (const group of groups) {
    const kept = keepOneFilePerDisk(group, system.id, warnings);
    const problem = describeMissingDisks(kept, group.total);
    if (problem) warnings.push(`${system.id} : jeu ${group.base} incomplet, ${problem}`);
    const first = kept[0];
    if (kept.length === 1) { // une seule disquette présente : jeu simple, comme avant
      addGame(makeId(system.id, stemOf(first.file)), buildGame(first.file, stemOf(first.file), [stemOf(first.file)]), first.file);
      continue;
    }
    const game = buildGame(first.file, group.base, [stemOf(first.file), group.base]);
    game.disks = kept.map((d) => `roms/${dirName}/${d.file}`);
    addGame(game.id, game, first.file);
  }
  const games = [...byId.values()].sort((a, b) =>
    compareTitles(a.title, b.title) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
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

/**
 * Nom réel du dossier d'une machine sous roms/ : casse exacte d'abord, sinon égalité sans tenir compte de la casse
 * (macOS ne distingue pas `amiga` de `Amiga`, Linux et GitHub Pages si). Aucun renommage : on lit le dossier tel qu'il est.
 * @param {string[]} entries noms présents dans roms/
 * @param {string} systemId
 * @returns {string} le nom trouvé, ou l'id (dossier absent)
 */
export function pickSystemDir(entries, systemId) {
  if (entries.includes(systemId)) return systemId;
  return [...entries].sort().find((e) => e.toLowerCase() === systemId.toLowerCase()) ?? systemId;
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
  const romFolders = await readdir(join(root, 'roms')).catch(() => []);
  for (const system of systems) {
    const dirName = pickSystemDir(romFolders, system.id);
    const dir = join(root, 'roms', dirName);
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
