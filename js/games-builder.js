// Construction de la liste des jeux d'une machine à partir de noms de fichiers (T2, déplacé en T27). Fonctions PURES, sans accès disque :
// utilisées par scripts/generate-games.mjs (Node, dossier roms/) ET par le navigateur (js/local-games.js, fichiers importés sur le téléphone).
// Dépend de js/posix-path.js (sous-ensemble de node:path posix) et js/sort.js. Docs : architecture.md sections 6.2 et 7.
import * as posix from './posix-path.js';
import { compareTitles } from './sort.js';

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp']; // ordre = priorité de la jaquette

/** Extension en minuscules, sans point ('' si aucune). */
export const extOf = (name) => posix.extname(name).slice(1).toLowerCase();
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

// T18 : noms de disquette sans la forme TOSEC (`Leander_Disk1`, `Disk-2`, `Disque 3`, `Disc4`, `Nom_D5`). Le mot (ou D) est précédé d'un
// non-lettre, le numéro (1 ou 2 chiffres, non collé à une lettre) termine le nom, seules des (…) ou […] peuvent suivre. « Disk Wars » n'a
// pas de numéro : pas d'étiquette. `D5` exige un préfixe et un séparateur (`LeanderD1` n'en est pas un) ; un seul fichier ne forme jamais un groupe.
const LOOSE_TAIL = String.raw`(?![\dA-Za-z])((?:\s*[(\[][^)\]]*[)\]])*)\s*$`;
const LOOSE_DISK_WORD = new RegExp(String.raw`^(.*?)[\s_-]*(?<![A-Za-z])(?:Disk|Disc|Disque)[\s_-]*(\d{1,2})${LOOSE_TAIL}`, 'i');
const LOOSE_DISK_LETTER = new RegExp(String.raw`^(.+?)[\s_-]+D(\d{1,2})${LOOSE_TAIL}`);

/**
 * Lit une étiquette de disquette libre (T18) dans un nom sans extension. À n'appeler que si `parseDiskTag` n'a rien trouvé.
 * @returns {{base: string, number: number}|null} `base` = nom sans l'étiquette ni les [drapeaux], peut être vide (`Disk1`) : l'appelant utilise alors le dossier ; null si pas d'étiquette
 */
export function parseLooseDiskTag(stem) {
  const m = LOOSE_DISK_WORD.exec(stem) ?? LOOSE_DISK_LETTER.exec(stem);
  if (!m) return null;
  const number = Number(m[2]);
  if (!(number >= 1)) return null;
  const base = `${m[1]} ${m[3]}`.replace(/\s*\[[^\]]*\]/g, '').replace(/[\s_-]+/g, ' ').trim();
  return { base, number };
}

/** Vrai si les numéros (sans doublon) forment 1, 2, … n avec n >= 2. */
const isConsecutiveFromOne = (numbers) => {
  const distinct = [...new Set(numbers)].sort((a, b) => a - b);
  return distinct.length >= 2 && distinct.every((n, i) => n === i + 1);
};

/** Titre de base d'un groupe libre : la base du nom, ou à défaut (vide ou sans lettre ni chiffre) le nom du dossier parent. */
function looseGroupBase(file, tagBase) {
  if (/[\p{L}\p{N}]{2,}/u.test(cleanTitle(tagBase))) return tagBase;
  const dir = posix.dirname(file);
  return dir === '.' ? '' : posix.basename(dir);
}

/**
 * Sépare les fichiers en jeux simples et en groupes de disquettes (même dossier, même extension, même nom de base).
 * Deux sortes de groupes : TOSEC (`Disk N of M`, un groupe incomplet reste un groupe, avec avertissement) et libres (T18, `Disk1` ;
 * ne sont regroupés que des numéros consécutifs à partir de 1, sinon les fichiers restent des jeux simples).
 * @param {string[]} files chemins relatifs au dossier de la machine
 * @param {string} systemId pour les avertissements
 * @param {string[]} warnings reçoit les avertissements
 * @returns {{singles: string[], groups: {base: string, total: number|null, disks: {file: string, number: number}[]}[]}}
 */
function groupDiskSets(files, systemId, warnings) {
  const singles = [];
  const byKey = new Map();
  const looseByKey = new Map();
  const addTo = (map, key, base, entry, total = null) => {
    if (!map.has(key)) map.set(key, { base, total: null, disks: [] });
    const group = map.get(key);
    group.total = Math.max(group.total ?? 0, total ?? 0) || null;
    group.disks.push(entry);
  };
  for (const file of files) {
    const stem = stemOf(file);
    const isImageSet = !['m3u', 'cue'].includes(extOf(file));
    const tag = isImageSet ? parseDiskTag(stem) : null;
    if (tag) {
      addTo(byKey, `${posix.dirname(file)}|${extOf(file)}|${tag.base.toLowerCase()}`, tag.base, { file, number: tag.number }, tag.total);
      continue;
    }
    const loose = isImageSet ? parseLooseDiskTag(stem) : null;
    const base = loose ? looseGroupBase(file, loose.base) : '';
    if (!base) { singles.push(file); continue; }
    addTo(looseByKey, `${posix.dirname(file)}|${extOf(file)}|${base.toLowerCase()}`, base, { file, number: loose.number });
  }
  const groups = [...byKey.values()];
  for (const group of looseByKey.values()) {
    if (isConsecutiveFromOne(group.disks.map((d) => d.number))) { groups.push(group); continue; }
    singles.push(...group.disks.map((d) => d.file));
    if (group.disks.length > 1) {
      warnings.push(`${systemId} : disquettes de ${group.base} non regroupées (numéros non consécutifs à partir de 1) : ${group.disks.map((d) => posix.basename(d.file)).join(', ')}`);
    }
  }
  return { singles, groups };
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
  // T18 : seules les machines avec `diskSets: true` (systems.json) regroupent des disquettes ; ailleurs « Disk 1 » est un nom comme un autre.
  const { singles, groups } = system.diskSets === true ? groupDiskSets(candidates, system.id, warnings) : { singles: candidates, groups: [] };
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
  // T18 : d'après l'analyse du cœur puae d'EmulatorJS 4.2.3 (non confirmée en navigateur), l'IPF n'est probablement pas lu (capsimg.so absent, chargement dynamique désactivé : voir docs/architecture.md 3.1 et le ticket T18).
  for (const game of byId.values()) {
    if (extOf(game.file) === 'ipf') warnings.push(`${system.id} : ${game.title} est au format IPF, que le cœur d'EmulatorJS 4.2.3 ne lit probablement pas (non confirmé en navigateur) : préférez des ADF`);
  }
  const games = [...byId.values()].sort((a, b) =>
    compareTitles(a.title, b.title) || (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  return { games, warnings };
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
