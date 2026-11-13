// Mises à jour de Clone90 sur le Mac (T35) : dernière version publiée (js/version.js de la branche main sur github.com), état de la copie git,
// application par `git pull --ff-only`. Branché par settings-api.mjs (api/update...) ; le redémarrage du serveur est fait par serve.mjs.
// Sans dépendance npm. Numéros de version : js/update-check.js (partagé avec le navigateur). Réseau et git injectables pour les tests.
// INVARIANT (CLAUDE.md règle 5, exception (d)) : la SEULE lecture réseau est LATEST_VERSION_URL (adresse fixe), à chaque ouverture de Clone90 ;
//   rien n'est envoyé (GitHub voit l'adresse IP). Le pull ne vient que de l'origine github.com/HnaoAI/Clone90, branche main, en avance rapide :
//   jamais de fusion ni d'écrasement d'une modification locale ; roms/, bios/, games.json et clone90.local.json sont ignorés par git.
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseAppVersion, compareVersions } from '../js/update-check.js';

export { parseAppVersion, compareVersions };

export const LATEST_VERSION_URL = 'https://raw.githubusercontent.com/HnaoAI/Clone90/main/js/version.js';
const MAX_VERSION_BYTES = 64 * 1024;
const CHECK_TIMEOUT_MS = 10_000;
const GIT_TIMEOUT_MS = 120_000;
/** Origine acceptée pour le pull (https ou ssh, avec ou sans .git). */
const OFFICIAL_ORIGIN = /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)HnaoAI\/Clone90(?:\.git)?\/?$/i;

/** Version installée (js/version.js du dossier). @throws {Error} si illisible */
export async function readInstalledVersion(root) {
  const version = parseAppVersion(await readFile(join(root, 'js', 'version.js'), 'utf8'));
  if (!version) throw new Error('version installée illisible');
  return version;
}

/**
 * Dernière version publiée.
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<string>} x.y.z
 * @throws {Error} réseau, réponse non 200, trop grande ou sans numéro
 */
export async function fetchLatestVersion(fetchFn = globalThis.fetch) {
  const res = await fetchFn(LATEST_VERSION_URL, { signal: AbortSignal.timeout(CHECK_TIMEOUT_MS), headers: { 'User-Agent': 'Clone90' }, cache: 'no-store' });
  if (!res.ok) throw new Error(`réponse ${res.status}`);
  const text = await res.text();
  const version = text.length <= MAX_VERSION_BYTES ? parseAppVersion(text) : null;
  if (!version) throw new Error('numéro de version introuvable');
  return version;
}

/** Lance git dans `root`. @returns {Promise<string>} sortie standard, sans espaces autour @throws {Error} avec `code` ENOENT si git est absent */
export function runGit(root, args) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: root, timeout: GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (err, stdout, stderr) => {
      if (err) { err.stderr = String(stderr ?? ''); reject(err); } else resolve(String(stdout).trim());
    });
  });
}

const MANUAL = 'Pour mettre à jour à la main : ouvre le Terminal dans le dossier de Clone90 et tape « git pull ».';
const PROBLEMS = {
  'no-git': 'git n\'est pas installé sur ce Mac.',
  'not-a-repo': 'Ce dossier de Clone90 n\'est pas une copie git du projet.',
  'other-origin': 'Ce dossier ne vient pas du dépôt officiel de Clone90.',
  'other-branch': 'Ce dossier n\'est pas sur la branche main.',
  'local-changes': 'Des fichiers de Clone90 ont été modifiés dans ce dossier : Clone90 ne les écrase pas.',
};

/**
 * Peut-on mettre à jour tout seul ? Copie git, origine officielle, branche main, aucun fichier suivi modifié (les fichiers non suivis sont permis).
 * @param {string} root @param {(root: string, args: string[]) => Promise<string>} [git]
 * @returns {Promise<{ok: true} | {ok: false, code: string, message: string}>} `message` en français, avec la commande à lancer à la main
 */
export async function checkRepository(root, git = runGit) {
  const fail = (code) => ({ ok: false, code, message: `${PROBLEMS[code]} ${MANUAL}` });
  try {
    if ((await git(root, ['rev-parse', '--is-inside-work-tree'])) !== 'true') return fail('not-a-repo');
  } catch (err) { return fail(err.code === 'ENOENT' ? 'no-git' : 'not-a-repo'); }
  try {
    if (!OFFICIAL_ORIGIN.test(await git(root, ['remote', 'get-url', 'origin']))) return fail('other-origin');
    if ((await git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])) !== 'main') return fail('other-branch');
    if ((await git(root, ['status', '--porcelain', '--untracked-files=no'])) !== '') return fail('local-changes');
  } catch { return fail('not-a-repo'); }
  return { ok: true };
}

/**
 * Vérifie s'il existe une version plus récente.
 * @param {{root: string, fetchFn?: typeof fetch, git?: Function}} options
 * @returns {Promise<{status: 'uptodate', current: string} | {status: 'available', current: string, latest: string, canApply: boolean, message?: string}
 *   | {status: 'error', message: string}>}
 */
export async function checkForUpdate({ root, fetchFn, git = runGit }) {
  let current;
  let latest;
  try { current = await readInstalledVersion(root); } catch { return { status: 'error', message: 'La version installée est illisible.' }; }
  try { latest = await fetchLatestVersion(fetchFn); } catch { return { status: 'error', message: 'Impossible de vérifier les mises à jour (pas de connexion à Internet ?).' }; }
  if (compareVersions(latest, current) <= 0) return { status: 'uptodate', current };
  const repo = await checkRepository(root, git);
  return repo.ok ? { status: 'available', current, latest, canApply: true } : { status: 'available', current, latest, canApply: false, message: repo.message };
}

/**
 * Applique la mise à jour : revérifie la copie, puis `git pull --ff-only origin main`.
 * @param {{root: string, git?: Function}} options
 * @returns {Promise<{ok: true, version: string} | {ok: false, message: string}>} `version` : version installée après le pull
 */
export async function applyUpdate({ root, git = runGit }) {
  const repo = await checkRepository(root, git);
  if (!repo.ok) return { ok: false, message: repo.message };
  try {
    await git(root, ['pull', '--ff-only', 'origin', 'main']);
  } catch (err) {
    console.error('git pull impossible :', err.stderr || err.message);
    return { ok: false, message: `La mise à jour a échoué (pas de connexion à Internet, ou dossier modifié). Rien n'a été changé. ${MANUAL}` };
  }
  return { ok: true, version: await readInstalledVersion(root).catch(() => '?') };
}
