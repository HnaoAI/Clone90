// Écran « Mes fichiers » (T27) : ajouter ses jeux et BIOS depuis le téléphone, voir et supprimer ce qui est gardé dans ce navigateur.
// Dépend de router.js, config.js, ui/dom.js, local-library.js (describeBiosStatus). Les actions (choisir, supprimer) sont transmises par app.js.
// INVARIANT : aucune liste de machines ici, tout vient de systems.json. Chaque bouton est `data-nav` (clavier et manette via js/input/).
import { buildHash } from '../router.js';
import { ROMS_DIR, BIOS_DIR } from '../config.js';
import { describeBiosStatus } from '../local-library.js';
import { el } from './dom.js';

/** data-nav-id du bouton retour et du bouton « Choisir des BIOS ». */
export const LIBRARY_BACK_NAV_ID = 'back';
export const ADD_BIOS_NAV_ID = 'add-bios';
/** data-nav-id du bouton d'ajout de jeux d'une machine. */
export const addGamesNavId = (systemId) => `add-${systemId}`;

/**
 * Taille lisible en français : « 880 o », « 12 Ko », « 1,4 Mo », « 2,1 Go ».
 * @param {number} bytes
 */
export function formatSize(bytes) {
  const n = Number.isFinite(bytes) && bytes > 0 ? bytes : 0;
  const units = [['Go', 1024 ** 3], ['Mo', 1024 ** 2], ['Ko', 1024]];
  for (const [unit, size] of units) {
    if (n >= size) {
      const value = n / size;
      return `${(value >= 10 ? Math.round(value) : Math.round(value * 10) / 10).toLocaleString('fr-FR')} ${unit}`;
    }
  }
  return `${n} o`;
}

/**
 * Fichiers de la bibliothèque regroupés pour l'affichage : une rubrique par machine (ordre de systems.json), puis les BIOS.
 * Un chemin d'une machine inconnue (retirée de systems.json) va dans « Autres fichiers », pour pouvoir le supprimer.
 * @param {{path: string, size: number}[]} entries @param {object[]} systems
 * @returns {{id: string, title: string, files: {path: string, name: string, size: number}[]}[]} rubriques non vides
 */
export function groupLibraryEntries(entries, systems) {
  const groups = [...systems.map((s) => ({ id: s.id, title: s.name, files: [] })), { id: 'bios', title: 'BIOS', files: [] }, { id: 'other', title: 'Autres fichiers', files: [] }];
  const byId = new Map(groups.map((g) => [g.id, g]));
  for (const e of [...entries].sort((a, b) => (a.path < b.path ? -1 : 1))) {
    const [dir, system] = e.path.split('/');
    const group = (dir === ROMS_DIR && byId.get(system) && system !== 'bios' && system !== 'other' ? byId.get(system) : null)
      ?? (dir === BIOS_DIR ? byId.get('bios') : byId.get('other'));
    group.files.push({ path: e.path, name: e.path.split('/').slice(dir === ROMS_DIR ? 2 : 1).join('/'), size: e.size });
  }
  return groups.filter((g) => g.files.length);
}

/**
 * Message après un import.
 * @param {{added: number, rejected?: number, unknownBios?: string[]}} result
 * @returns {string}
 */
export function describeImport({ added, rejected = 0, unknownBios = [] }) {
  const parts = [added === 0 ? 'Aucun fichier ajouté' : `${added} fichier${added > 1 ? 's' : ''} ajouté${added > 1 ? 's' : ''}`];
  if (rejected) parts.push(`${rejected} nom${rejected > 1 ? 's' : ''} illisible${rejected > 1 ? 's' : ''}`);
  if (unknownBios.length) parts.push(`nom de BIOS inattendu : ${unknownBios.join(', ')} (renommez-le avec le nom exact)`);
  return parts.join(' ; ');
}

const secondaryButton = (text, navId, onClick, doc, extraClass = '') => el('button', {
  class: `back-button${extraClass}`, text, attrs: { type: 'button' }, dataset: { nav: '', navId }, on: { click: onClick },
}, [], doc);

/**
 * Écran complet.
 * @param {{systems: object[], entries: {path: string, size: number}[], supported: boolean, machine?: string|null, busy?: boolean,
 *   onAddGames: (systemId: string) => void, onAddBios: () => void, onRemove: (path: string) => void}} model
 *   `machine` : machine mise en avant (arrivée depuis sa grille vide) ; `busy` : import en cours (boutons désactivés)
 * @param {Document} [doc]
 * @returns {HTMLElement}
 */
export function renderLibrary({ systems, entries, supported, machine = null, busy = false, onAddGames, onAddBios, onRemove }, doc = globalThis.document) {
  const groups = groupLibraryEntries(entries, systems);
  const total = entries.reduce((sum, e) => sum + (e.size || 0), 0);
  const bios = describeBiosStatus(systems, entries.map((e) => e.path));
  const disabled = !supported || busy;
  const withDisabled = (node) => { if (disabled) node.setAttribute('disabled', ''); return node; };
  const header = el('header', { class: 'grid-header' }, [
    el('a', { class: 'back-button', attrs: { href: buildHash({ name: 'home' }), 'aria-label': 'Retour aux machines' }, dataset: { nav: '', navId: LIBRARY_BACK_NAV_ID } }, [
      el('span', { text: '◀︎', attrs: { 'aria-hidden': 'true' } }, [], doc),
      el('span', { class: 'back-label', text: 'Machines' }, [], doc),
    ], doc),
    el('h2', { class: 'grid-title', text: 'Mes fichiers' }, [], doc),
  ], doc);
  const highlighted = systems.find((s) => s.id === machine);
  return el('section', { class: 'library' }, [
    header,
    el('p', { class: 'library-intro', text: 'Ajoutez vos jeux et vos BIOS depuis cet appareil (téléphone, tablette ou ordinateur). Ils restent dans ce navigateur : rien n\'est envoyé sur internet. Il faut internet seulement pour le moteur d\'émulation.' }, [], doc),
    !supported && el('div', { class: 'banner', attrs: { role: 'status' } }, [
      el('strong', { text: 'Ce navigateur ne peut pas garder de fichiers' }, [], doc),
      el('p', { text: 'Ouvrez le site en HTTPS dans Chrome ou Firefox, hors navigation privée.' }, [], doc),
    ], doc),
    busy && el('p', { class: 'banner', attrs: { role: 'status' }, text: 'Copie des fichiers en cours…' }, [], doc),
    el('h3', { class: 'library-heading', text: 'Ajouter des jeux' }, [], doc),
    el('p', { class: 'muted', text: highlighted
      ? `Formats acceptés pour ${highlighted.name} : ${(highlighted.extensions ?? []).map((e) => `.${e}`).join(' ')}. Touchez la machine, puis choisissez vos fichiers.`
      : 'Touchez la machine, puis choisissez vos fichiers de jeux (plusieurs à la fois si vous voulez).' }, [], doc),
    el('ul', { class: 'library-machines' }, systems.map((s) => el('li', {}, [
      withDisabled(secondaryButton(s.name, addGamesNavId(s.id), () => onAddGames(s.id), doc, s.id === machine ? ' is-selected' : '')),
    ], doc)), doc),
    el('h3', { class: 'library-heading', text: 'Ajouter des BIOS' }, [], doc),
    el('p', { class: 'muted', text: 'Certaines machines ont besoin d\'un BIOS, avec un nom de fichier exact.' }, [], doc),
    withDisabled(el('button', { class: 'button', text: 'Choisir des BIOS', attrs: { type: 'button' }, dataset: { nav: '', navId: ADD_BIOS_NAV_ID }, on: { click: () => onAddBios() } }, [], doc)),
    el('ul', { class: 'library-bios' }, bios.map((b) => el('li', { class: b.present ? 'is-present' : '' }, [
      `${b.systemName} : `, el('code', { text: b.file }, [], doc),
      ` - ${b.present ? 'présent' : b.required ? 'manquant (requis)' : 'absent (facultatif)'}`,
    ], doc)), doc),
    el('h3', { class: 'library-heading', text: `Sur cet appareil${entries.length ? ` (${formatSize(total)})` : ''}` }, [], doc),
    groups.length === 0 ? el('p', { class: 'muted', text: 'Aucun fichier pour l\'instant.' }, [], doc) : null,
    ...groups.map((g) => el('div', { class: 'library-group' }, [
      el('h4', { class: 'library-group-title', text: g.title }, [], doc),
      el('ul', { class: 'library-files' }, g.files.map((f) => el('li', { class: 'library-file' }, [
        el('span', { class: 'library-file-name', text: f.name }, [], doc),
        el('span', { class: 'library-file-size muted', text: formatSize(f.size) }, [], doc),
        withDisabled(secondaryButton('Supprimer', `del-${f.path}`, () => onRemove(f.path), doc)),
      ], doc)), doc),
    ], doc)),
  ], doc);
}

/**
 * Ouvre le sélecteur de fichiers du système (plusieurs fichiers, tous formats : Android filtre mal les extensions inconnues).
 * Doit être appelé pendant un geste de la personne (tap, clic). L'élément est ajouté au document le temps du choix (Safari l'exige).
 * @param {Document} [doc]
 * @returns {Promise<File[]>} résolue au choix ; jamais si la personne annule (rien à faire dans ce cas)
 */
export function pickFiles(doc = globalThis.document) {
  return new Promise((resolve) => {
    const input = el('input', { attrs: { type: 'file', multiple: '', hidden: '' } }, [], doc);
    input.addEventListener('change', () => { resolve([...(input.files ?? [])]); input.remove(); });
    doc.body.append(input);
    input.click();
  });
}
