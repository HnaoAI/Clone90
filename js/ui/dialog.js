// Boîtes de dialogue réutilisables (T6, généralisées en T25) : confirmation (grille, player) et panneau des dossiers de l'accueil.
// Dépend de ui/dom.js. `createDialog` est la boîte générique (titre, contenu, boutons) ; `createConfirmDialog` en est un cas (2 boutons).
// INVARIANT : la boîte ne lit JAMAIS clavier ni manette (CLAUDE.md règle 3). L'écran hôte lui transmet les actions
// de js/input/actions.js via handleAction tant qu'elle est ouverte ; elle les capte toutes (retourne true).
// Design (T24) : barre de titre rayée (css/base.css), corps dans .dialog-body. Le curseur ▶ du bouton focalisé est du CSS.
// Choix UX (docs/ux.md 3.4) : confirmation à 2 boutons [Continuer, Quitter], focus par défaut sur Continuer, back = Continuer.
import { el } from './dom.js';

const CANCEL_INDEX = 0;
const CONFIRM_INDEX = 1;

/**
 * Bouton visé après une direction. Rangée de boutons : gauche/droite changent de bouton, haut/bas ne bougent pas.
 * Colonne (`vertical`) : l'inverse. Jamais de bouclage.
 * @param {number} index bouton courant
 * @param {string} action 'up' | 'down' | 'left' | 'right'
 * @param {number} count nombre de boutons
 * @param {boolean} [vertical] boutons empilés
 */
export function nextButtonIndex(index, action, count, vertical = false) {
  const [before, after] = vertical ? ['up', 'down'] : ['left', 'right'];
  if (action === before) return Math.max(0, index - 1);
  if (action === after) return Math.min(count - 1, index + 1);
  return index;
}

/**
 * Traduit une action abstraite en intention pour la boîte.
 * @param {string} action
 * @param {number} index bouton focusé
 * @param {number} count
 * @param {boolean} [vertical] boutons empilés
 * @returns {{type: 'choose', index: number} | {type: 'cancel'} | {type: 'focus', index: number} | null}
 */
export function resolveDialogAction(action, index, count, vertical = false) {
  if (action === 'confirm') return { type: 'choose', index };
  if (action === 'back') return { type: 'cancel' };
  if (['up', 'down', 'left', 'right'].includes(action)) return { type: 'focus', index: nextButtonIndex(index, action, count, vertical) };
  return null;
}

/**
 * Crée une boîte générique (role="dialog", aria-modal, focus piégé).
 * @param {object} options
 * @param {string} options.title
 * @param {Node[]} [options.content] noeuds du corps, au-dessus des boutons
 * @param {{label: string, danger?: boolean, secondary?: boolean}[]} options.buttons
 * @param {number} [options.defaultIndex] bouton focalisé à l'ouverture
 * @param {boolean} [options.vertical] boutons empilés (haut/bas pour naviguer)
 * @param {string} [options.boxClass] classe ajoutée à la boîte (ex. `is-wide`)
 * @param {(index: number, api: {close: (value: unknown) => void}) => void} options.onPress appui sur un bouton (clic, tap, confirm)
 * @param {unknown} [options.cancelValue] valeur du résultat sur retour ou clic hors de la boîte (false par défaut)
 * @param {(value: unknown) => boolean} [options.restoreFocusWhen] rend le focus au déclencheur selon la valeur (toujours par défaut)
 * @param {Document} [doc]
 * @returns {{element: HTMLElement, result: Promise<unknown>, open: (parent: Node) => void, close: (value: unknown) => void, handleAction: (action: string) => boolean, buttons: HTMLElement[]}}
 */
export function createDialog({ title, content = [], buttons, defaultIndex = 0, vertical = false, boxClass = '', onPress, cancelValue = false,
  restoreFocusWhen = () => true }, doc = globalThis.document) {
  let resolve;
  const result = new Promise((r) => { resolve = r; });
  let isOpen = false;
  let focusIndex = defaultIndex;
  let opener = null;

  const buttonNodes = buttons.map((b, i) => el('button', {
    class: `button dialog-button${b.danger ? ' is-danger' : ''}${b.secondary ? ' is-secondary' : ''}`,
    text: b.label, attrs: { type: 'button' }, dataset: { nav: '' },
    on: { click: () => onPress(i, { close }) },
  }, [], doc));
  const element = el('div', {
    class: 'dialog-backdrop',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dialog-title' },
    on: { click: (e) => { if (e.target === element) close(cancelValue); } },
  }, [el('div', { class: `dialog-box${boxClass ? ` ${boxClass}` : ''}` }, [
    el('h2', { class: 'dialog-title', text: title, attrs: { id: 'dialog-title' } }, [], doc),
    el('div', { class: 'dialog-body' }, [
      ...content,
      el('div', { class: `dialog-actions${vertical ? ' is-vertical' : ''}` }, buttonNodes, doc),
    ], doc),
  ], doc)], doc);

  const focusButton = (i) => { focusIndex = i; buttonNodes[i].focus(); };
  // Piège à focus sans lire le clavier : si le focus sort des boutons, on le ramène.
  const trapFocus = (e) => { if (isOpen && !buttonNodes.includes(e.target)) buttonNodes[focusIndex].focus(); };

  function close(value) {
    if (!isOpen) return;
    isOpen = false;
    doc.removeEventListener('focusin', trapFocus);
    element.remove();
    if (restoreFocusWhen(value)) opener?.focus?.();
    resolve(value);
  }

  return {
    element,
    result,
    close,
    buttons: buttonNodes,
    open(parent) {
      opener = doc.activeElement;
      parent.append(element);
      isOpen = true;
      doc.addEventListener('focusin', trapFocus);
      focusButton(defaultIndex);
    },
    handleAction(action) {
      if (!isOpen) return false;
      const intent = resolveDialogAction(action, focusIndex, buttons.length, vertical);
      if (intent?.type === 'choose') onPress(intent.index, { close });
      else if (intent?.type === 'cancel') close(cancelValue);
      else if (intent?.type === 'focus') focusButton(intent.index);
      return true;
    },
  };
}

/**
 * Boîte de confirmation à deux boutons [annuler, confirmer], focus sur annuler.
 * @param {{title: string, message: string, cancelLabel: string, confirmLabel: string}} options
 * @param {Document} [doc]
 * @returns {ReturnType<typeof createDialog>} `result` vaut true si la personne confirme (Quitter), false si elle annule (Continuer, retour, clic hors de la boîte).
 */
export function createConfirmDialog({ title, message, cancelLabel, confirmLabel }, doc = globalThis.document) {
  return createDialog({
    title,
    content: [el('p', { class: 'dialog-message', text: message }, [], doc)],
    buttons: [{ label: cancelLabel }, { label: confirmLabel, danger: true }],
    defaultIndex: CANCEL_INDEX,
    onPress: (index, { close }) => close(index === CONFIRM_INDEX),
    restoreFocusWhen: (confirmed) => !confirmed,
  }, doc);
}
