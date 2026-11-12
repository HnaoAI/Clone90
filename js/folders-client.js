// Client de l'API locale des dossiers (T25) : lit les dossiers utilisés, demande un choix. Dépend seulement de fetch (injectable).
// INVARIANT : on n'envoie JAMAIS de chemin, seulement le type de choix ('roms', 'bios', 'roms-default', 'bios-default') : c'est la boîte du Mac qui choisit.
// Adresses relatives (GitHub Pages sous /<dépôt>/). Sans API (GitHub Pages, serveur ouvert au réseau, autre système), fetchFolderSettings renvoie null.

const SETTINGS_URL = 'api/settings';
const CHOOSE_URL = 'api/settings/choose';
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
