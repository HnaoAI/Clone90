// Panneau « Dossiers des jeux » de l'accueil (T25) : dossiers actuels et trois choix. Dépend de ui/dialog.js et ui/dom.js.
// Aucun appel réseau ici : `choose(kind)` (js/folders-client.js) est fourni par l'écran hôte. Textes en français.
// INVARIANT : comme toute boîte (dialog.js), le panneau ne lit jamais clavier ni manette ; l'hôte lui transmet les actions.
import { el, clear } from './dom.js';
import { createDialog } from './dialog.js';

/** Choix proposés, dans l'ordre d'affichage. `kind` est le type envoyé à l'API. */
export const FOLDER_CHOICES = [
  { kind: 'roms', label: 'Choisir le dossier des ROMs' },
  { kind: 'bios', label: 'Choisir le dossier des BIOS' },
  { kind: 'bios-default', label: 'BIOS du projet' },
];
export const PENDING_TEXT = 'Une fenêtre de choix s\'est ouverte sur votre Mac.';
const SAVING_TEXT = 'Enregistrement en cours...';
const CLOSE_LABEL = 'Fermer';

/** Lignes d'affichage des dossiers utilisés. @returns {{label: string, path: string, note: string}[]} */
export function describeFolderLines(settings) {
  return [
    { label: 'ROMs', path: settings.romsDir, note: settings.romsIsDefault ? 'dossier du projet' : 'dossier choisi' },
    { label: 'BIOS', path: settings.biosDir, note: settings.biosIsDefault ? 'dossier du projet' : 'dossier choisi' },
  ];
}

/** Message affiché après un choix. @returns {{text: string, tone: 'ok'|'info'|'error'}} */
export function describeChoiceResult(result) {
  switch (result?.status) {
    case 'ok': return { text: 'Dossiers enregistrés. La liste des jeux est mise à jour.', tone: 'ok' };
    case 'cancelled': return { text: 'Aucun changement.', tone: 'info' };
    case 'busy': return { text: result.message || 'Une fenêtre de choix est déjà ouverte sur votre Mac.', tone: 'error' };
    case 'refused':
    case 'error': return { text: result.message || 'Le choix du dossier a échoué.', tone: 'error' };
    default: return { text: 'Réponse inattendue de Clone90.', tone: 'error' };
  }
}

const renderLine = (line, doc) => el('li', { class: 'folder-line' }, [
  el('strong', { text: `${line.label} : ` }, [], doc),
  el('code', { text: line.path }, [], doc),
  el('span', { class: 'folder-note', text: ` (${line.note})` }, [], doc),
], doc);

/**
 * Crée le panneau (boîte modale, boutons en colonne).
 * @param {object} options
 * @param {{romsDir: string, biosDir: string, romsIsDefault: boolean, biosIsDefault: boolean}} options.settings dossiers actuels
 * @param {(kind: string) => Promise<{status: string, message?: string, settings?: object}>} options.choose demande un choix à l'API
 * @param {() => void} options.onChanged appelée après un choix réussi (l'accueil recharge la liste des jeux)
 * @param {Document} [doc]
 * @returns {ReturnType<typeof createDialog>} `open(parent)`, `handleAction(action)`, `result` (résolu à la fermeture)
 */
export function createFoldersPanel({ settings, choose, onChanged }, doc = globalThis.document) {
  let busy = false;
  const list = el('ul', { class: 'folder-list' }, describeFolderLines(settings).map((l) => renderLine(l, doc)), doc);
  const status = el('p', { class: 'folders-status', attrs: { role: 'status', 'aria-live': 'polite' } }, [], doc);
  const dialog = createDialog({
    title: 'Dossiers des jeux',
    content: [el('p', { class: 'dialog-message', text: 'Clone90 cherche vos jeux et vos BIOS dans ces dossiers.' }, [], doc), list, status],
    buttons: [...FOLDER_CHOICES.map((c) => ({ label: c.label })), { label: CLOSE_LABEL, secondary: true }],
    vertical: true,
    boxClass: 'is-wide',
    onPress: (index, { close }) => {
      if (index === FOLDER_CHOICES.length) close(true);
      else if (!busy) run(FOLDER_CHOICES[index].kind);
    },
  }, doc);

  const show = (text, tone = 'info') => {
    status.textContent = text;
    status.setAttribute('class', `folders-status is-${tone}`);
  };
  const setBusy = (value) => {
    busy = value;
    for (const b of dialog.buttons.slice(0, FOLDER_CHOICES.length)) b.setAttribute('aria-disabled', String(value));
  };

  async function run(kind) {
    setBusy(true);
    show(kind === 'bios-default' ? SAVING_TEXT : PENDING_TEXT);
    let result;
    try { result = await choose(kind); } catch (err) {
      console.error('Choix du dossier impossible :', err);
      result = { status: 'error' };
    }
    if (result?.settings) {
      clear(list);
      list.append(...describeFolderLines(result.settings).map((l) => renderLine(l, doc)));
    }
    const { text, tone } = describeChoiceResult(result);
    show(text, tone);
    setBusy(false);
    if (result?.status === 'ok') onChanged();
  }

  return dialog;
}
