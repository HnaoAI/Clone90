// Dossiers des machines (T53) : au démarrage de Clone90 sur le Mac (serve.mjs), crée `roms/<machine>` pour chaque machine de systems.json
// qui n'a pas encore de dossier (et les futures machines, sans rien écrire en dur, règle 2), ainsi que le dossier des BIOS s'il manque.
// Dépend de js/games-builder.js (`pickSystemDir` : un dossier `Amiga` existant compte pour `amiga`). Aucune dépendance npm.
// INVARIANT (demande de Hicham du 2026-11-22) : on CRÉE seulement des dossiers vides ; rien n'est déplacé, renommé ni supprimé ; un nom de
//   dossier est l'id de systems.json (minuscules, sans espace : `pcengine`, `gba`), et un id qui n'a pas cette forme est ignoré.
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { pickSystemDir } from '../js/games-builder.js';

const SAFE_ID = /^[a-z0-9]+$/;

/**
 * Crée les dossiers des machines qui manquent dans le dossier des jeux, et le dossier des BIOS s'il manque.
 * @param {{romsDir: string, biosDir?: string, systems: {id: string}[]}} input dossiers absolus (clone90.local.json ou roms/ et bios/ du projet)
 * @returns {Promise<{created: string[], errors: string[]}>} `created` : ids des dossiers créés ; `errors` : messages (ne lève jamais)
 */
export async function ensureRomFolders({ romsDir, biosDir, systems }) {
  const created = [];
  const errors = [];
  try {
    await mkdir(romsDir, { recursive: true });
    if (biosDir) await mkdir(biosDir, { recursive: true });
  } catch (err) {
    return { created, errors: [`Dossier des jeux ou des BIOS impossible à créer : ${err.message}`] };
  }
  const entries = await readdir(romsDir, { withFileTypes: true }).catch(() => []);
  const names = entries.map((e) => e.name);
  for (const { id } of systems ?? []) {
    if (typeof id !== 'string' || !SAFE_ID.test(id)) continue;
    if (names.includes(pickSystemDir(names, id))) continue; // dossier déjà là (casse près), ou fichier du même nom : on n'y touche pas
    try {
      await mkdir(join(romsDir, id));
      names.push(id);
      created.push(id);
    } catch (err) {
      if (err.code !== 'EEXIST') errors.push(`roms/${id} : ${err.message}`);
    }
  }
  return { created, errors };
}
