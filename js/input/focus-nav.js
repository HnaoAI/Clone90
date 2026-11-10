// Navigation spatiale du focus (T4) : les éléments `data-nav` forment une grille, une direction choisit le voisin visuel.
// Logique pure (groupRows, pickNext) séparée de l'enveloppe DOM (createFocusNavigator), testable sans navigateur.
// INVARIANT : le focus est un vrai focus DOM (element.focus()), jamais un état parallèle (docs/ux.md 4.1).
// Les écrans ne lisent jamais clavier ni manette : ils appellent handleAction avec les actions de input/actions.js.
// Convention : `data-nav` marque un élément navigable ; `data-nav-id` (optionnel) sert à retrouver une tuile (focus de retour).

const NAV_SELECTOR = '[data-nav]';

const centerX = (r) => (r.left + r.right) / 2;
const centerY = (r) => (r.top + r.bottom) / 2;

/**
 * Regroupe des rectangles en rangées visuelles (même rangée = centre vertical dans l'intervalle du 1er élément), de haut en bas ; dans chaque rangée de gauche à droite.
 * @param {{left: number, top: number, right: number, bottom: number}[]} rects
 * @returns {number[][]} rangées d'indices dans `rects`
 */
export function groupRows(rects) {
  const order = rects.map((_, i) => i).sort((a, b) => centerY(rects[a]) - centerY(rects[b]) || centerX(rects[a]) - centerX(rects[b]));
  const rows = [];
  let ref = null;
  for (const i of order) {
    const r = rects[i];
    if (ref && centerY(r) >= ref.top && centerY(r) <= ref.bottom) {
      rows[rows.length - 1].push(i);
    } else {
      rows.push([i]);
      ref = r;
    }
  }
  return rows.map((row) => row.sort((a, b) => centerX(rects[a]) - centerX(rects[b])));
}

/**
 * Élément voisin dans une direction (docs/ux.md 4.1) : gauche/droite = voisin de la rangée ; haut/bas = rangée
 * voisine, élément à la colonne la plus proche (donc le dernier si la rangée est plus courte). Pas de bouclage.
 * @param {{left: number, top: number, right: number, bottom: number}[]} rects
 * @param {number} current indice de l'élément courant
 * @param {string} direction 'up' | 'down' | 'left' | 'right'
 * @returns {number|null} indice du voisin, ou null s'il n'y en a pas (le focus reste)
 */
export function pickNext(rects, current, direction) {
  if (!(current >= 0 && current < rects.length)) return null;
  const rows = groupRows(rects);
  const rowIndex = rows.findIndex((row) => row.includes(current));
  const row = rows[rowIndex];
  if (direction === 'left' || direction === 'right') {
    return row[row.indexOf(current) + (direction === 'left' ? -1 : 1)] ?? null;
  }
  if (direction !== 'up' && direction !== 'down') return null;
  const target = rows[rowIndex + (direction === 'up' ? -1 : 1)];
  if (!target) return null;
  const x = centerX(rects[current]);
  let best = null;
  for (const i of target) {
    if (best === null || Math.abs(centerX(rects[i]) - x) < Math.abs(centerX(rects[best]) - x)) best = i;
  }
  return best;
}

const defaultReducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

/**
 * Navigateur de focus lié à une racine. Pour piéger le focus dans une boîte de dialogue, `getRoot` renvoie
 * le dialogue tant qu'il est ouvert.
 * @param {object} options
 * @param {() => ParentNode} options.getRoot racine courante des éléments `data-nav`
 * @param {Document} [options.doc]
 * @param {() => boolean} [options.reducedMotion] défilement sans animation si vrai
 */
export function createFocusNavigator({ getRoot, doc = globalThis.document, reducedMotion = defaultReducedMotion }) {
  const isUsable = (el) => {
    if (el.disabled || el.hidden || el.hasAttribute?.('disabled')) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const items = () => Array.from(getRoot().querySelectorAll(NAV_SELECTOR)).filter(isUsable);

  function focusElement(el) {
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest', behavior: reducedMotion() ? 'auto' : 'smooth' });
  }

  return {
    /** Vrai si un élément navigable a déjà le focus (le réveil de la manette n'avale alors pas le 1er appui, T11/A3). */
    hasFocus: () => items().includes(doc.activeElement),
    /** Focus sur le premier élément navigable. @returns {boolean} false s'il n'y en a aucun */
    focusFirst() {
      const [first] = items();
      if (first) focusElement(first);
      return !!first;
    },
    /** Focus sur l'élément dont data-nav-id vaut `id` (focus de retour). @returns {boolean} false si introuvable */
    focusById(id) {
      const el = items().find((e) => e.dataset?.navId === id);
      if (el) focusElement(el);
      return !!el;
    },
    /**
     * Traite une action. Directions : déplace le focus (ou le pose sur le premier élément si rien n'est focusé).
     * confirm : clique l'élément focusé. back et le reste : non géré, à l'écran de décider.
     * @param {string} action
     * @returns {boolean} true si l'action a été consommée
     */
    handleAction(action) {
      const list = items();
      const current = list.indexOf(doc.activeElement);
      if (action === 'confirm') {
        if (current < 0) return false;
        list[current].click();
        return true;
      }
      if (!['up', 'down', 'left', 'right'].includes(action)) return false;
      if (list.length === 0) return true;
      if (current < 0) { focusElement(list[0]); return true; }
      const next = pickNext(list.map((el) => el.getBoundingClientRect()), current, action);
      if (next !== null) focusElement(list[next]);
      return true;
    },
  };
}
