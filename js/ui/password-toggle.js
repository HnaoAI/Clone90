// T52 : bouton « œil » pour afficher ou masquer un mot de passe (demandé par Hicham le 2026-11-21 : « oui je le veux »), sur le téléphone
// (« Mes fichiers », association au Mac, ui/sync-section.js) et sur le Mac (« Partager avec le téléphone », ui/sync-panel.js).
// Dépend de ui/dom.js. INVARIANT : masqué par défaut ; le mot de passe n'est lu ni gardé ici (seul le type du champ change).
import { el } from './dom.js';

/** Textes du bouton (lus aussi par les lecteurs d'écran, `aria-label`). */
export const PASSWORD_TOGGLE_LABELS = Object.freeze({ show: 'Afficher le mot de passe', hide: 'Masquer le mot de passe' });

/**
 * Bouton qui bascule `input` entre `password` (masqué) et `text` (affiché). `aria-pressed` dit si le mot de passe est affiché.
 * @param {HTMLInputElement} input champ de type password
 * @param {{navId?: string, controls?: string, disabled?: boolean}} [options] `navId` : data-nav-id (clavier et manette, téléphone) ;
 *   `controls` : id du champ (aria-controls)
 * @param {Document} [doc] @returns {HTMLButtonElement}
 */
export function createPasswordToggle(input, { navId, controls, disabled = false } = {}, doc = globalThis.document) {
  let shown = false;
  const button = el('button', { class: 'back-button password-toggle', text: '👁', attrs: { type: 'button', 'aria-label': PASSWORD_TOGGLE_LABELS.show,
    title: PASSWORD_TOGGLE_LABELS.show, 'aria-pressed': 'false', ...(controls && { 'aria-controls': controls }) },
  ...(navId && { dataset: { nav: '', navId } }), on: { click: () => {
    shown = !shown;
    const label = shown ? PASSWORD_TOGGLE_LABELS.hide : PASSWORD_TOGGLE_LABELS.show;
    input.setAttribute('type', shown ? 'text' : 'password');
    button.setAttribute('aria-pressed', String(shown));
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
  } } }, [], doc);
  if (disabled) button.setAttribute('disabled', '');
  return button;
}
