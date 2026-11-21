// BIOS dans la synchronisation Mac <-> téléphone (T53) : règles PURES partagées par le Mac (scripts/sync-server.mjs, sync-upload.mjs)
// et le téléphone (js/sync-client.js), via js/sync-plan.js. Aucun accès réseau ni disque ici. Dépend de config.js (ROMS_DIR, BIOS_DIR).
// T53 (décision de Hicham du 2026-11-22, « inclus les ») : les BIOS passent dans les deux sens. Sur le téléphone, un BIOS est rangé là où
//   le lecteur l'attend : `bios/<nom déclaré dans systems.json>` (même casse, comme biosStoragePath de local-library.js), même s'il est
//   rangé avec les jeux sur le Mac (roms/neogeo/neogeo.zip, vu sur le Mac de Hicham) ou écrit avec une autre casse (SYSCARD3.PCE).
// INVARIANT : un BIOS n'est jamais listé comme un jeu (T38) : sa place sur le téléphone est bios/, jamais roms/.
import { ROMS_DIR, BIOS_DIR } from './config.js';

/**
 * T52 : BIOS déclarés dans systems.json, sous la forme `<machine>/<fichier en minuscules>`. Un BIOS rangé par erreur avec les jeux de SA
 * machine (roms/neogeo/neogeo.zip, vu sur le Mac de Hicham le 2026-11-21) n'est pas un jeu (T38).
 * @param {{id: string, bios?: {file?: unknown}[]}[]} systems @returns {Set<string>}
 */
export function declaredBiosFiles(systems) {
  const out = new Set();
  for (const s of systems ?? []) {
    for (const b of Array.isArray(s?.bios) ? s.bios : []) if (typeof b?.file === 'string' && typeof s.id === 'string') out.add(`${s.id}/${b.file.toLowerCase()}`);
  }
  return out;
}

/**
 * T53 : index des BIOS déclarés : `names` (nom en minuscules -> nom exact de systems.json) et `files` (declaredBiosFiles).
 * @param {{id: string, bios?: {file?: unknown}[]}[]} systems @returns {{names: Map<string, string>, files: Set<string>}}
 */
export function biosIndex(systems) {
  const names = new Map();
  for (const s of systems ?? []) {
    for (const b of Array.isArray(s?.bios) ? s.bios : []) if (typeof b?.file === 'string' && !b.file.includes('/')) names.set(b.file.toLowerCase(), b.file);
  }
  return { names, files: declaredBiosFiles(systems) };
}

/**
 * T53 : chemin d'un BIOS sur le téléphone, ou null si ce fichier n'est pas un BIOS.
 * `bios/<fichier>` -> `bios/<nom déclaré>` (casse de systems.json) ; `bios/<sous-dossier>/<fichier>` (samples arcade, T22) gardé tel quel ;
 * `roms/<machine>/[...]/<BIOS déclaré de cette machine>` -> `bios/<nom déclaré>`.
 * @param {string[]} parts chemin du Mac découpé (noms déjà vérifiés par l'appelant)
 * @param {{names: Map<string, string>, files: Set<string>}|null} index biosIndex(systems), ou null (pas de renommage)
 * @returns {string|null}
 */
export function biosTargetPath(parts, index) {
  const canonical = (name) => index?.names.get(name.toLowerCase()) ?? name;
  if (parts[0] === BIOS_DIR) {
    if (parts.length === 2) return `${BIOS_DIR}/${canonical(parts[1])}`;
    return parts.length === 3 ? parts.join('/') : null;
  }
  const name = parts[parts.length - 1];
  if (parts[0] === ROMS_DIR && parts.length >= 3 && index?.files.has(`${parts[1]}/${name.toLowerCase()}`)) return `${BIOS_DIR}/${canonical(name)}`;
  return null;
}

/** T53 : vrai pour un chemin de bios/ (BIOS ou samples). @param {string} path */
export const isBiosPath = (path) => typeof path === 'string' && path.startsWith(`${BIOS_DIR}/`);
