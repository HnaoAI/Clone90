// Synchronisation Mac -> téléphone, côté téléphone (T43) : association avec le Mac (adresse + code), puis copie dans la bibliothèque du
// navigateur (IndexedDB `clone90-local`, comme « Mes fichiers ») de ce qui manque : jeux, pochettes, logos et BIOS du Mac.
// T44 : « Envoyer mes jeux au Mac » (sendGamesToMac), jeux et pochettes du téléphone absents du Mac, au clic seulement ; un fichier envoyé
//   devient « venu du Mac » (liste `files`) : supprimé ensuite sur le Mac, il est retiré du téléphone à la synchronisation suivante (choix de
//   Hicham du 2026-11-15).
// Automatique à chaque ouverture de Clone90 sur le téléphone (app.js), et sur le bouton « Synchroniser maintenant ».
// Dépend de sync-plan.js (règles partagées avec le Mac). Réseau, bibliothèque, stockage et place disponible injectables (tests sans navigateur).
// INVARIANT (CLAUDE.md règle 5, exception e) : le téléphone ne parle qu'au Mac dont la personne a saisi l'adresse (réseau local privé, HTTPS) ;
//   il ne lui envoie que le jeton d'association, les chemins des fichiers demandés et, au clic sur « Envoyer mes jeux au Mac » (T44), les
//   jeux et pochettes du téléphone que le Mac n'a pas ; rien n'est envoyé ailleurs.
// INVARIANT : ne remplace ni n'efface jamais un fichier que la personne a mis elle-même sur le téléphone (voir planSync) ; ne lève jamais.
import { normalizeMacAddress, isPairingCode, readManifest, planSync, describeSyncResult, planUpload, describeUploadResult, SYNC_ROUTES } from './sync-plan.js';

/** Clé du stockage local : {url, token, files: {cheminTéléphone: {size, mtime}}, lastSync}. */
export const SYNC_STORAGE_KEY = 'clone90-sync';
/** Place gardée libre sur le téléphone (le navigateur refuse d'écrire tout près de la limite). */
const SPACE_MARGIN = 20 * 1024 * 1024;

const READ_INIT = (token) => ({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', ...(token && { headers: { Authorization: `Bearer ${token}` } }) });

/** Message quand le Mac ne répond pas (le plus souvent : autre Wi-Fi, partage arrêté, Clone90 fermé ou certificat absent). */
export const unreachableText = (url) => `Mac injoignable. Vérifiez que le téléphone est sur le même Wi-Fi, que Clone90 est ouvert sur le Mac avec le partage activé, `
  + `et que le certificat du Mac est installé sur ce téléphone (ouvrez ${url} dans Chrome pour l'obtenir).`;

/** Association enregistrée, ou null. Ne lève jamais. @param {Storage} [storage] */
export function readSyncPairing(storage = globalThis.localStorage) {
  try {
    const data = JSON.parse(storage.getItem(SYNC_STORAGE_KEY) ?? 'null');
    if (!data || typeof data.url !== 'string' || !normalizeMacAddress(data.url) || typeof data.token !== 'string') return null;
    const files = data.files && typeof data.files === 'object' && !Array.isArray(data.files) ? data.files : {};
    return { url: data.url, token: data.token, files, lastSync: Number.isFinite(data.lastSync) ? data.lastSync : null };
  } catch {
    return null;
  }
}

/** Enregistre l'association (meilleur effort). @returns {boolean} */
export function saveSyncPairing(pairing, storage = globalThis.localStorage) {
  try { storage.setItem(SYNC_STORAGE_KEY, JSON.stringify(pairing)); return true; } catch { return false; }
}

/** Oublie le Mac. Les fichiers déjà copiés restent sur le téléphone (ils deviennent des fichiers comme les autres). */
export function forgetSyncPairing(storage = globalThis.localStorage) {
  try { storage.removeItem(SYNC_STORAGE_KEY); } catch { /* rien à faire */ }
}

/**
 * Associe ce téléphone au Mac.
 * @param {{address: string, code: string, fetchFn?: typeof fetch, storage?: Storage}} input
 * @returns {Promise<{ok: true, url: string}|{ok: false, message: string}>} ne lève jamais
 */
export async function pairWithMac({ address, code, fetchFn = globalThis.fetch, storage = globalThis.localStorage }) {
  const url = normalizeMacAddress(address);
  if (!url) return { ok: false, message: 'Adresse du Mac invalide : saisissez celle affichée sur le Mac (par exemple 192.168.1.20).' };
  const clean = String(code ?? '').replace(/\s/g, '');
  if (!isPairingCode(clean)) return { ok: false, message: 'Le code est fait de 6 chiffres, affichés sur le Mac.' };
  let res;
  try {
    res = await fetchFn(`${url}${SYNC_ROUTES.pair}`, { ...READ_INIT(), method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: clean }) });
  } catch {
    return { ok: false, message: unreachableText(url) };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.token !== 'string') return { ok: false, message: body?.message ?? `Le Mac a refusé l'association (${res.status}).` };
  saveSyncPairing({ url, token: body.token, files: {}, lastSync: null }, storage);
  return { ok: true, url };
}

let running = false;

/**
 * Copie depuis le Mac ce qui manque au téléphone, met à jour ce qui a changé et retire ce que le Mac n'a plus (fichiers venus du Mac seulement).
 * @param {{library: {list: Function, put: Function, remove: Function}, systems: object[], fetchFn?: typeof fetch, storage?: Storage,
 *   estimate?: () => Promise<{quota?: number, usage?: number}>, onProgress?: (p: {done: number, total: number, name?: string}) => void, quiet?: boolean}} input
 *   `quiet` : synchronisation automatique (message seulement si quelque chose a changé ou échoué)
 * @returns {Promise<{status: 'done'|'unpaired'|'unreachable'|'busy'|'error', text: string|null, changed: boolean}>} ne lève jamais
 */
export async function syncFromMac({ library, systems, fetchFn = globalThis.fetch, storage = globalThis.localStorage,
  estimate = () => globalThis.navigator?.storage?.estimate?.() ?? Promise.resolve({}), onProgress = () => {}, quiet = false }) {
  const pairing = readSyncPairing(storage);
  if (!pairing) return { status: 'unpaired', text: null, changed: false };
  if (running) return { status: 'busy', text: null, changed: false };
  running = true;
  try {
    let res;
    try { res = await fetchFn(`${pairing.url}${SYNC_ROUTES.manifest}`, READ_INIT(pairing.token)); } catch {
      return { status: 'unreachable', text: quiet ? null : unreachableText(pairing.url), changed: false };
    }
    if (res.status === 401) return { status: 'unpaired', text: 'Ce téléphone n\'est plus associé au Mac : associez-le de nouveau avec un nouveau code.', changed: false };
    const remote = res.ok ? readManifest(await res.json().catch(() => null), systems.map((s) => s.id)) : null;
    if (!remote) return { status: 'error', text: `Réponse inattendue du Mac (${res.status}).`, changed: false };
    const plan = planSync({ remote, local: await library.list(), synced: pairing.files });
    const todo = [...plan.copy, ...plan.replace];
    const replaced = new Set(plan.replace.map((e) => e.target));
    const result = { copied: 0, replaced: 0, removed: 0, failed: 0, noSpace: 0, quiet };
    const files = { ...pairing.files };
    const save = () => saveSyncPairing({ ...pairing, files, lastSync: Date.now() }, storage);
    for (const [i, entry] of todo.entries()) {
      onProgress({ done: i, total: todo.length, name: entry.target.split('/').pop() });
      const { quota, usage } = await estimate().catch(() => ({}));
      if (Number.isFinite(quota) && Number.isFinite(usage) && quota - usage < entry.size + SPACE_MARGIN) { result.noSpace += 1; continue; }
      try {
        const fileRes = await fetchFn(`${pairing.url}${SYNC_ROUTES.file}?path=${encodeURIComponent(entry.path)}`, READ_INIT(pairing.token));
        if (!fileRes.ok) throw new Error(`réponse ${fileRes.status}`);
        const blob = await fileRes.blob();
        if (blob.size !== entry.size) throw new Error('fichier incomplet');
        await library.put(entry.target, blob);
        files[entry.target] = { size: entry.size, mtime: entry.mtime };
        result[replaced.has(entry.target) ? 'replaced' : 'copied'] += 1;
        save();
      } catch (err) {
        console.warn('Synchronisation :', entry.path, err.message);
        result.failed += 1;
      }
    }
    for (const target of plan.remove) {
      try { await library.remove(target); delete files[target]; result.removed += 1; } catch { result.failed += 1; }
    }
    for (const target of Object.keys(files)) if (!remote.some((e) => e.target === target)) delete files[target];
    save();
    onProgress({ done: todo.length, total: todo.length });
    return { status: 'done', text: describeSyncResult(result), changed: result.copied + result.replaced + result.removed > 0 };
  } catch (err) {
    console.error('Synchronisation impossible :', err);
    return { status: 'error', text: quiet ? null : 'La synchronisation a échoué.', changed: false };
  } finally {
    running = false;
  }
}

/** T44 : erreurs du Mac qui arrêtent tout l'envoi (les suivants échoueraient de même). */
const STOP_ERRORS = new Set(['uploads-off', 'not-paired', 'no-folder']);

/**
 * T44 : envoie au Mac les jeux puis les pochettes mis par la personne sur ce téléphone et absents du Mac (même chemin), du plus petit au plus gros.
 * Jamais les BIOS ni les logos ; jamais un jeu venu du Mac ; le Mac ne remplace jamais un fichier existant.
 * @param {{library: {list: Function, get: Function}, systems: object[], fetchFn?: typeof fetch, storage?: Storage,
 *   onProgress?: (p: {done: number, total: number, name?: string}) => void}} input
 * @returns {Promise<{status: 'done'|'unpaired'|'unreachable'|'refused'|'busy'|'error', text: string|null, sent: number}>} ne lève jamais
 *   `refused` : le Mac n'accepte pas les jeux (case à cocher sur le Mac)
 */
export async function sendGamesToMac({ library, systems, fetchFn = globalThis.fetch, storage = globalThis.localStorage, onProgress = () => {} }) {
  const pairing = readSyncPairing(storage);
  if (!pairing) return { status: 'unpaired', text: null, sent: 0 };
  if (running) return { status: 'busy', text: 'Une synchronisation est déjà en cours.', sent: 0 };
  running = true;
  try {
    let res;
    try { res = await fetchFn(`${pairing.url}${SYNC_ROUTES.manifest}`, READ_INIT(pairing.token)); } catch {
      return { status: 'unreachable', text: unreachableText(pairing.url), sent: 0 };
    }
    if (res.status === 401) return { status: 'unpaired', text: 'Ce téléphone n\'est plus associé au Mac : associez-le de nouveau avec un nouveau code.', sent: 0 };
    const body = res.ok ? await res.json().catch(() => null) : null;
    const systemIds = systems.map((s) => s.id);
    const remote = readManifest(body, systemIds);
    if (!remote) return { status: 'error', text: `Réponse inattendue du Mac (${res.status}).`, sent: 0 };
    if (body.uploads !== true) return { status: 'refused', text: UPLOADS_OFF_TEXT, sent: 0 };
    const plan = planUpload({ remote, local: await library.list(), synced: pairing.files, systemIds });
    const result = { sent: 0, covers: 0, already: plan.already, tooBig: plan.tooBig, noSpace: 0, failed: 0 };
    const files = { ...pairing.files };
    let stop = null;
    for (const [i, entry] of plan.send.entries()) {
      onProgress({ done: i, total: plan.send.length, name: entry.path.split('/').pop() });
      try {
        const blob = await library.get(entry.path);
        if (!blob) throw new Error('fichier absent');
        const up = await fetchFn(`${pairing.url}${SYNC_ROUTES.upload}?path=${encodeURIComponent(entry.path)}`, {
          ...READ_INIT(pairing.token), method: 'POST', headers: { Authorization: `Bearer ${pairing.token}`, 'Content-Type': 'application/octet-stream' }, body: blob });
        const answer = await up.json().catch(() => null);
        if (up.status === 201 && Number.isSafeInteger(answer?.size) && Number.isFinite(answer?.mtime)) {
          files[entry.path] = { size: answer.size, mtime: answer.mtime };
          saveSyncPairing({ ...pairing, files }, storage);
          result[entry.cover ? 'covers' : 'sent'] += 1;
        } else if (answer?.error === 'exists') { if (!entry.cover) result.already += 1; }
        else if (answer?.error === 'no-space') result.noSpace += 1;
        else if (answer?.error === 'too-big') result.tooBig += 1;
        else {
          result.failed += 1;
          if (STOP_ERRORS.has(answer?.error) || up.status === 401) { stop = answer?.error === 'uploads-off' ? UPLOADS_OFF_TEXT : (answer?.message ?? null); break; }
        }
      } catch (err) {
        console.warn('Envoi au Mac :', entry.path, err.message);
        result.failed += 1;
      }
    }
    onProgress({ done: plan.send.length, total: plan.send.length });
    const text = describeUploadResult(result);
    return { status: 'done', text: stop ? `${text} ${stop}` : text, sent: result.sent + result.covers };
  } catch (err) {
    console.error('Envoi au Mac impossible :', err);
    return { status: 'error', text: 'L\'envoi au Mac a échoué.', sent: 0 };
  } finally {
    running = false;
  }
}

/** T44 : message quand la réception n'est pas permise sur le Mac. */
export const UPLOADS_OFF_TEXT = 'Le Mac n\'accepte pas encore les jeux du téléphone. Sur le Mac : « Dossiers », « Partager avec le téléphone », '
  + '« Accepter les jeux du téléphone », puis réessayez.';
