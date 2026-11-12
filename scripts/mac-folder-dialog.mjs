// Boîte « choisir un dossier » du Mac (T25), ouverte côté serveur par osascript. Appelée par settings-api.mjs. Aucune dépendance.
// INVARIANT : le navigateur ne fournit JAMAIS de texte à cette boîte ni de chemin : le texte vient de PROMPTS, le chemin choisit le Mac.
import { execFile as nodeExecFile } from 'node:child_process';
import { promisify } from 'node:util';

/** Texte de la boîte selon ce que l'on choisit (constantes : rien ne vient du navigateur). */
const PROMPTS = {
  roms: 'Choisissez le dossier qui contient vos ROMs',
  bios: 'Choisissez le dossier qui contient vos BIOS',
};
/** Délai maximal d'attente de la boîte (la personne peut prendre son temps). */
const DIALOG_TIMEOUT_MS = 10 * 60 * 1000;

/** Script AppleScript de la boîte. @throws {Error} si `kind` est inconnu */
export function buildAppleScript(kind) {
  if (!Object.hasOwn(PROMPTS, kind)) throw new Error(`Type de dossier inconnu : ${kind}`);
  return `POSIX path of (choose folder with prompt "${PROMPTS[kind]}")`;
}

/**
 * Ouvre la boîte du Mac et attend le choix.
 * @param {'roms'|'bios'} kind
 * @param {{execFile?: Function, signal?: AbortSignal}} [options] `execFile` (promise) injectable pour les tests ; `signal` abandonne la boîte
 * @returns {Promise<string|null>} chemin absolu sans « / » final, ou null si la personne annule
 * @throws {Error} si osascript échoue pour une autre raison qu'une annulation
 */
export async function chooseFolderOnMac(kind, { execFile = promisify(nodeExecFile), signal } = {}) {
  const script = buildAppleScript(kind);
  try {
    const { stdout } = await execFile('osascript', ['-e', script], { timeout: DIALOG_TIMEOUT_MS, signal });
    const path = String(stdout).trim();
    if (path === '') return null;
    return path === '/' ? path : path.replace(/\/+$/, '');
  } catch (err) {
    if (err?.name === 'AbortError' || err?.code === 'ABORT_ERR') return null; // requête fermée : la boîte est abandonnée
    if (/-128/.test(err?.stderr ?? '')) return null; // « User canceled. (-128) »
    throw err;
  }
}
