// Réglages locaux de Clone90 (T23) : lit et valide clone90.local.json (dossier des ROMs et des BIOS), fichier ignoré par git.
// Partagé par generate-games.mjs et serve.mjs (une seule règle). Aucune dépendance. Usage en ligne de commande : voir main().
import { readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT } from './project-root.mjs';

export const LOCAL_SETTINGS_FILE = 'clone90.local.json';
/** Réglages connus : clé du fichier -> dossier par défaut (sous la racine du projet) et nom affiché. */
export const FOLDER_SETTINGS = {
  romsDir: { defaultDir: 'roms', label: 'ROMs' },
  biosDir: { defaultDir: 'bios', label: 'BIOS' },
};

/** Lit le fichier brut. @returns {Promise<{data: object, warning?: string}>} `data` vide si absent ou illisible. */
async function readRawSettings(root) {
  let raw;
  try {
    raw = await readFile(join(root, LOCAL_SETTINGS_FILE), 'utf8');
  } catch {
    return { data: {} };
  }
  try {
    const data = JSON.parse(raw);
    if (data && typeof data === 'object' && !Array.isArray(data)) return { data };
  } catch { /* traité ci-dessous */ }
  return { data: {}, invalid: true, warning: `${LOCAL_SETTINGS_FILE} illisible (JSON invalide) : dossiers par défaut utilisés` };
}

/** Message d'erreur en français si la valeur n'est pas un chemin absolu vers un dossier existant, sinon null. */
async function folderProblem(key, value) {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    return `${LOCAL_SETTINGS_FILE} : ${key} doit être un chemin absolu (ex. /Volumes/Disque/ROMs)`;
  }
  const info = await stat(value).catch(() => null);
  return info?.isDirectory() ? null : `${LOCAL_SETTINGS_FILE} : ${key} n'est pas un dossier existant : ${value}`;
}

/**
 * Dossiers des ROMs et des BIOS à utiliser. Une valeur absente ou invalide retombe sur roms/ ou bios/ du projet.
 * INVARIANT : ne lance jamais d'exception ; un réglage faux ne bloque pas Clone90, il est signalé dans `warnings`.
 * @param {string} [root] racine du projet
 * @returns {Promise<{romsDir: string, biosDir: string, custom: {romsDir: boolean, biosDir: boolean}, warnings: string[]}>}
 */
export async function readLocalSettings(root = PROJECT_ROOT) {
  const { data, warning } = await readRawSettings(root);
  const warnings = warning ? [warning] : [];
  const result = { custom: {}, warnings };
  for (const [key, { defaultDir }] of Object.entries(FOLDER_SETTINGS)) {
    const value = data[key];
    result[key] = join(root, defaultDir);
    result.custom[key] = false;
    if (value === undefined || value === null) continue;
    const problem = await folderProblem(key, value);
    if (problem) warnings.push(`${problem}. Dossier ${defaultDir}/ du projet utilisé.`);
    else {
      result[key] = resolve(value);
      result.custom[key] = true;
    }
  }
  return result;
}

/**
 * Modifie des réglages sans toucher aux autres clés du fichier. Une valeur `null` retire la clé (retour au dossier par défaut).
 * Écriture atomique. @throws {Error} si le fichier existant est invalide (on ne l'écrase pas) ou si la clé est inconnue.
 */
export async function updateLocalSettings(root, patch) {
  const { data, invalid } = await readRawSettings(root);
  if (invalid) throw new Error(`${LOCAL_SETTINGS_FILE} existe mais n'est pas un JSON valide : corrigez-le ou supprimez-le.`);
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in FOLDER_SETTINGS)) throw new Error(`Réglage inconnu : ${key}`);
    if (value === null) delete data[key];
    else data[key] = value;
  }
  const target = join(root, LOCAL_SETTINGS_FILE);
  const temp = `${target}.tmp-${process.pid}`;
  try {
    await writeFile(temp, `${JSON.stringify(data, null, 2)}\n`);
    await rename(temp, target);
  } catch (err) {
    await rm(temp, { force: true });
    throw err;
  }
}

/** Résumé en français des dossiers utilisés (une ligne par dossier). */
export function describeFolders(settings) {
  return Object.entries(FOLDER_SETTINGS).map(([key, { defaultDir, label }]) => (
    `Dossier des ${label} : ${settings[key]}${settings.custom[key] ? '' : ` (${defaultDir}/ du projet)`}`));
}

/** Ligne de commande : `show` affiche le résumé ; `set <romsDir|biosDir> <chemin|->` enregistre (« - » : retour au défaut). */
async function main(argv) {
  const [command, key, value] = argv;
  if (command === 'set' && key && value !== undefined) {
    await updateLocalSettings(PROJECT_ROOT, { [key]: value === '-' ? null : value });
  } else if (command !== 'show') {
    console.error('Usage : node scripts/local-settings.mjs show | set <romsDir|biosDir> <chemin|->');
    return 1;
  }
  const settings = await readLocalSettings(PROJECT_ROOT);
  for (const line of describeFolders(settings)) console.log(line);
  for (const w of settings.warnings) console.log(`Avertissement : ${w}`);
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  process.exitCode = await main(process.argv.slice(2)).catch((err) => { console.error(err.message); return 1; });
}
