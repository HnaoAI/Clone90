// Panneau « Partager avec le téléphone » du Mac (T43) : activer ou arrêter le partage par le Wi-Fi, afficher l'adresse du Mac et un code
// d'appairage, oublier les téléphones associés ; T44 : accepter ou non les jeux envoyés par les téléphones (éteint par défaut).
// Ouvert depuis le panneau « Dossiers des jeux ». Client de l'API locale `api/sync` (sync-api.mjs).
// Dépend de ui/dialog.js et ui/dom.js. `fetchFn` injectable (tests). Textes en français.
// INVARIANT : comme toute boîte (dialog.js), le panneau ne lit jamais clavier ni manette ; l'hôte lui transmet les actions.
import { el, clear } from './dom.js';
import { createDialog } from './dialog.js';

const UNREACHABLE = 'Impossible de joindre Clone90. Le serveur est-il toujours lancé ?';
/** Ce qui est ouvert au réseau, dit avant le premier clic (sécurité, décision de Hicham du 2026-11-15). */
export const SYNC_INFO = 'Le partage ouvre ce Mac au Wi-Fi, en lecture seule par défaut : un téléphone associé (code à 6 chiffres) peut copier vos jeux, '
  + 'pochettes, logos et BIOS. Rien ne peut être modifié ni effacé sur le Mac. Si vous cliquez « Accepter les jeux du téléphone », un téléphone associé '
  + 'peut aussi AJOUTER ses jeux dans le dossier des jeux de ce Mac, sans jamais remplacer un fichier. Les autres appareils du Wi-Fi ne voient que la page '
  + 'd\'aide et le certificat. Le partage reste actif aux prochains lancements de Clone90, jusqu\'à « Arrêter le partage ».';
/** Libellés des boutons, dans l'ordre. */
export const SYNC_BUTTONS = { enable: 'Activer le partage', disable: 'Arrêter le partage', pair: 'Associer un téléphone', forget: 'Oublier les téléphones associés',
  uploadsOn: 'Accepter les jeux du téléphone', uploadsOff: 'Ne plus accepter les jeux du téléphone', close: 'Fermer' };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isStatus = (b) => isObject(b) && typeof b.enabled === 'boolean' && typeof b.running === 'boolean' && Array.isArray(b.addresses);

/** État du partage (GET api/sync). @returns {Promise<object|null>} null si l'API ne répond pas (GitHub Pages, téléphone) */
export async function fetchSyncStatus(fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn('api/sync', { cache: 'no-store' });
    const body = res.ok ? await res.json() : null;
    return isStatus(body) ? body : null;
  } catch {
    return null;
  }
}

/**
 * Demande une action (POST api/sync/<action>, corps `{}`).
 * @param {'enable'|'disable'|'pair'|'forget'|'uploads-on'|'uploads-off'} action
 * @returns {Promise<{status?: object, message?: string}>} ne lève jamais
 */
export async function requestSyncAction(action, fetchFn = globalThis.fetch) {
  try {
    const res = await fetchFn(`api/sync/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Clone90': '1' }, body: '{}' });
    const body = await res.json().catch(() => null);
    return { status: isStatus(body) ? body : undefined, message: res.ok ? undefined : (body?.message ?? 'La demande a été refusée.') };
  } catch {
    return { message: UNREACHABLE };
  }
}

/** Minutes restantes d'un code, pour l'affichage. */
const minutesLeft = (expiresAt, now) => Math.max(1, Math.ceil((expiresAt - now) / 60000));

/**
 * Lignes à afficher pour un état (pur).
 * @param {object|null} status @param {number} [now]
 * @returns {{state: string, addresses: string[], code: string|null, codeNote: string|null, devices: string, uploads: string, error: string|null, steps: string[]}}
 *   `uploads` (T44) : réception des jeux du téléphone permise ou non
 */
export function describeSyncStatus(status, now = Date.now()) {
  if (!status) return { state: UNREACHABLE, addresses: [], code: null, codeNote: null, devices: '', uploads: '', error: null, steps: [] };
  const n = status.devices ?? 0;
  const first = status.addresses[0] ?? '';
  return {
    state: status.running ? 'Partage actif sur le Wi-Fi.' : 'Partage arrêté : rien n\'est ouvert au réseau.',
    addresses: status.addresses,
    code: status.code?.value ?? null,
    codeNote: status.code ? `Code valable ${minutesLeft(status.code.expiresAt, now)} min, pour un seul téléphone.` : null,
    devices: n === 0 ? 'Aucun téléphone associé.' : `${n} téléphone${n > 1 ? 's' : ''} associé${n > 1 ? 's' : ''}.`,
    uploads: status.acceptUploads === true
      ? 'Ce Mac accepte les jeux envoyés par les téléphones associés (« Envoyer mes jeux au Mac » dans « Mes fichiers » du téléphone).'
      : 'Ce Mac n\'accepte pas les jeux des téléphones.',
    error: status.error ?? null,
    steps: status.running ? [
      `Sur le téléphone, la première fois : ouvrez ${first || 'l\'adresse ci-dessus'} dans Chrome, acceptez l'avertissement, téléchargez le certificat et installez-le (Paramètres, Sécurité, « Certificat CA »).`,
      'Puis dans Clone90 sur le téléphone : « Mes fichiers », « Synchroniser avec le Mac », saisissez l\'adresse et le code.',
      'Ensuite, le téléphone se met à jour tout seul à chaque ouverture de Clone90, quand ce Mac est allumé avec Clone90 ouvert.',
    ] : [],
  };
}

/**
 * Crée le panneau. @param {{fetchFn?: typeof fetch, initial?: object|null, now?: () => number}} [options] @param {Document} [doc]
 * @returns {ReturnType<typeof createDialog>}
 */
export function createSyncPanel({ fetchFn = globalThis.fetch, initial = null, now = Date.now } = {}, doc = globalThis.document) {
  let status = initial;
  let busy = false;
  const body = el('div', { class: 'sync-status', attrs: { role: 'status', 'aria-live': 'polite' } }, [], doc);
  const dialog = createDialog({
    title: 'Partager avec le téléphone',
    content: [el('p', { class: 'dialog-message', text: SYNC_INFO, attrs: { id: 'sync-info' } }, [], doc), body],
    buttons: [{ label: SYNC_BUTTONS.enable }, { label: SYNC_BUTTONS.pair }, { label: SYNC_BUTTONS.forget }, { label: SYNC_BUTTONS.uploadsOn },
      { label: SYNC_BUTTONS.close, secondary: true }],
    vertical: true,
    boxClass: 'is-wide',
    describedBy: 'sync-info',
    onPress: (index, { close }) => {
      if (index === 4) { close(true); return; }
      if (busy) return;
      if (index === 0) act(status?.running ? 'disable' : 'enable');
      else if (index === 3) { if (status) act(status.acceptUploads ? 'uploads-off' : 'uploads-on'); }
      else if (status?.running || index === 2) act(index === 1 ? 'pair' : 'forget');
    },
  }, doc);

  function render(message = null) {
    const d = describeSyncStatus(status, now());
    clear(body);
    body.append(
      el('p', { class: 'dialog-message', text: d.state }, [], doc),
      ...d.addresses.map((a) => el('p', { class: 'dialog-message' }, ['Adresse du Mac : ', el('code', { text: a }, [], doc)], doc)),
      ...(d.code ? [el('p', { class: 'sync-code', text: d.code, attrs: { 'aria-label': `Code : ${d.code.split('').join(' ')}` } }, [], doc),
        el('p', { class: 'dialog-message', text: d.codeNote }, [], doc)] : []),
      el('p', { class: 'dialog-message', text: d.devices }, [], doc),
      ...(d.uploads ? [el('p', { class: 'dialog-message', text: d.uploads }, [], doc)] : []),
      ...d.steps.map((s) => el('p', { class: 'dialog-message muted', text: s }, [], doc)),
      ...[d.error, message].filter(Boolean).map((t) => el('p', { class: 'folders-status is-error', text: t }, [], doc)),
    );
    dialog.buttons[0].textContent = status?.running ? SYNC_BUTTONS.disable : SYNC_BUTTONS.enable;
    dialog.buttons[1].setAttribute('aria-disabled', String(busy || !status?.running));
    dialog.buttons[2].setAttribute('aria-disabled', String(busy || !(status?.devices > 0)));
    dialog.buttons[0].setAttribute('aria-disabled', String(busy));
    dialog.buttons[3].textContent = status?.acceptUploads ? SYNC_BUTTONS.uploadsOff : SYNC_BUTTONS.uploadsOn;
    dialog.buttons[3].setAttribute('aria-disabled', String(busy || !status));
  }

  async function act(action) {
    busy = true;
    render(action === 'enable' ? 'Préparation du certificat et du partage...' : null);
    const result = await requestSyncAction(action, fetchFn);
    if (result.status) status = result.status;
    busy = false;
    render(result.message ?? null);
  }

  render();
  if (!initial) fetchSyncStatus(fetchFn).then((s) => { status = s; render(); });
  return dialog;
}
