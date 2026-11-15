// Rubrique « Synchroniser avec le Mac » de l'écran « Mes fichiers » (T43, téléphone) : association (adresse du Mac + code à 6 chiffres),
// puis « Synchroniser maintenant », « Envoyer mes jeux au Mac » (T44) et « Oublier ce Mac ». Les actions sont fournies par app.js (js/sync-client.js) ; aucun réseau ici.
// Dépend de ui/dom.js. INVARIANT : chaque champ et bouton est `data-nav` (clavier et manette via js/input/).
import { el } from './dom.js';

/** data-nav-id des éléments de la rubrique. */
export const SYNC_NAV = Object.freeze({ address: 'sync-address', code: 'sync-code', pair: 'sync-pair', now: 'sync-now', send: 'sync-send', forget: 'sync-forget' });
/** T44 : ce que fait « Envoyer mes jeux au Mac ». */
export const SEND_INFO = '« Envoyer mes jeux au Mac » copie sur le Mac les jeux ajoutés sur ce téléphone qu\'il n\'a pas encore (pas les BIOS ni les pochettes). '
  + 'Ensuite, ils suivent le Mac : supprimés sur le Mac, ils sont retirés de ce téléphone.';
/** Ce que fait la synchronisation, dit avant l'association. */
export const SYNC_SECTION_INFO = 'Copiez sur ce téléphone les jeux, pochettes, logos et BIOS de votre Mac, par le Wi-Fi. Sur le Mac : « Dossiers », '
  + '« Partager avec le téléphone », puis « Associer un téléphone ». Il faut installer une fois le certificat du Mac sur ce téléphone. '
  + 'Ensuite, Clone90 se met à jour tout seul à chaque ouverture quand le Mac est allumé avec Clone90 ouvert. Rien ne quitte votre réseau.';

/** Date lisible de la dernière synchronisation. @param {number|null} time @returns {string} */
export function describeLastSync(time) {
  if (!Number.isFinite(time)) return 'Pas encore synchronisé.';
  const d = new Date(time);
  return `Dernière synchronisation : ${d.toLocaleDateString('fr-FR')} à ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}.`;
}

/**
 * Rubrique complète.
 * @param {{pairing: {url: string, lastSync: number|null}|null, disabled?: boolean, message?: string|null, onPair: (address: string, code: string) => void,
 *   onSyncNow: () => void, onSend?: () => void, onForget: () => void}} model  `onSend` (T44) : « Envoyer mes jeux au Mac »
 * @param {Document} [doc]
 * @returns {HTMLElement[]}
 */
export function renderSyncSection({ pairing, disabled = false, message = null, onPair, onSyncNow, onSend = () => {}, onForget }, doc = globalThis.document) {
  const note = message ? [el('p', { class: 'library-notice', attrs: { role: 'status' }, text: message }, [], doc)] : [];
  const off = (node) => { if (disabled) node.setAttribute('disabled', ''); return node; };
  const heading = el('h3', { class: 'library-heading', text: 'Synchroniser avec le Mac' }, [], doc);
  if (pairing) {
    return [heading,
      el('p', { class: 'muted' }, ['Associé au Mac ', el('code', { text: pairing.url }, [], doc), `. ${describeLastSync(pairing.lastSync)}`], doc),
      el('div', { class: 'link-row' }, [
        off(el('button', { class: 'button', text: 'Synchroniser maintenant', attrs: { type: 'button' }, dataset: { nav: '', navId: SYNC_NAV.now }, on: { click: () => onSyncNow() } }, [], doc)),
        off(el('button', { class: 'button', text: 'Envoyer mes jeux au Mac', attrs: { type: 'button' }, dataset: { nav: '', navId: SYNC_NAV.send }, on: { click: () => onSend() } }, [], doc)),
        off(el('button', { class: 'back-button', text: 'Oublier ce Mac', attrs: { type: 'button' }, dataset: { nav: '', navId: SYNC_NAV.forget }, on: { click: () => onForget() } }, [], doc)),
      ], doc), el('p', { class: 'muted', text: SEND_INFO }, [], doc), ...note];
  }
  const field = (id, navId, label, attrs) => [
    el('label', { class: 'link-label', text: label, attrs: { for: id } }, [], doc),
    off(el('input', { class: 'link-input', attrs: { id, autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', ...attrs }, dataset: { nav: '', navId } }, [], doc)),
  ];
  const [addressLabel, address] = field('sync-address', SYNC_NAV.address, 'Adresse du Mac', { type: 'text', inputmode: 'url', placeholder: '192.168.1.20' });
  const [codeLabel, code] = field('sync-code', SYNC_NAV.code, 'Code affiché sur le Mac', { type: 'text', inputmode: 'numeric', maxlength: '6', placeholder: '123456' });
  const form = el('form', { class: 'link-form', on: { submit: (e) => { e.preventDefault(); onPair(address.value, code.value); } } }, [
    addressLabel, el('div', { class: 'link-row' }, [address], doc),
    codeLabel, el('div', { class: 'link-row' }, [code,
      off(el('button', { class: 'button', text: 'Associer', attrs: { type: 'submit' }, dataset: { nav: '', navId: SYNC_NAV.pair } }, [], doc))], doc),
  ], doc);
  return [heading, el('p', { class: 'muted', text: SYNC_SECTION_INFO }, [], doc), form, ...note];
}
