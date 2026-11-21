// Panneau « Partager avec le téléphone » du Mac (T43) : activer ou arrêter le partage par le Wi-Fi, afficher l'adresse du Mac, oublier les
// téléphones associés ; T44 : accepter ou non les jeux envoyés par les téléphones (éteint par défaut) ; T51 : choisir ou changer le mot de passe
// des téléphones (remplace le code à 6 chiffres) et signaler qu'un appareil du Wi-Fi a refusé le certificat du Mac.
// Ouvert depuis le panneau « Dossiers des jeux ». Client de l'API locale `api/sync` (sync-api.mjs).
// Dépend de ui/dialog.js et ui/dom.js. `fetchFn` injectable (tests). Textes en français.
// INVARIANT : comme toute boîte (dialog.js), le panneau ne lit jamais clavier ni manette ; l'hôte lui transmet les actions. Le champ du mot de
//   passe est un vrai champ (saisie au clavier du Mac) ; le bouton « Choisir le mot de passe » lit sa valeur.
import { el, clear } from './dom.js';
import { createDialog } from './dialog.js';
import { createPasswordToggle } from './password-toggle.js';

const UNREACHABLE = 'Impossible de joindre Clone90. Le serveur est-il toujours lancé ?';
/** Ce qui est ouvert au réseau, dit avant le premier clic (sécurité, décision de Hicham du 2026-11-15). */
export const SYNC_INFO = 'Le partage ouvre ce Mac au Wi-Fi, en lecture seule par défaut : un téléphone qui connaît le mot de passe peut copier vos jeux, '
  + 'pochettes, logos et BIOS. Rien ne peut être modifié ni effacé sur le Mac. Si vous cliquez « Accepter les jeux du téléphone », un téléphone associé '
  + 'peut aussi AJOUTER ses jeux, BIOS et pochettes dans les dossiers des jeux et des BIOS de ce Mac, sans jamais remplacer un fichier. Les autres appareils du Wi-Fi ne voient que la page '
  + 'd\'aide et le certificat. Le partage reste actif aux prochains lancements de Clone90, jusqu\'à « Arrêter le partage ».';
/** Libellés des boutons, dans l'ordre. */
export const SYNC_BUTTONS = { enable: 'Activer le partage', disable: 'Arrêter le partage', password: 'Choisir le mot de passe', changePassword: 'Changer le mot de passe',
  forget: 'Oublier les téléphones associés', uploadsOn: 'Accepter les jeux du téléphone', uploadsOff: 'Ne plus accepter les jeux du téléphone', close: 'Fermer' };
/** T51 : id du champ du mot de passe. */
export const SYNC_PASSWORD_ID = 'sync-password';

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
 * Demande une action (POST api/sync/<action>, corps `{}`, ou `{password}` pour 'password').
 * @param {'enable'|'disable'|'password'|'forget'|'uploads-on'|'uploads-off'} action
 * @param {typeof fetch} [fetchFn] @param {object} [body] corps JSON (T51 : `{password}`)
 * @returns {Promise<{status?: object, message?: string}>} ne lève jamais
 */
export async function requestSyncAction(action, fetchFn = globalThis.fetch, body = {}) {
  try {
    const res = await fetchFn(`api/sync/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Clone90': '1' }, body: JSON.stringify(body) });
    const answer = await res.json().catch(() => null);
    return { status: isStatus(answer) ? answer : undefined, message: res.ok ? undefined : (answer?.message ?? 'La demande a été refusée.') };
  } catch {
    return { message: UNREACHABLE };
  }
}

/**
 * Lignes à afficher pour un état (pur).
 * @param {object|null} status
 * @returns {{state: string, addresses: string[], password: string, certWarning: string|null, devices: string, uploads: string, error: string|null, steps: string[]}}
 *   `uploads` (T44) : réception des jeux du téléphone permise ou non ; `password`, `certWarning` (T51)
 */
export function describeSyncStatus(status) {
  if (!status) return { state: UNREACHABLE, addresses: [], password: '', certWarning: null, devices: '', uploads: '', error: null, steps: [] };
  const n = status.devices ?? 0;
  const first = status.addresses[0] ?? '';
  return {
    state: status.running ? 'Partage actif sur le Wi-Fi.' : 'Partage arrêté : rien n\'est ouvert au réseau.',
    addresses: status.addresses,
    password: status.hasPassword
      ? 'Mot de passe choisi : un téléphone le saisit une fois, puis se synchronise tout seul. Le changer oublie les téléphones associés.'
      : 'Aucun mot de passe : choisissez-en un (6 caractères au moins) ; c\'est la seule chose à saisir sur le téléphone.',
    certWarning: status.certRejected
      ? `Un téléphone (${status.certRejected}) a refusé le certificat de ce Mac : il n'est pas encore installé sur ce téléphone. Suivez l'étape 1 ci-dessous.`
      : null,
    devices: n === 0 ? 'Aucun téléphone associé.' : `${n} téléphone${n > 1 ? 's' : ''} associé${n > 1 ? 's' : ''}.`,
    uploads: status.acceptUploads === true
      ? 'Ce Mac accepte les jeux et pochettes envoyés par les téléphones associés (« Envoyer mes jeux au Mac » dans « Mes fichiers » du téléphone).'
      : 'Ce Mac n\'accepte pas les jeux des téléphones.',
    error: status.error ?? null,
    steps: status.running ? [
      `1. Une seule fois, sur le téléphone : ouvrez ${first || 'l\'adresse ci-dessus'} dans Chrome (« Paramètres avancés », « Continuer » si Chrome avertit), `
        + 'touchez « Télécharger le certificat », puis installez-le comme « Certificat CA » (Paramètres Android, cherchez « certificat »). La page du Mac guide pas à pas.',
      '2. Dans Clone90 sur le téléphone : « Mes fichiers », « Synchroniser avec le Mac », saisissez le mot de passe. Le téléphone trouve le Mac tout seul.',
      '3. Ensuite, le téléphone se met à jour tout seul à chaque ouverture de Clone90, quand ce Mac est allumé avec Clone90 ouvert.',
    ] : [],
  };
}

/**
 * Crée le panneau. @param {{fetchFn?: typeof fetch, initial?: object|null}} [options] @param {Document} [doc]
 * @returns {ReturnType<typeof createDialog> & {passwordInput: HTMLInputElement}}
 */
export function createSyncPanel({ fetchFn = globalThis.fetch, initial = null } = {}, doc = globalThis.document) {
  let status = initial;
  let busy = false;
  const body = el('div', { class: 'sync-status', attrs: { role: 'status', 'aria-live': 'polite' } }, [], doc);
  const passwordInput = el('input', { class: 'link-input', attrs: { id: SYNC_PASSWORD_ID, type: 'password', autocomplete: 'new-password', minlength: '6',
    maxlength: '128', spellcheck: 'false', placeholder: '6 caractères au moins' } }, [], doc);
  const passwordField = el('div', { class: 'link-form' }, [
    el('label', { class: 'link-label', text: 'Mot de passe des téléphones', attrs: { for: SYNC_PASSWORD_ID } }, [], doc),
    el('div', { class: 'link-row' }, [passwordInput, createPasswordToggle(passwordInput, { controls: SYNC_PASSWORD_ID }, doc)], doc)], doc);
  const dialog = createDialog({
    title: 'Partager avec le téléphone',
    content: [el('p', { class: 'dialog-message', text: SYNC_INFO, attrs: { id: 'sync-info' } }, [], doc), body, passwordField],
    buttons: [{ label: SYNC_BUTTONS.enable }, { label: SYNC_BUTTONS.password }, { label: SYNC_BUTTONS.forget }, { label: SYNC_BUTTONS.uploadsOn },
      { label: SYNC_BUTTONS.close, secondary: true }],
    vertical: true,
    boxClass: 'is-wide',
    describedBy: 'sync-info',
    onPress: (index, { close }) => {
      if (index === 4) { close(true); return; }
      if (busy) return;
      if (index === 0) act(status?.running ? 'disable' : 'enable');
      else if (index === 1) choosePassword();
      else if (index === 3) { if (status) act(status.acceptUploads ? 'uploads-off' : 'uploads-on'); }
      else if (index === 2) act('forget');
    },
  }, doc);

  function render(message = null) {
    const d = describeSyncStatus(status);
    clear(body);
    body.append(
      el('p', { class: 'dialog-message', text: d.state }, [], doc),
      ...d.addresses.map((a) => el('p', { class: 'dialog-message' }, ['Adresse du Mac : ', el('code', { text: a }, [], doc)], doc)),
      ...(d.certWarning ? [el('p', { class: 'folders-status is-error', text: d.certWarning }, [], doc)] : []),
      ...(d.password ? [el('p', { class: 'dialog-message', text: d.password }, [], doc)] : []),
      el('p', { class: 'dialog-message', text: d.devices }, [], doc),
      ...(d.uploads ? [el('p', { class: 'dialog-message', text: d.uploads }, [], doc)] : []),
      ...d.steps.map((s) => el('p', { class: 'dialog-message muted', text: s }, [], doc)),
      ...[d.error, message].filter(Boolean).map((t) => el('p', { class: 'folders-status is-error', text: t }, [], doc)),
    );
    dialog.buttons[0].textContent = status?.running ? SYNC_BUTTONS.disable : SYNC_BUTTONS.enable;
    dialog.buttons[0].setAttribute('aria-disabled', String(busy));
    dialog.buttons[1].textContent = status?.hasPassword ? SYNC_BUTTONS.changePassword : SYNC_BUTTONS.password;
    dialog.buttons[1].setAttribute('aria-disabled', String(busy || !status));
    dialog.buttons[2].setAttribute('aria-disabled', String(busy || !(status?.devices > 0)));
    dialog.buttons[3].textContent = status?.acceptUploads ? SYNC_BUTTONS.uploadsOff : SYNC_BUTTONS.uploadsOn;
    dialog.buttons[3].setAttribute('aria-disabled', String(busy || !status));
  }

  /** T51 : envoie le mot de passe saisi ; le champ est vidé après un succès (il n'est jamais réaffiché). */
  async function choosePassword() {
    if (!status) return;
    const password = String(passwordInput.value ?? '');
    if ([...password].length < 6) { render('Saisissez d\'abord le mot de passe dans le champ (6 caractères au moins), puis cliquez de nouveau.'); passwordInput.focus?.(); return; }
    const ok = await act('password', { password });
    if (ok) { passwordInput.value = ''; render('Mot de passe enregistré. Saisissez-le sur le téléphone.'); }
  }

  /** @returns {Promise<boolean>} vrai si le Mac a accepté */
  async function act(action, payload = {}) {
    busy = true;
    render(action === 'enable' ? 'Préparation du certificat et du partage...' : null);
    const result = await requestSyncAction(action, fetchFn, payload);
    if (result.status) status = result.status;
    busy = false;
    render(result.message ?? null);
    return !result.message;
  }

  render();
  if (!initial) fetchSyncStatus(fetchFn).then((s) => { status = s; render(); });
  return Object.assign(dialog, { passwordInput });
}
