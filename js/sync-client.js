// Synchronisation Mac -> téléphone, côté téléphone (T43) : association avec le Mac (T51 : mot de passe seulement, le Mac est cherché sur le
// Wi-Fi par sync-discovery.js ; adresse saisie seulement en secours), puis copie dans la bibliothèque du
// navigateur (IndexedDB `clone90-local`, comme « Mes fichiers ») de ce qui manque : jeux, pochettes, logos et BIOS du Mac.
// T44 : « Envoyer mes jeux au Mac » (sendGamesToMac), jeux et pochettes (T53 : et BIOS) du téléphone absents du Mac, au clic seulement ; un fichier envoyé
//   devient « venu du Mac » (liste `files`) : supprimé ensuite sur le Mac, il est retiré du téléphone à la synchronisation suivante (choix de
//   Hicham du 2026-11-15).
// Automatique à chaque ouverture de Clone90 sur le téléphone (app.js), et sur le bouton « Synchroniser maintenant ».
// Dépend de sync-plan.js (règles partagées avec le Mac). Réseau, bibliothèque, stockage et place disponible injectables (tests sans navigateur).
// T51 : si le Mac n'est plus à son adresse (box qui en donne une autre), le téléphone essaie son nom .local, puis (synchronisation demandée
//   par la personne seulement, pas à l'ouverture) balaie le réseau local ; l'adresse trouvée est gardée si le Mac accepte le jeton.
// T52 : envoi au Mac surveillé (progression en octets, abandon propre après 1 min sans progression page visible, 1 nouvel essai, jeu
//   suivant) et écran gardé allumé (keepScreenOn) : Chrome Android mettait l'envoi en pause sans que rien ne le montre.
// INVARIANT (CLAUDE.md règle 5, exception e) : le téléphone ne parle qu'à des adresses privées ou .local du réseau local, en HTTPS ;
//   il n'envoie qu'au Mac Clone90 trouvé le mot de passe (association), le jeton d'association, les chemins des fichiers demandés et, au clic sur « Envoyer mes jeux au Mac » (T44), les
//   jeux, BIOS (T53) et pochettes du téléphone que le Mac n'a pas ; rien n'est envoyé ailleurs.
// INVARIANT : ne remplace ni n'efface jamais un fichier que la personne a mis elle-même sur le téléphone (voir planSync) ; ne lève jamais.
import { normalizeMacAddress, isSyncPassword, discoveryCandidates, readManifest, planSync, describeSyncResult, planUpload, describeUploadResult, SYNC_ROUTES,
  PASSWORD_MIN_LENGTH, UPLOAD_STALL_MS, declaredBiosFiles, biosIndex } from './sync-plan.js';
import { findMac, probeMac } from './sync-discovery.js';

/** Clé du stockage local : {url, name (T51, `<nom>.local` du Mac ou null), token, files: {cheminTéléphone: {size, mtime}}, lastSync}. */
export const SYNC_STORAGE_KEY = 'clone90-sync';
/** Place gardée libre sur le téléphone (le navigateur refuse d'écrire tout près de la limite). */
const SPACE_MARGIN = 20 * 1024 * 1024;

const READ_INIT = (token) => ({ credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', ...(token && { headers: { Authorization: `Bearer ${token}` } }) });

/**
 * T51 : message quand aucun Mac ne répond. Le navigateur ne dit pas POURQUOI une adresse ne répond pas (certificat refusé ou Mac absent) :
 * le message donne les causes dans l'ordre le plus probable et renvoie au guide du certificat ; le Mac, lui, signale « certificat refusé ».
 */
export const MAC_NOT_FOUND_TEXT = 'Mac introuvable sur le Wi-Fi. Le plus souvent, le certificat du Mac n\'est pas encore installé sur ce téléphone : '
  + 'suivez le guide « Première fois » ci-dessous (si le Mac affiche « Un téléphone a refusé le certificat de ce Mac », c\'est bien cela). '
  + 'Sinon, vérifiez que le téléphone est sur le même Wi-Fi que le Mac, que Clone90 est ouvert sur le Mac avec le partage actif, '
  + 'et que Chrome a le droit d\'accéder aux appareils du réseau local.';

/**
 * Association enregistrée, ou null. Ne lève jamais. `token` vaut null quand le Mac a refusé le jeton (T51 : mot de passe à ressaisir ; la liste
 * `files` des fichiers venus du Mac est gardée pour la prochaine association). @param {Storage} [storage]
 */
export function readSyncPairing(storage = globalThis.localStorage) {
  try {
    const data = JSON.parse(storage.getItem(SYNC_STORAGE_KEY) ?? 'null');
    if (!data || typeof data.url !== 'string' || !normalizeMacAddress(data.url) || (typeof data.token !== 'string' && data.token !== null)) return null;
    const files = data.files && typeof data.files === 'object' && !Array.isArray(data.files) ? data.files : {};
    const name = typeof data.name === 'string' && /\.local$/.test(data.name) ? data.name : null;
    return { url: data.url, name, token: data.token, files, lastSync: Number.isFinite(data.lastSync) ? data.lastSync : null };
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
 * T51 : associe ce téléphone au Mac avec le mot de passe choisi sur le Mac. Le Mac est cherché sur le Wi-Fi (adresse précédente, puis
 * balayage du réseau local), sauf si la personne a saisi son adresse.
 * @param {{password: string, address?: string, fetchFn?: typeof fetch, storage?: Storage, onProgress?: (p: {done: number, total: number}) => void,
 *   find?: typeof findMac}} input `find` injectable (tests)
 * @returns {Promise<{ok: true, url: string, name: string|null}|{ok: false, reason: 'password'|'address'|'not-found'|'refused', message: string}>} ne lève jamais
 */
export async function pairWithMac({ password, address = '', fetchFn = globalThis.fetch, storage = globalThis.localStorage, onProgress = () => {}, find = findMac }) {
  if (!isSyncPassword(password)) {
    return { ok: false, reason: 'password', message: `Saisissez le mot de passe choisi sur le Mac (${PASSWORD_MIN_LENGTH} caractères au moins).` };
  }
  const previous = readSyncPairing(storage);
  const candidates = discoveryCandidates({ manual: address, saved: previous?.url, name: previous?.name });
  if (!candidates) return { ok: false, reason: 'address', message: 'Adresse du Mac invalide : saisissez celle affichée sur le Mac (par exemple 192.168.1.20), ou laissez vide.' };
  const mac = await find({ ...candidates, fetchFn, onProgress });
  if (!mac) return { ok: false, reason: 'not-found', message: MAC_NOT_FOUND_TEXT };
  let res;
  try {
    res = await fetchFn(`${mac.url}${SYNC_ROUTES.pair}`, { ...READ_INIT(), method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) });
  } catch {
    return { ok: false, reason: 'not-found', message: MAC_NOT_FOUND_TEXT };
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || typeof body?.token !== 'string') return { ok: false, reason: 'refused', message: body?.message ?? `Le Mac a refusé l'association (${res.status}).` };
  // Même Mac qu'avant (mot de passe ressaisi) : la liste des fichiers venus de lui est gardée, pour retirer plus tard ceux qu'il n'a plus.
  const sameMac = previous && (previous.url === mac.url || (previous.name && previous.name === mac.name));
  saveSyncPairing({ url: mac.url, name: mac.name, token: body.token, files: sameMac ? previous.files : {}, lastSync: sameMac ? previous.lastSync : null }, storage);
  return { ok: true, url: mac.url, name: mac.name };
}

/**
 * T51 : liste du Mac associé, en le retrouvant s'il a changé d'adresse : adresse gardée, puis nom .local, puis (si `deep`) balayage du réseau local.
 * Une nouvelle adresse n'est gardée que si le Mac qui y répond accepte le jeton (sinon c'est un autre Mac Clone90).
 * @returns {Promise<{res: Response, pairing: object}|null>} null si le Mac est introuvable ; ne lève jamais
 */
async function reachMac(pairing, { fetchFn, storage, deep, find }) {
  const read = async (url) => { try { return await fetchFn(`${url}${SYNC_ROUTES.manifest}`, READ_INIT(pairing.token)); } catch { return null; } };
  const first = await read(pairing.url);
  if (first) return { res: first, pairing };
  const { priority, scan } = discoveryCandidates({ saved: pairing.url, name: pairing.name });
  const others = priority.filter((u) => u !== pairing.url);
  const mac = deep ? await find({ priority: others, scan, fetchFn }) : await (async () => {
    for (const url of others) { const found = await probeMac(url, { fetchFn }); if (found) return found; }
    return null;
  })();
  if (!mac) return null;
  const res = await read(mac.url);
  if (!res || res.status === 401) return null;
  const moved = { ...pairing, url: mac.url, name: mac.name ?? pairing.name ?? null };
  saveSyncPairing(moved, storage);
  return { res, pairing: moved };
}

let running = false;

/** Jeton refusé par le Mac (téléphones oubliés, ou mot de passe changé sur le Mac). */
export const NOT_PAIRED_TEXT = 'Ce téléphone n\'est plus associé au Mac (mot de passe changé ou téléphones oubliés sur le Mac) : saisissez de nouveau le mot de passe du Mac.';

/**
 * Copie depuis le Mac ce qui manque au téléphone, met à jour ce qui a changé et retire ce que le Mac n'a plus (fichiers venus du Mac seulement).
 * @param {{library: {list: Function, put: Function, remove: Function}, systems: object[], fetchFn?: typeof fetch, storage?: Storage,
 *   estimate?: () => Promise<{quota?: number, usage?: number}>, onProgress?: (p: {done: number, total: number, name?: string}) => void, quiet?: boolean}} input
 *   `quiet` : synchronisation automatique (message seulement si quelque chose a changé ou échoué)
 * @returns {Promise<{status: 'done'|'unpaired'|'unreachable'|'busy'|'error', text: string|null, changed: boolean}>} ne lève jamais
 */
export async function syncFromMac({ library, systems, fetchFn = globalThis.fetch, storage = globalThis.localStorage,
  estimate = () => globalThis.navigator?.storage?.estimate?.() ?? Promise.resolve({}), onProgress = () => {}, quiet = false, find = findMac }) {
  const saved = readSyncPairing(storage);
  if (!saved?.token) return { status: 'unpaired', text: null, changed: false };
  if (running) return { status: 'busy', text: null, changed: false };
  running = true;
  try {
    // T51 : à l'ouverture (quiet), pas de balayage du réseau : le téléphone peut être loin de la maison.
    const reached = await reachMac(saved, { fetchFn, storage, deep: !quiet, find });
    if (!reached) return { status: 'unreachable', text: quiet ? null : MAC_NOT_FOUND_TEXT, changed: false };
    const { res, pairing } = reached;
    if (res.status === 401) { saveSyncPairing({ ...pairing, token: null }, storage); return { status: 'unpaired', text: NOT_PAIRED_TEXT, changed: false }; }
    const systemIds = systems.map((s) => s.id);
    // T53 : un BIOS du Mac est rangé sous son nom déclaré dans bios/, là où le lecteur l'attend (même rangé avec les jeux sur le Mac).
    const remote = res.ok ? readManifest(await res.json().catch(() => null), systemIds, biosIndex(systems)) : null;
    if (!remote) return { status: 'error', text: `Réponse inattendue du Mac (${res.status}).`, changed: false };
    const plan = planSync({ remote, local: await library.list(), synced: pairing.files, systemIds });
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
/** T52 : essais par fichier quand plus rien ne passe (le 2e après abandon propre du 1er). */
const STALL_TRIES = 2;

/**
 * T52 : envoi d'un fichier par XMLHttpRequest, seul moyen d'un navigateur de suivre les octets ENVOYÉS (fetch ne le permet pas).
 * Mêmes en-têtes et mêmes garanties que fetch : jeton, aucun cookie (withCredentials false).
 * @param {string} url @param {{token: string, blob: Blob, signal: AbortSignal, onBytes: (n: number) => void}} input
 * @returns {Promise<{status: number, body: object|null}>} rejette sur erreur réseau ou abandon
 */
export function xhrUpload(url, { token, blob, signal, onBytes }) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = false;
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.upload.onprogress = (e) => onBytes(e.loaded);
    xhr.onload = () => { let body = null; try { body = JSON.parse(xhr.responseText); } catch { body = null; } resolve({ status: xhr.status, body }); };
    xhr.onerror = () => reject(new Error('réseau'));
    xhr.onabort = () => reject(new Error('abandon'));
    signal.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(blob);
  });
}

/** Envoi par fetch (hors navigateur, tests) : pas de suivi des octets, seulement le début et la fin. */
function fetchUpload(fetchFn) {
  return async (url, { token, blob, signal, onBytes }) => {
    onBytes(0);
    const res = await fetchFn(url, { ...READ_INIT(token), method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
      body: blob, signal });
    return { status: res.status, body: await res.json().catch(() => null) };
  };
}

/**
 * T52 : un essai d'envoi surveillé. Sans aucune progression pendant `stallMs`, l'envoi est abandonné (le Mac efface son fichier
 * temporaire) ; jamais tant que Clone90 est caché (autre appli, écran éteint : Chrome Android met l'envoi en pause, il reprend au retour).
 * @returns {Promise<{status: number, body: object|null}|{stalled: true}>} rejette sur erreur réseau
 */
async function watchedUpload(upload, url, { token, blob, stallMs, isHidden, onBytes }) {
  const ctrl = new AbortController();
  let timer = null;
  let giveUp;
  const stalled = new Promise((resolve) => { giveUp = resolve; });
  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { if (isHidden()) arm(); else { ctrl.abort(); giveUp({ stalled: true }); } }, stallMs);
  };
  arm();
  try {
    return await Promise.race([upload(url, { token, blob, signal: ctrl.signal, onBytes: (n) => { arm(); onBytes(n); } }).catch((err) => {
      if (ctrl.signal.aborted) return { stalled: true };
      throw err;
    }), stalled]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * T44 : envoie au Mac les jeux, puis (T53) les BIOS, puis les pochettes mis par la personne sur ce téléphone et absents du Mac (même chemin),
 * du plus petit au plus gros. Jamais les logos ni un BIOS rangé avec les jeux (T52) ; jamais un jeu venu du Mac ; le Mac ne remplace jamais un fichier.
 * T52 : progression en octets par fichier ; un fichier sans progression pendant `stallMs` (page visible) est abandonné, réessayé une fois,
 * puis compté « interrompu », et l'envoi passe au suivant ; Mac occupé (429) : attente `busyWaitMs` puis nouvel essai, `busyTries` fois.
 * @param {{library: {list: Function, get: Function}, systems: object[], fetchFn?: typeof fetch, storage?: Storage,
 *   onProgress?: (p: {done: number, total: number, name?: string, sentBytes?: number, size?: number, retry?: boolean}) => void,
 *   upload?: Function, stallMs?: number, isHidden?: () => boolean, busyWaitMs?: number, busyTries?: number, wait?: (ms: number) => Promise<void>}} input
 *   `upload` : envoi d'un fichier (défaut : XMLHttpRequest dans le navigateur, sinon fetchFn) ; les autres options sont injectables pour les tests
 * @returns {Promise<{status: 'done'|'unpaired'|'unreachable'|'refused'|'busy'|'error', text: string|null, sent: number}>} ne lève jamais
 *   `refused` : le Mac n'accepte pas les jeux (case à cocher sur le Mac)
 */
export async function sendGamesToMac({ library, systems, fetchFn = globalThis.fetch, storage = globalThis.localStorage, onProgress = () => {}, find = findMac,
  upload = fetchFn === globalThis.fetch && typeof globalThis.XMLHttpRequest === 'function' ? xhrUpload : fetchUpload(fetchFn), stallMs = UPLOAD_STALL_MS,
  isHidden = () => globalThis.document?.visibilityState === 'hidden', busyWaitMs = 5000, busyTries = 14, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const saved = readSyncPairing(storage);
  if (!saved?.token) return { status: 'unpaired', text: null, sent: 0 };
  if (running) return { status: 'busy', text: 'Une synchronisation est déjà en cours.', sent: 0 };
  running = true;
  try {
    const reached = await reachMac(saved, { fetchFn, storage, deep: true, find });
    if (!reached) return { status: 'unreachable', text: MAC_NOT_FOUND_TEXT, sent: 0 };
    const { res, pairing } = reached;
    if (res.status === 401) { saveSyncPairing({ ...pairing, token: null }, storage); return { status: 'unpaired', text: NOT_PAIRED_TEXT, sent: 0 }; }
    const body = res.ok ? await res.json().catch(() => null) : null;
    const systemIds = systems.map((s) => s.id);
    const remote = readManifest(body, systemIds, biosIndex(systems));
    if (!remote) return { status: 'error', text: `Réponse inattendue du Mac (${res.status}).`, sent: 0 };
    if (body.uploads !== true) return { status: 'refused', text: UPLOADS_OFF_TEXT, sent: 0 };
    const plan = planUpload({ remote, local: await library.list(), synced: pairing.files, systemIds, biosFiles: declaredBiosFiles(systems) });
    const result = { sent: 0, bios: 0, covers: 0, already: plan.already, tooBig: plan.tooBig, noSpace: 0, failed: 0, interrupted: 0, busy: 0 };
    const files = { ...pairing.files };
    let stop = null;
    for (const [i, entry] of plan.send.entries()) {
      const name = entry.path.split('/').pop();
      const step = { done: i, total: plan.send.length, name, size: entry.size };
      onProgress({ ...step, sentBytes: 0 });
      try {
        const blob = await library.get(entry.path);
        if (!blob) throw new Error('fichier absent');
        const url = `${pairing.url}${SYNC_ROUTES.upload}?path=${encodeURIComponent(entry.path)}`;
        let answer = null;
        let stalls = 0;
        let busy = 0;
        for (;;) {
          const retry = stalls > 0 || busy > 0;
          const out = await watchedUpload(upload, url, { token: pairing.token, blob, stallMs, isHidden, onBytes: (n) => onProgress({ ...step, sentBytes: n, retry }) });
          if (out.stalled) {
            stalls += 1;
            console.warn('Envoi au Mac : plus rien ne passe,', entry.path);
            if (stalls >= STALL_TRIES) break;
          } else if (out.status === 429 && out.body?.error === 'busy') {
            busy += 1;
            if (busy >= busyTries) break;
            await wait(busyWaitMs);
          } else { answer = out; break; }
        }
        if (!answer) { result[stalls >= STALL_TRIES ? 'interrupted' : 'busy'] += 1; continue; }
        const { status, body: reply } = answer;
        if (status === 201 && Number.isSafeInteger(reply?.size) && Number.isFinite(reply?.mtime)) {
          files[entry.path] = { size: reply.size, mtime: reply.mtime };
          saveSyncPairing({ ...pairing, files }, storage);
          result[entry.bios ? 'bios' : entry.cover ? 'covers' : 'sent'] += 1;
        } else if (reply?.error === 'exists') { if (!entry.cover && !entry.bios) result.already += 1; }
        else if (reply?.error === 'no-space') result.noSpace += 1;
        else if (reply?.error === 'too-big') result.tooBig += 1;
        else {
          result.failed += 1;
          if (STOP_ERRORS.has(reply?.error) || status === 401) { stop = reply?.error === 'uploads-off' ? UPLOADS_OFF_TEXT : (reply?.message ?? null); break; }
        }
      } catch (err) {
        console.warn('Envoi au Mac :', entry.path, err.message);
        result.failed += 1;
      }
    }
    onProgress({ done: plan.send.length, total: plan.send.length });
    const text = describeUploadResult(result);
    return { status: 'done', text: stop ? `${text} ${stop}` : text, sent: result.sent + result.bios + result.covers };
  } catch (err) {
    console.error('Envoi au Mac impossible :', err);
    return { status: 'error', text: 'L\'envoi au Mac a échoué.', sent: 0 };
  } finally {
    running = false;
  }
}

/**
 * T52 : garde l'écran allumé pendant l'envoi (Wake Lock API), pour que Chrome Android ne mette pas l'envoi en pause. Le navigateur rend
 * le verrou quand la page est cachée : il est redemandé au retour sur Clone90. Sans Wake Lock (ou refusé) : rien, sans erreur.
 * @param {{nav?: Navigator, doc?: Document}} [env] @returns {Promise<() => Promise<void>>} fonction qui rend l'écran
 */
export async function keepScreenOn({ nav = globalThis.navigator, doc = globalThis.document } = {}) {
  if (typeof nav?.wakeLock?.request !== 'function' || !doc) return async () => {};
  let lock = null;
  let ended = false;
  const ask = async () => { try { const l = await nav.wakeLock.request('screen'); if (ended) await l.release(); else lock = l; } catch { lock = null; } };
  const onVisible = () => { if (doc.visibilityState === 'visible') ask(); };
  await ask();
  doc.addEventListener('visibilitychange', onVisible);
  return async () => {
    ended = true;
    doc.removeEventListener('visibilitychange', onVisible);
    try { await lock?.release(); } catch { /* déjà rendu */ }
  };
}

/** T44 : message quand la réception n'est pas permise sur le Mac. */
export const UPLOADS_OFF_TEXT = 'Le Mac n\'accepte pas encore les jeux du téléphone. Sur le Mac : « Dossiers », « Partager avec le téléphone », '
  + '« Accepter les jeux du téléphone », puis réessayez.';
