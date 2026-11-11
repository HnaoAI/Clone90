// Panneau de diagnostic de player.html (T16) : affiche la fiche (version, machine, jeu, disquettes) et le journal de diagnostic-log.js.
// Dépend de ui/dom.js et diagnostic-log.js. Ne connaît pas EmulatorJS : l'état des disquettes arrive par `getSnapshot` (injecté par player-main.js).
// INVARIANT : sans `debug=1` dans l'adresse, mountDiagnostic ne crée rien. Aucune donnée n'est envoyée : « Copier » écrit dans le presse-papiers local.
// INVARIANT : le panneau ne vole jamais le focus du jeu (mousedown annulé, boutons hors tabulation) et ne recouvre pas le bouton Menu (haut gauche) :
// replié, c'est une pastille en haut à droite ; ouvert, il commence sous le bouton Menu (css/player.css).
import { el } from '../ui/dom.js';
import { isDebugRequested, createDiagnosticLog, formatClock, snapshotText } from './diagnostic-log.js';

const REFRESH_DELAY_MS = 250;

/**
 * Copie `text` dans le presse-papiers (API moderne, sinon zone de texte temporaire + execCommand pour http hors localhost).
 * @param {string} text @param {{nav?: Navigator, doc?: Document}} [env] @returns {Promise<boolean>} vrai si la copie a réussi
 */
export async function copyText(text, { nav = globalThis.navigator, doc = globalThis.document } = {}) {
  try {
    if (nav?.clipboard?.writeText) { await nav.clipboard.writeText(text); return true; }
  } catch { /* repli ci-dessous */ }
  try {
    const area = doc.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.opacity = '0';
    doc.body.append(area);
    area.select();
    const done = doc.execCommand?.('copy') === true;
    area.remove();
    return done;
  } catch { return false; }
}

/**
 * Construit le panneau.
 * @param {{log: ReturnType<typeof createDiagnosticLog>, getSnapshot: () => object, copy?: (text: string) => Promise<boolean>, notify?: (text: string) => void,
 *   doc?: Document, setTimer?: Function, clearTimer?: Function}} options
 * @returns {{element: HTMLElement, refresh: () => void, isOpen: () => boolean, toggle: () => void, destroy: () => void}}
 */
export function createDiagnosticPanel({ log, getSnapshot, copy = copyText, notify = () => {}, doc = globalThis.document, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let open = false;
  let timer = null;
  const summary = el('pre', { class: 'diag-summary' }, [], doc);
  const events = el('pre', { class: 'diag-events' }, [], doc);
  const core = el('pre', { class: 'diag-core' }, [], doc);
  const keepGameFocus = (e) => e.preventDefault();
  const copyButton = el('button', {
    class: 'diag-button', text: 'Copier le journal', attrs: { type: 'button', tabindex: '-1' },
    on: { click: async () => notify((await copy(log.toText(getSnapshot()))) ? 'Journal copié' : 'Copie impossible : sélectionnez le texte du journal') },
  }, [], doc);
  const toggleButton = el('button', { class: 'diag-toggle', attrs: { type: 'button', tabindex: '-1', 'aria-expanded': 'false' }, on: { click: () => toggle() } }, [], doc);
  const body = el('div', { class: 'diag-body', attrs: { hidden: '' } }, [
    summary, el('h3', { class: 'diag-title', text: 'Évènements' }, [], doc), events,
    el('h3', { class: 'diag-title', text: 'Dernières lignes du cœur' }, [], doc), core, copyButton,
  ], doc);
  const element = el('aside', { class: 'diag', attrs: { 'aria-label': 'Diagnostic', 'data-diag': '' }, on: { mousedown: keepGameFocus, pointerdown: keepGameFocus } }, [toggleButton, body], doc);

  function refresh() {
    timer = null;
    const snap = getSnapshot();
    toggleButton.textContent = open ? 'Diagnostic : replier' : `Diag v${snap.version}`;
    if (!open) return;
    summary.textContent = snapshotText(snap);
    const lines = log.events();
    events.textContent = lines.length ? lines.map((e) => `${formatClock(e.time)} ${e.text}`).join('\n') : '(aucun)';
    const coreLines = log.coreLines();
    core.textContent = coreLines.length ? coreLines.join('\n') : '(aucune)';
  }

  function toggle() {
    open = !open;
    toggleButton.setAttribute('aria-expanded', String(open));
    if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
    element.setAttribute('class', open ? 'diag is-open' : 'diag');
    refresh();
  }

  const unsubscribe = log.onChange(() => { if (open && timer === null) timer = setTimer(refresh, REFRESH_DELAY_MS); });
  refresh();
  return {
    element, refresh, toggle, isOpen: () => open,
    destroy() { unsubscribe(); if (timer !== null) clearTimer(timer); element.remove?.(); },
  };
}

/**
 * Active le diagnostic si l'adresse contient `debug=1`, sinon ne fait rien.
 * @param {{search: string, host: {append: Function}, getSnapshot: () => object, notify?: (text: string) => void, doc?: Document, log?: object, copy?: Function}} options
 * @returns {{log: ReturnType<typeof createDiagnosticLog>, panel: ReturnType<typeof createDiagnosticPanel>}|null} null sans debug=1
 */
export function mountDiagnostic({ search, host, getSnapshot, notify, doc, log = createDiagnosticLog(), copy }) {
  if (!isDebugRequested(search)) return null;
  const panel = createDiagnosticPanel({ log, getSnapshot, notify, doc, ...(copy ? { copy } : {}) });
  host.append(panel.element);
  return { log, panel };
}
