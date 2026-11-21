// Rubrique « Synchroniser avec le Mac » de l'écran « Mes fichiers » (T43, téléphone) : association (T51 : mot de passe seulement, le Mac est
// trouvé sur le Wi-Fi ; adresse facultative en secours ; guide « Première fois » pour installer le certificat du Mac), puis
// « Synchroniser maintenant », « Envoyer mes jeux au Mac » (T44) et « Oublier ce Mac ». Les actions sont fournies par app.js (js/sync-client.js) ;
// aucun réseau ici. Dépend de ui/dom.js. INVARIANT : chaque champ et bouton est `data-nav` (clavier et manette via js/input/).
import { el } from './dom.js';
import { createPasswordToggle } from './password-toggle.js';

/** data-nav-id des éléments de la rubrique. */
export const SYNC_NAV = Object.freeze({ password: 'sync-password', showPassword: 'sync-show-password', address: 'sync-address', pair: 'sync-pair', now: 'sync-now', send: 'sync-send', forget: 'sync-forget' });
/** T44 : ce que fait « Envoyer mes jeux au Mac ». */
export const SEND_INFO = '« Envoyer mes jeux au Mac » copie sur le Mac les jeux et pochettes ajoutés sur ce téléphone qu\'il n\'a pas encore (pas les BIOS). '
  + 'Ensuite, ils suivent le Mac : supprimés sur le Mac, ils sont retirés de ce téléphone.';
/** Ce que fait la synchronisation, dit avant l'association. */
export const SYNC_SECTION_INFO = 'Copiez sur ce téléphone les jeux, pochettes, logos et BIOS de votre Mac, par le Wi-Fi. Saisissez le mot de passe choisi sur le Mac '
  + '(« Dossiers », « Partager avec le téléphone ») : ce téléphone trouve le Mac tout seul. Ensuite, Clone90 se met à jour tout seul à chaque ouverture '
  + 'quand le Mac est allumé avec Clone90 ouvert. Rien ne quitte votre réseau.';
/** T51 : guide d'installation du certificat du Mac (une seule fois par téléphone), affiché avant l'association. */
export const CERT_GUIDE = [
  'Sur le Mac, ouvrez « Dossiers », « Partager avec le téléphone » : notez l\'adresse affichée (par exemple https://192.168.1.20:8443).',
  'Sur ce téléphone, ouvrez cette adresse dans Chrome. Si Chrome affiche « Votre connexion n\'est pas privée », touchez « Paramètres avancés », puis « Continuer ».',
  'Touchez « Télécharger le certificat ».',
  'Ouvrez les Paramètres d\'Android, cherchez « certificat », choisissez « Certificat CA », touchez « Installer quand même », puis choisissez clone90-ca.crt.',
  'Vérifiez : rouvrez l\'adresse du Mac dans Chrome ; sans avertissement, c\'est bon. Revenez ici et saisissez le mot de passe.',
];

/** Date lisible de la dernière synchronisation. @param {number|null} time @returns {string} */
export function describeLastSync(time) {
  if (!Number.isFinite(time)) return 'Pas encore synchronisé.';
  const d = new Date(time);
  return `Dernière synchronisation : ${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`;
}

/** Nom lisible du Mac : `macbook-pro-de-hicham.local` -> `macbook-pro-de-hicham`, sinon l'adresse. */
const macLabel = (pairing) => (pairing.name ? pairing.name.replace(/\.local$/, '') : pairing.url);

/**
 * Rubrique complète.
 * @param {{pairing: {url: string, name?: string|null, token?: string|null, lastSync: number|null}|null, disabled?: boolean, message?: string|null,
 *   onPair: (password: string, address: string) => void, onSyncNow: () => void, onSend?: () => void, onForget: () => void}} model
 *   `onSend` (T44) : « Envoyer mes jeux au Mac » ; `pairing.token` null (T51) : le Mac a refusé le jeton, le mot de passe est redemandé
 * @param {Document} [doc]
 * @returns {HTMLElement[]}
 */
export function renderSyncSection({ pairing, disabled = false, message = null, onPair, onSyncNow, onSend = () => {}, onForget }, doc = globalThis.document) {
  const note = message ? [el('p', { class: 'library-notice', attrs: { role: 'status' }, text: message }, [], doc)] : [];
  const off = (node) => { if (disabled) node.setAttribute('disabled', ''); return node; };
  const heading = el('h3', { class: 'library-heading', text: 'Synchroniser avec le Mac' }, [], doc);
  if (pairing && pairing.token !== null) {
    return [heading,
      el('p', { class: 'muted' }, ['Associé au Mac ', el('code', { text: macLabel(pairing) }, [], doc), `. ${describeLastSync(pairing.lastSync)}`], doc),
      el('div', { class: 'link-row' }, [
        off(el('button', { class: 'button', text: 'Synchroniser maintenant', attrs: { type: 'button' }, dataset: { nav: '', navId: SYNC_NAV.now }, on: { click: () => onSyncNow() } }, [], doc)),
        off(el('button', { class: 'button', text: 'Envoyer mes jeux au Mac', attrs: { type: 'button' }, dataset: { nav: '', navId: SYNC_NAV.send }, on: { click: () => onSend() } }, [], doc)),
        off(el('button', { class: 'back-button', text: 'Oublier ce Mac', attrs: { type: 'button' }, dataset: { nav: '', navId: SYNC_NAV.forget }, on: { click: () => onForget() } }, [], doc)),
      ], doc), el('p', { class: 'muted', text: SEND_INFO }, [], doc), ...note];
  }
  const field = (id, navId, label, attrs) => [
    el('label', { class: 'link-label', text: label, attrs: { for: id } }, [], doc),
    off(el('input', { class: 'link-input', attrs: { id, autocapitalize: 'off', spellcheck: 'false', ...attrs }, dataset: { nav: '', navId } }, [], doc)),
  ];
  const [passwordLabel, password] = field('sync-password', SYNC_NAV.password, 'Mot de passe du Mac', { type: 'password', autocomplete: 'current-password', maxlength: '128' });
  const [addressLabel, address] = field('sync-address', SYNC_NAV.address, 'Adresse du Mac (facultatif, seulement s\'il n\'est pas trouvé)',
    { type: 'text', inputmode: 'url', autocomplete: 'off', placeholder: '192.168.1.20' });
  const form = el('form', { class: 'link-form', on: { submit: (e) => { e.preventDefault(); onPair(password.value, address.value); } } }, [
    passwordLabel, el('div', { class: 'link-row' }, [password,
      createPasswordToggle(password, { navId: SYNC_NAV.showPassword, controls: 'sync-password', disabled }, doc),
      off(el('button', { class: 'button', text: 'Associer', attrs: { type: 'submit' }, dataset: { nav: '', navId: SYNC_NAV.pair } }, [], doc))], doc),
    addressLabel, el('div', { class: 'link-row' }, [address], doc),
  ], doc);
  const guide = [
    el('h4', { class: 'library-heading', text: 'Première fois : installer le certificat du Mac' }, [], doc),
    el('ol', { class: 'muted sync-guide' }, CERT_GUIDE.map((step) => el('li', { text: step }, [], doc)), doc),
  ];
  return [heading, el('p', { class: 'muted', text: SYNC_SECTION_INFO }, [], doc), form, ...note, ...guide];
}
