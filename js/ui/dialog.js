// Boîte de confirmation réutilisable (T6) : accueil, grille et player (T7, "Quitter ce jeu ?"). Dépend de ui/dom.js.
// INVARIANT : la boîte ne lit JAMAIS clavier ni manette (CLAUDE.md règle 3). L'écran hôte lui transmet les actions
// de js/input/actions.js via handleAction tant qu'elle est ouverte ; elle les capte toutes (retourne true).
// Design (T24) : barre de titre rayée (css/base.css), corps dans .dialog-body. Le curseur ▶ du bouton focalisé est du CSS.
// Choix UX (docs/ux.md 3.4) : 2 boutons [Continuer, Quitter], focus par défaut sur Continuer, back = Continuer.
import { el } from './dom.js';

const CANCEL_INDEX = 0;
const CONFIRM_INDEX = 1;
const BUTTON_COUNT = 2;

/**
 * Bouton visé après une direction : gauche/droite changent de bouton sans boucler, haut/bas ne bougent pas.
 * @param {number} index bouton courant
 * @param {string} action 'up' | 'down' | 'left' | 'right'
 * @param {number} count nombre de boutons
 */
export function nextButtonIndex(index, action, count) {
  if (action === 'left') return Math.max(0, index - 1);
  if (action === 'right') return Math.min(count - 1, index + 1);
  return index;
}

/**
 * Traduit une action abstraite en intention pour la boîte.
 * @param {string} action
 * @param {number} index bouton focusé
 * @param {number} count
 * @returns {{type: 'choose', index: number} | {type: 'cancel'} | {type: 'focus', index: number} | null}
 */
export function resolveDialogAction(action, index, count) {
  if (action === 'confirm') return { type: 'choose', index };
  if (action === 'back') return { type: 'cancel' };
  if (['up', 'down', 'left', 'right'].includes(action)) return { type: 'focus', index: nextButtonIndex(index, action, count) };
  return null;
}

/**
 * Crée une boîte de confirmation (role="dialog", aria-modal, focus piégé, focus rendu au déclencheur si Continuer).
 * @param {{title: string, message: string, cancelLabel: string, confirmLabel: string}} options
 * @param {Document} [doc]
 * @returns {{element: HTMLElement, result: Promise<boolean>, open: (parent: Node) => void, handleAction: (action: string) => boolean}}
 *   `result` vaut true si la personne confirme (Quitter), false si elle annule (Continuer, retour, clic hors de la boîte).
 */
export function createConfirmDialog({ title, message, cancelLabel, confirmLabel }, doc = globalThis.document) {
  let resolve;
  const result = new Promise((r) => { resolve = r; });
  let isOpen = false;
  let focusIndex = CANCEL_INDEX;
  let opener = null;

  const buttons = [cancelLabel, confirmLabel].map((label, i) => el('button', {
    class: `button dialog-button${i === CONFIRM_INDEX ? ' is-danger' : ''}`,
    text: label, attrs: { type: 'button' }, dataset: { nav: '' },
    on: { click: () => choose(i) },
  }, [], doc));
  const titleNode = el('h2', { class: 'dialog-title', text: title, attrs: { id: 'dialog-title' } }, [], doc);
  const element = el('div', {
    class: 'dialog-backdrop',
    attrs: { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'dialog-title' },
    on: { click: (e) => { if (e.target === element) close(false); } },
  }, [el('div', { class: 'dialog-box' }, [
    titleNode,
    el('div', { class: 'dialog-body' }, [
      el('p', { class: 'dialog-message', text: message }, [], doc),
      el('div', { class: 'dialog-actions' }, buttons, doc),
    ], doc),
  ], doc)], doc);

  const focusButton = (i) => { focusIndex = i; buttons[i].focus(); };
  // Piège à focus sans lire le clavier : si le focus sort des boutons, on le ramène.
  const trapFocus = (e) => { if (isOpen && !buttons.includes(e.target)) buttons[focusIndex].focus(); };

  function close(confirmed) {
    if (!isOpen) return;
    isOpen = false;
    doc.removeEventListener('focusin', trapFocus);
    element.remove();
    if (!confirmed) opener?.focus?.();
    resolve(confirmed);
  }
  function choose(i) { close(i === CONFIRM_INDEX); }

  return {
    element,
    result,
    open(parent) {
      opener = doc.activeElement;
      parent.append(element);
      isOpen = true;
      doc.addEventListener('focusin', trapFocus);
      focusButton(CANCEL_INDEX);
    },
    handleAction(action) {
      if (!isOpen) return false;
      const intent = resolveDialogAction(action, focusIndex, BUTTON_COUNT);
      if (intent?.type === 'choose') choose(intent.index);
      else if (intent?.type === 'cancel') close(false);
      else if (intent?.type === 'focus') focusButton(intent.index);
      return true;
    },
  };
}
