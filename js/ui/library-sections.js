// Rubriques repliables de l'écran « Mes fichiers » (T55, maquette « Swared » validée par Hicham le 2026-11-22) : une ligne (ou une tuile)
// par rubrique, qui ouvre son contenu juste dessous ; une seule rubrique ouverte à la fois. Logique pure (quelle rubrique ouvrir, résumés)
// et petit constructeur DOM. Dépend de ui/dom.js et des data-nav-id des autres modules (aucune liste de machines ici).
// INVARIANT : un bouton d'une rubrique fermée n'est jamais focalisable (panneau `hidden` : js/input/focus-nav.js l'ignore).
import { el } from './dom.js';

/** Rubriques repliables, dans l'ordre d'affichage. La liste « Sur cet appareil » n'en fait pas partie : elle reste visible. */
export const LIBRARY_SECTIONS = Object.freeze(['games', 'folder', 'sync', 'bios', 'covers', 'offline']);

/** data-nav-id du bouton d'une rubrique. @param {string} id */
export const sectionToggleNavId = (id) => `section-${id}`;

// data-nav-id écrits ici en clair et non importés : library-screen.js importe ce module (pas d'import circulaire). Vérifiés par
// tests/library-sections.test.mjs contre les constantes de library-screen.js et sync-section.js.
const NAV_TO_SECTION = new Map([
  ['links', 'games'], ['scan-folder', 'folder'], ['add-bios', 'bios'], ['find-covers', 'covers'], ['prepare-offline', 'offline'],
]);

/**
 * Rubrique qui contient un bouton, d'après son data-nav-id.
 * @param {string|null|undefined} navId
 * @returns {string|null} id de rubrique, ou null (retour, suppression d'un fichier, inconnu)
 */
export function sectionForNavId(navId) {
  if (typeof navId !== 'string' || navId === '') return null;
  if (navId.startsWith('section-') && LIBRARY_SECTIONS.includes(navId.slice(8))) return navId.slice(8);
  if (navId.startsWith('sync-')) return 'sync';
  if (navId.startsWith('add-') && navId !== 'add-bios') return 'games';
  return NAV_TO_SECTION.get(navId) ?? null;
}

/**
 * Rubrique ouverte au rendu (CA4) : celle du bouton qui reprend le focus après une action, sinon « Ajouter des jeux » en arrivant depuis la
 * grille vide d'une machine, sinon la dernière ouverte par la personne, sinon aucune.
 * @param {{focus?: string|null, machine?: string|null, lastOpen?: string|null}} state
 * @returns {string|null}
 */
export function initialOpenSection({ focus = null, machine = null, lastOpen = null } = {}) {
  return sectionForNavId(focus) ?? (machine ? 'games' : null) ?? (LIBRARY_SECTIONS.includes(lastOpen) ? lastOpen : null);
}

// Dernière rubrique ouverte ou fermée par la personne, gardée le temps de la page : app.js redessine l'écran après chaque action.
let lastOpen = null;
/** Oublie la dernière rubrique ouverte (tests). */
export const resetLibrarySections = () => { lastOpen = null; };
/** Dernière rubrique ouverte (null : tout fermé). */
export const lastOpenSection = () => lastOpen;

/** Résumé de la ligne « Synchroniser avec le Mac ». @param {{url: string, name?: string|null, token?: string|null}|null} pairing */
export function describeSyncSummary(pairing) {
  if (!pairing) return 'Pas encore associé';
  if (pairing.token === null) return 'Mot de passe à saisir de nouveau';
  return `Associé à ${pairing.name ? pairing.name.replace(/\.local$/, '') : pairing.url}`;
}

/** Résumé de la ligne « Ajouter des BIOS ». @param {{present: boolean}[]} bios résultat de describeBiosStatus */
export const describeBiosSummary = (bios) => (bios.length ? `${bios.filter((b) => b.present).length} BIOS sur ${bios.length}` : 'Aucun BIOS demandé');

/**
 * Construit les rubriques : pour chacune un bouton (tuile ou ligne) et son panneau. Les deux tuiles sont groupées en haut, leurs panneaux
 * juste sous la rangée de tuiles ; chaque ligne a son panneau juste sous elle.
 * @param {{id: string, title: string, label?: string, summary?: string|null, tile?: boolean, primary?: boolean, content: Array<Node|null|false>}[]} sections
 * @param {string|null} open rubrique ouverte au départ
 * @param {Document} [doc]
 * @param {boolean} [disabled] navigateur incompatible ou copie en cours : boutons des rubriques désactivés aussi (comme tous les boutons, T27)
 * @returns {HTMLElement[]}
 */
export function renderSections(sections, open, doc = globalThis.document, disabled = false) {
  const parts = sections.map((s) => {
    const panelId = `library-panel-${s.id}`;
    const button = el('button', {
      class: `library-toggle${s.tile ? ' is-tile' : ''}${s.primary ? ' is-primary' : ''}`,
      attrs: { type: 'button', 'aria-expanded': 'false', 'aria-controls': panelId },
      dataset: { nav: '', navId: sectionToggleNavId(s.id) },
    }, [
      el('span', { class: 'library-toggle-text' }, [
        s.label && el('small', { class: 'library-toggle-label', text: s.label }, [], doc),
        el('span', { class: 'library-toggle-title', text: s.title }, [], doc),
        s.summary && el('small', { class: 'library-toggle-summary', text: s.summary }, [], doc),
      ], doc),
      el('span', { class: 'library-toggle-arrow', attrs: { 'aria-hidden': 'true' } }, [], doc),
    ], doc);
    if (disabled) button.setAttribute('disabled', '');
    const panel = el('div', { class: 'library-panel', attrs: { id: panelId } }, s.content, doc);
    return { id: s.id, tile: Boolean(s.tile), button, panel };
  });
  let current = null;
  const setOpen = (id) => {
    current = id;
    for (const p of parts) { p.button.setAttribute('aria-expanded', String(p.id === id)); p.panel.hidden = p.id !== id; }
  };
  // Toucher la rubrique ouverte la referme ; en ouvrir une autre referme la précédente. Le choix est retenu pour les rendus suivants.
  for (const p of parts) p.button.addEventListener('click', () => { lastOpen = current === p.id ? null : p.id; setOpen(lastOpen); });
  setOpen(parts.some((p) => p.id === open) ? open : null);
  const tiles = parts.filter((p) => p.tile);
  const rows = parts.filter((p) => !p.tile);
  return [
    tiles.length > 0 && el('div', { class: 'library-tiles' }, tiles.map((p) => p.button), doc),
    ...tiles.map((p) => p.panel),
    ...rows.flatMap((p) => [p.button, p.panel]),
  ].filter(Boolean);
}
