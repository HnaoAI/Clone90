// Client de l'API locale des dossiers (T25), des pochettes (T28), des logos des machines (T29) et de la suppression d'un jeu (T39) : lit les dossiers utilisés, demande un choix,
// lance et suit un téléchargement (pochettes ou logos, même mécanisme). Dépend seulement de fetch (injectable).
// INVARIANT : on n'envoie JAMAIS de chemin, seulement le type de choix ('roms', 'bios', 'roms-default', 'bios-default') : c'est la boîte du Mac qui choisit.
// Adresses relatives (GitHub Pages sous /<dépôt>/). Sans API (GitHub Pages, serveur ouvert au réseau, autre système), fetchFolderSettings renvoie null.

const SETTINGS_URL = 'api/settings';
const CHOOSE_URL = 'api/settings/choose';
const JOB_STATES = ['idle', 'running', 'done', 'error'];
const CHOICE_STATUSES = ['ok', 'cancelled', 'refused', 'error', 'busy'];
const UNREACHABLE_TEXT = 'Impossible de joindre Clone90. Le serveur est-il toujours lancé ?';

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Vrai si l'objet a la forme des dossiers renvoyés par l'API. */
export function isFolderSettings(v) {
  return isObject(v) && typeof v.romsDir === 'string' && typeof v.biosDir === 'string'
    && typeof v.romsIsDefault === 'boolean' && typeof v.biosIsDefault === 'boolean';
}

/**
 * Dossiers utilisés par le serveur local.
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<{romsDir: string, biosDir: string, romsIsDefault: boolean, biosIsDefault: boolean}|null>} null si l'API n'existe pas ou ne répond pas
 */
export async function fetchFolderSettings(fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn(SETTINGS_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    return isFolderSettings(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * Demande le choix d'un dossier (ouvre la boîte du Mac et attend la réponse, parfois longtemps).
 * @param {'roms'|'bios'|'roms-default'|'bios-default'} kind
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<{status: 'ok'|'cancelled'|'refused'|'error'|'busy', message?: string, settings?: object}>} ne lève jamais d'exception
 */
export async function requestFolderChoice(kind, fetchFn = globalThis.fetch) {
  let res;
  try {
    res = await fetchFn(CHOOSE_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Clone90': '1' },
      body: JSON.stringify({ kind }),
    });
  } catch {
    return { status: 'error', message: UNREACHABLE_TEXT };
  }
  const body = await res.json().catch(() => null);
  if (isObject(body) && CHOICE_STATUSES.includes(body.status)) return body;
  return { status: 'error', message: res.ok ? 'Réponse inattendue de Clone90.' : 'Impossible de changer les dossiers : la demande a été refusée.' };
}

/**
 * Lance un téléchargement en arrière-plan (corps `{}` : aucun paramètre, le serveur décide de tout).
 * @param {'covers'|'logos'} name @param {string} what « des pochettes », « des logos » (message de refus)
 * @returns {Promise<{status: 'started'|'busy'|'error', message?: string}>} ne lève jamais d'exception
 */
async function requestJobStart(name, what, fetchFn) {
  let res;
  try {
    res = await fetchFn(`api/${name}/download`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Clone90': '1' }, body: '{}' });
  } catch {
    return { status: 'error', message: UNREACHABLE_TEXT };
  }
  const body = await res.json().catch(() => null);
  if (res.status === 202 && isObject(body) && body.status === 'started') return { status: 'started' };
  if (res.status === 409 && isObject(body)) return { status: 'busy', message: body.message };
  return { status: 'error', message: `Impossible de lancer le téléchargement ${what} : la demande a été refusée.` };
}

/** État d'un téléchargement : `{status: 'idle'|'running'|'done'|'error', id?, progress?, found?, lines?, message?}`, ou null si le serveur ne répond pas ou répond autre chose. */
async function fetchJobStatus(name, fetchFn) {
  try {
    const res = await fetchFn(`api/${name}`, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    return isObject(body) && JOB_STATES.includes(body.status) ? body : null;
  } catch {
    return null;
  }
}

/** Lance le téléchargement des pochettes (T28). @param {typeof fetch} [fetchFn] @returns {Promise<{status: 'started'|'busy'|'error', message?: string}>} */
export const requestCoversDownload = (fetchFn = globalThis.fetch) => requestJobStart('covers', 'des pochettes', fetchFn);
/** État du téléchargement des pochettes (T28). @param {typeof fetch} [fetchFn] @returns {Promise<object|null>} */
export const fetchCoversStatus = (fetchFn = globalThis.fetch) => fetchJobStatus('covers', fetchFn);
/** Lance le téléchargement des logos des machines (T29). @param {typeof fetch} [fetchFn] @returns {Promise<{status: 'started'|'busy'|'error', message?: string}>} */
export const requestLogosDownload = (fetchFn = globalThis.fetch) => requestJobStart('logos', 'des logos', fetchFn);
/** État du téléchargement des logos (T29). @param {typeof fetch} [fetchFn] @returns {Promise<object|null>} */
export const fetchLogosStatus = (fetchFn = globalThis.fetch) => fetchJobStatus('logos', fetchFn);

/**
 * T39 : le serveur local sait-il effacer un jeu du disque (Mac ou PC, serveur limité à cet ordinateur) ? GET api/games.
 * @param {typeof fetch} [fetchFn] @returns {Promise<boolean>} false sur GitHub Pages, sur un téléphone, ou si le serveur est ouvert au réseau local
 */
export async function fetchGameDeleteSupport(fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn('api/games', { cache: 'no-store' });
    if (!res.ok) return false;
    const body = await res.json();
    return isObject(body) && body.deletable === true;
  } catch {
    return false;
  }
}

/**
 * T39 : demande au serveur local d'effacer un jeu du disque. On n'envoie QUE l'id du jeu : le serveur retrouve ses fichiers dans games.json.
 * @param {string} gameId @param {typeof fetch} [fetchFn]
 * @returns {Promise<{status: 'ok'|'not-found'|'busy'|'error', removed?: number, failed?: number, message?: string}>} ne lève jamais d'exception
 */
export async function requestGameDelete(gameId, fetchFn = globalThis.fetch) {
  let res;
  try {
    res = await fetchFn('api/games/delete', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Clone90': '1' }, body: JSON.stringify({ id: gameId }) });
  } catch {
    return { status: 'error', message: UNREACHABLE_TEXT };
  }
  const body = await res.json().catch(() => null);
  if (isObject(body) && ['ok', 'not-found', 'busy', 'error'].includes(body.status)) return body;
  return { status: 'error', message: 'La suppression a été refusée.' };
}
