// Dossiers des machines (T53) : au démarrage de Clone90 sur le Mac (serve.mjs), crée `roms/<machine>` pour chaque machine de systems.json
// qui n'a pas encore de dossier (et les futures machines, sans rien écrire en dur, règle 2), ainsi que le dossier des BIOS s'il manque.
// T56 : aussi dès que systems.json change pendant que Clone90 tourne (watchSystemsFile), avant chaque games.json (withFolderCheck) et avant
// la liste envoyée au téléphone qui se synchronise (sync-api.mjs) ; createFolderKeeper regroupe la lecture des réglages et de systems.json.
// Dépend de js/games-builder.js (`pickSystemDir` : un dossier `Amiga` existant compte pour `amiga`). Aucune dépendance npm.
// INVARIANT (demande de Hicham du 2026-11-22) : on CRÉE seulement des dossiers vides ; rien n'est déplacé, renommé ni supprimé ; un nom de
//   dossier est l'id de systems.json (minuscules, sans espace : `pcengine`, `gba`), et un id qui n'a pas cette forme est ignoré.
import { watch } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
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

/**
 * Vérification des dossiers à la demande (T56), qui ne lève jamais : relit les dossiers et la liste des machines à chaque appel.
 * @param {{getDirs: () => Promise<{romsDir: string, biosDir?: string}>, getSystems: () => Promise<{id: string}[]>,
 *   ensure?: typeof ensureRomFolders, log?: (m: string) => void, warn?: (m: string) => void}} options
 * @returns {{prepare: (dirs?: {romsDir: string, biosDir?: string}) => Promise<{created: string[], errors: string[]}>}}
 *   `dirs` : dossiers venant d'être choisis (sinon `getDirs`) ; un systems.json illisible (en cours d'écriture) donne un avertissement
 */
export function createFolderKeeper({ getDirs, getSystems, ensure = ensureRomFolders, log = console.log, warn = console.warn }) {
  return {
    async prepare(dirs) {
      try {
        const { romsDir, biosDir } = dirs ?? await getDirs();
        const result = await ensure({ romsDir, biosDir, systems: await getSystems() });
        if (result.created.length) log(`Dossiers des machines créés : ${result.created.map((id) => `roms/${id}`).join(', ')}`);
        for (const e of result.errors) warn(`Avertissement : ${e}`);
        return result;
      } catch (err) {
        warn(`Avertissement : dossiers des machines non vérifiés (${err.message})`);
        return { created: [], errors: [err.message] };
      }
    },
  };
}

/**
 * Surveille systems.json (T56) : `onChange` est appelé une fois après une salve d'écritures (git écrit puis renomme le fichier,
 * d'où la surveillance du dossier et non du fichier). Ne lève jamais : si la surveillance est impossible, un avertissement suffit
 * (les dossiers restent créés au démarrage, T53).
 * @param {{file: string, onChange: () => unknown, watchFn?: typeof watch, delayMs?: number, warn?: (m: string) => void}} options
 * @returns {{close: () => void}}
 */
export function watchSystemsFile({ file, onChange, watchFn = watch, delayMs = 300, warn = console.warn }) {
  const name = basename(file);
  let timer = null;
  let closed = false;
  let watcher = null;
  const fire = () => { timer = null; if (!closed) Promise.resolve().then(onChange).catch(() => {}); };
  try {
    watcher = watchFn(dirname(file), (event, changed) => {
      if (closed || (changed && String(changed) !== name)) return;
      clearTimeout(timer);
      timer = setTimeout(fire, delayMs);
    });
    watcher.on?.('error', () => {});
  } catch (err) {
    warn(`Avertissement : ${name} non surveillé, une nouvelle machine aura son dossier au prochain démarrage (${err.message})`);
  }
  return { close() { closed = true; clearTimeout(timer); watcher?.close(); } };
}

/**
 * Régénération de games.json précédée de la vérification des dossiers (T56) ; une erreur des dossiers n'empêche jamais la liste.
 * @template T @param {() => Promise<unknown>} prepare @param {() => Promise<T>} regenerate @returns {() => Promise<T>}
 */
export function withFolderCheck(prepare, regenerate) {
  return async () => {
    await Promise.resolve().then(prepare).catch(() => {});
    return regenerate();
  };
}
