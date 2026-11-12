// Client de l'API locale des dossiers (T25) et des pochettes (T28) : lit les dossiers utilisés, demande un choix, lance et suit le téléchargement des pochettes. Dépend seulement de fetch (injectable).
// INVARIANT : on n'envoie JAMAIS de chemin, seulement le type de choix ('roms', 'bios', 'roms-default', 'bios-default') : c'est la boîte du Mac qui choisit.
// Adresses relatives (GitHub Pages sous /<dépôt>/). Sans API (GitHub Pages, serveur ouvert au réseau, autre système), fetchFolderSettings renvoie null.

const SETTINGS_URL = 'api/settings';
const CHOOSE_URL = 'api/settings/choose';
const COVERS_URL = 'api/covers';
const COVERS_DOWNLOAD_URL = 'api/covers/download';
const COVERS_STATES = ['idle', 'running', 'done', 'error'];
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
 * Lance le téléchargement des pochettes (corps `{}` : aucun paramètre, le serveur décide de tout).
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<{status: 'started'|'busy'|'error', message?: string}>} ne lève jamais d'exception
 */
export async function requestCoversDownload(fetchFn = globalThis.fetch) {
  let res;
  try {
    res = await fetchFn(COVERS_DOWNLOAD_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Clone90': '1' }, body: '{}' });
  } catch {
    return { status: 'error', message: UNREACHABLE_TEXT };
  }
  const body = await res.json().catch(() => null);
  if (res.status === 202 && isObject(body) && body.status === 'started') return { status: 'started' };
  if (res.status === 409 && isObject(body)) return { status: 'busy', message: body.message };
  return { status: 'error', message: 'Impossible de lancer le téléchargement des pochettes : la demande a été refusée.' };
}

/**
 * État du téléchargement des pochettes : `{status: 'idle'|'running'|'done'|'error', progress?, found?, lines?, message?}`.
 * @param {typeof fetch} [fetchFn]
 * @returns {Promise<object|null>} null si le serveur ne répond pas ou répond autre chose
 */
export async function fetchCoversStatus(fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn(COVERS_URL, { cache: 'no-store' });
    if (!res.ok) return null;
    const body = await res.json();
    return isObject(body) && COVERS_STATES.includes(body.status) ? body : null;
  } catch {
    return null;
  }
}
