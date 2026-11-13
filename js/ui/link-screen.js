// Écran « Télécharger depuis une page » (#/telecharger, T34) : adresse de la page, analyse, liste des fichiers reconnus à cocher avec leur machine,
// téléchargement et résumé. Dépend de router.js, ui/dom.js. La source (Mac ou navigateur, js/link-download.js) est fournie par app.js.
// INVARIANT (règle 3) : l'écran ne lit ni clavier ni manette ; boutons et champs sont `data-nav`. Les cases sont des boutons (aria-pressed) et non des
//   <input type=checkbox> : la couche d'entrée laisse les flèches aux champs de saisie, une case native piégerait le focus.
// INVARIANT (règle 2) : les machines proposées viennent de systems.json (candidats calculés par link-finder.js).
import { buildHash } from '../router.js';
import { el, clear } from './dom.js';
import { describeEmptyScan, describeScanProgress } from '../link-explorer.js';

export const LINK_BACK_NAV_ID = 'back';
export const LINK_INPUT_NAV_ID = 'link-url';
export const LINK_SCAN_NAV_ID = 'link-scan';
export const LINK_DOWNLOAD_NAV_ID = 'link-download';
export const LINK_DEPTH_NAV_ID = 'link-depth';
export const LINK_STOP_NAV_ID = 'link-stop';
/** Profondeurs proposées (T36) ; 1 par défaut : la page et les pages qu'elle relie. */
export const DEPTH_CHOICES = [
  { value: '0', label: 'Cette page seulement' },
  { value: '1', label: 'Et les pages reliées' },
  { value: '2', label: 'Et 2 niveaux de pages' },
];
export const DEFAULT_DEPTH = '1';
export const WARNING_TEXT = 'Télécharge uniquement des fichiers dont tu as le droit de disposer.';
const CHOOSE_LABEL = 'Choisir la machine';

/** Texte de confidentialité selon la source. @param {'mac'|'browser'} kind */
export function describePrivacy(kind) {
  return kind === 'mac'
    ? 'Clone90 se connecte à cette adresse seulement quand tu touches « Analyser » ou « Télécharger » : le site voit l\'adresse IP de ce Mac, rien d\'autre n\'est envoyé. Les fichiers vont dans tes dossiers de jeux et de BIOS.'
    : 'Ce navigateur se connecte à cette adresse seulement quand tu touches « Analyser » ou « Télécharger ». Les fichiers restent dans ce navigateur (« Mes fichiers »). '
      + 'Beaucoup de sites refusent d\'être lus depuis un navigateur : dans ce cas, fais-le depuis Clone90 sur le Mac.';
}

/**
 * Choix de machine d'un fichier : un BIOS n'a qu'un choix ; un jeu propose ses machines candidates, précédées de « Choisir » si rien n'est deviné.
 * @param {{kind: string, target: string|null, candidates: string[]}} file @param {object[]} systems
 * @returns {{value: string, label: string}[]}
 */
export function machineOptions(file, systems) {
  if (file.kind === 'bios') return [{ value: 'bios', label: 'BIOS' }];
  const options = file.candidates.map((id) => ({ value: id, label: systems.find((s) => s.id === id)?.name ?? id }));
  return file.target ? options : [{ value: '', label: CHOOSE_LABEL }, ...options];
}

/**
 * État initial des choix : coché seulement si la machine est connue (devinée ou BIOS).
 * @returns {{checked: boolean, target: string}[]}
 */
export const initialChoices = (files) => files.map((f) => ({ checked: Boolean(f.target), target: f.target ?? '' }));

/**
 * Fichiers à télécharger : cochés, avec une machine choisie.
 * @returns {{url: string, target: string}[]}
 */
export const selectedItems = (files, choices) => files.flatMap((f, i) => (choices[i]?.checked && choices[i].target
  ? [{ url: f.url, target: choices[i].target, ...(f.named && { name: f.name }) }] : [])); // T36 : nom lu à l'analyse pour un lien sans nom

/** Nombre de fichiers cochés sans machine choisie (le bouton les signale). */
export const missingMachines = (choices) => choices.filter((c) => c.checked && !c.target).length;

/** Libellé du bouton de téléchargement. */
export const downloadLabel = (count) => (count ? `Télécharger la sélection (${count})` : 'Télécharger la sélection');

/** Titre de la liste. */
export function describeFound(count, truncated) {
  if (!count) return 'Aucun fichier de jeu ou de BIOS reconnu sur cette page.';
  return `${count} fichier${count > 1 ? 's' : ''} trouvé${count > 1 ? 's' : ''}${truncated ? ' (liste limitée aux premiers)' : ''}`;
}

/**
 * Message de fin d'analyse (T36). @param {{files: object[], stopped?: boolean, stats?: {pages: number, links: number}}} result
 * @returns {{text: string, tone: 'info'|'error'}}
 */
export function describeScanResult(result) {
  const n = result.files.length;
  if (!n) return { text: result.stats ? describeEmptyScan(result.stats) : describeFound(0), tone: 'error' };
  const pages = result.stats?.pages > 1 ? ` sur ${result.stats.pages} pages` : '';
  return { text: `${result.stopped ? 'Analyse arrêtée. ' : ''}${describeFound(n, result.truncated)}${pages}. Coche les fichiers à télécharger et vérifie leur machine.`, tone: 'info' };
}

/** Page d'origine affichée sous un fichier : chemin de l'adresse, sans le protocole. */
export function describeSourcePage(page) {
  try { const u = new URL(page); return `${u.host}${decodeURI(u.pathname)}${u.search}`; } catch { return ''; }
}

/** Texte d'avancement. */
export function describeLinksProgress(progress) {
  return progress?.total > 0 ? `Téléchargement : ${Math.min(progress.done + 1, progress.total)} sur ${progress.total}${progress.name ? ` (${progress.name})` : ''}...` : 'Téléchargement en cours...';
}

/**
 * Crée l'écran.
 * @param {object} options
 * @param {object[]} options.systems machines de systems.json
 * @param {{kind: 'mac'|'browser', scan: Function, download: Function}|null} options.source null : impossible ici (message seulement)
 * @param {(state: {found: number}) => void} [options.onFinished] après un téléchargement réussi (l'application recharge la liste des jeux)
 * @param {(id: string) => void} [options.focus] redonne le focus à un élément par son data-nav-id (focus-nav)
 * @param {Document} [doc]
 * @returns {HTMLElement}
 */
export function createLinkScreen({ systems, source, onFinished = () => {}, focus = () => {} }, doc = globalThis.document) {
  let files = [];
  let choices = [];
  let busy = false;
  const input = el('input', {
    class: 'link-input',
    attrs: { id: 'link-url', type: 'url', inputmode: 'url', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'https://', 'aria-describedby': 'link-warning' },
    dataset: { nav: '', navId: LINK_INPUT_NAV_ID },
  }, [], doc);
  const scanButton = el('button', { class: 'button', text: 'Analyser', attrs: { type: 'submit' }, dataset: { nav: '', navId: LINK_SCAN_NAV_ID } }, [], doc);
  const depthSelect = el('select', { class: 'link-depth', attrs: { id: 'link-depth' }, dataset: { nav: '', navId: LINK_DEPTH_NAV_ID } },
    DEPTH_CHOICES.map((d) => el('option', { text: d.label, attrs: { value: d.value, ...(d.value === DEFAULT_DEPTH && { selected: '' }) } }, [], doc)), doc);
  let scanStop = null;
  const stopButton = el('button', { class: 'back-button link-stop', text: 'Arrêter', attrs: { type: 'button', hidden: '' }, dataset: { nav: '', navId: LINK_STOP_NAV_ID },
    on: { click: () => scanStop?.abort() } }, [], doc);
  const status = el('p', { class: 'folders-status link-status', attrs: { role: 'status', 'aria-live': 'polite' } }, [], doc);
  const bar = el('progress', { class: 'covers-progress', attrs: { max: '100', 'aria-hidden': 'true', hidden: '' } }, [], doc);
  const results = el('div', { class: 'link-results' }, [], doc);

  const show = (text, tone = 'info') => { status.textContent = text; status.setAttribute('class', `folders-status link-status is-${tone}`); };
  const setBusy = (value) => {
    busy = value;
    for (const node of [scanButton, depthSelect, ...results.querySelectorAll('button, select')]) {
      if (value) node.setAttribute('disabled', ''); else node.removeAttribute('disabled');
    }
    if (value) input.setAttribute('readonly', ''); else input.removeAttribute('readonly');
  };

  function renderResults(truncated) {
    clear(results);
    if (!files.length) return;
    const download = el('button', { class: 'button', text: downloadLabel(selectedItems(files, choices).length), attrs: { type: 'button' },
      dataset: { nav: '', navId: LINK_DOWNLOAD_NAV_ID }, on: { click: runDownload } }, [], doc);
    const refresh = () => { download.textContent = downloadLabel(selectedItems(files, choices).length); };
    const toggles = [];
    const setAll = (checked) => { choices.forEach((c, i) => { c.checked = checked; toggles[i].setAttribute('aria-pressed', String(checked)); }); refresh(); };
    const rows = files.map((f, i) => {
      const toggle = el('button', { class: 'link-toggle', text: f.name, attrs: { type: 'button', 'aria-pressed': String(choices[i].checked), title: f.url },
        dataset: { nav: '', navId: `link-file-${i}` }, on: { click: () => { choices[i].checked = !choices[i].checked; toggle.setAttribute('aria-pressed', String(choices[i].checked)); refresh(); } } }, [], doc);
      toggles.push(toggle);
      const select = el('select', { class: 'link-machine', attrs: { 'aria-label': `Machine pour ${f.name}` }, dataset: { nav: '', navId: `link-machine-${i}` },
        on: { change: () => { choices[i].target = select.value; if (select.value) { choices[i].checked = true; toggle.setAttribute('aria-pressed', 'true'); } refresh(); } } },
      machineOptions(f, systems).map((o) => el('option', { text: o.label, attrs: { value: o.value, ...(o.value === choices[i].target && { selected: '' }) } }, [], doc)), doc);
      const label = el('div', { class: 'link-file-label' }, [toggle,
        f.page && el('span', { class: 'link-file-page muted', text: describeSourcePage(f.page) }, [], doc)], doc);
      return el('li', { class: 'library-file link-file' }, [label, select], doc);
    });
    results.append(
      el('h3', { class: 'library-heading', text: describeFound(files.length, truncated) }, [], doc),
      el('div', { class: 'link-bulk' }, [
        el('button', { class: 'back-button', text: 'Tout cocher', attrs: { type: 'button' }, dataset: { nav: '', navId: 'link-all' }, on: { click: () => setAll(true) } }, [], doc),
        el('button', { class: 'back-button', text: 'Tout décocher', attrs: { type: 'button' }, dataset: { nav: '', navId: 'link-none' }, on: { click: () => setAll(false) } }, [], doc),
      ], doc),
      el('ul', { class: 'library-files link-files' }, rows, doc),
      download,
    );
  }

  async function runScan(event) {
    event?.preventDefault?.();
    if (busy || !source) return;
    files = [];
    choices = [];
    renderResults(false);
    setBusy(true);
    show('Analyse de la page...');
    scanStop = new AbortController();
    stopButton.removeAttribute('hidden');
    focus(LINK_STOP_NAV_ID);
    const result = await source.scan(input.value, { depth: Number(depthSelect.value), signal: scanStop.signal, onProgress: (p) => { status.textContent = describeScanProgress(p); } });
    stopButton.setAttribute('hidden', '');
    scanStop = null;
    setBusy(false);
    if (result.status !== 'ok') { show(result.message, 'error'); focus(LINK_INPUT_NAV_ID); return; }
    files = result.files;
    choices = initialChoices(files);
    renderResults(result.truncated);
    const summary = describeScanResult(result);
    show(summary.text, summary.tone);
    focus(files.length ? 'link-file-0' : LINK_INPUT_NAV_ID);
  }

  async function runDownload() {
    if (busy) return;
    const items = selectedItems(files, choices);
    const missing = missingMachines(choices);
    if (!items.length) { show(missing ? 'Choisis la machine des fichiers cochés.' : 'Coche au moins un fichier.', 'error'); return; }
    setBusy(true);
    bar.removeAttribute('hidden');
    bar.removeAttribute('value');
    show(describeLinksProgress());
    const result = await source.download(items, (p) => {
      if (p?.total > 0) bar.setAttribute('value', String(Math.round((p.done * 100) / p.total)));
      status.textContent = describeLinksProgress(p);
    });
    bar.setAttribute('hidden', '');
    setBusy(false);
    if (result.status === 'done') {
      show(`${missing ? `${missing} fichier(s) sans machine ignoré(s).\n` : ''}${result.lines.join('\n')}`, result.found > 0 ? 'ok' : 'info');
      if (result.found > 0) onFinished(result);
    } else show(result.message, 'error');
    focus(LINK_DOWNLOAD_NAV_ID);
  }

  const header = el('header', { class: 'grid-header' }, [
    el('a', { class: 'back-button', attrs: { href: buildHash({ name: 'home' }), 'aria-label': 'Retour aux machines' }, dataset: { nav: '', navId: LINK_BACK_NAV_ID } }, [
      el('span', { text: '◀︎', attrs: { 'aria-hidden': 'true' } }, [], doc),
      el('span', { class: 'back-label', text: 'Machines' }, [], doc),
    ], doc),
    el('h2', { class: 'grid-title', text: 'Depuis une page web' }, [], doc),
  ], doc);
  return el('section', { class: 'library link-screen' }, [
    header,
    el('p', { class: 'library-intro', text: 'Donne l\'adresse d\'une page qui propose des jeux ou des BIOS. Clone90 liste les fichiers qu\'il sait lancer, et tu choisis lesquels télécharger.' }, [], doc),
    el('div', { class: 'banner link-warning', attrs: { id: 'link-warning' } }, [
      el('strong', { text: WARNING_TEXT }, [], doc),
      el('p', { text: source ? describePrivacy(source.kind) : 'Ce navigateur ne peut pas garder de fichiers : ouvre Clone90 sur le Mac, ou ce site en HTTPS dans Chrome ou Firefox.' }, [], doc),
    ], doc),
    source && el('form', { class: 'link-form', attrs: { novalidate: '' }, on: { submit: runScan } }, [
      el('label', { class: 'link-label', text: 'Adresse de la page', attrs: { for: 'link-url' } }, [], doc),
      el('div', { class: 'link-row' }, [input, scanButton], doc),
      el('div', { class: 'link-row link-depth-row' }, [
        el('label', { class: 'link-label', text: 'Chercher aussi', attrs: { for: 'link-depth' } }, [], doc), depthSelect, stopButton,
      ], doc),
    ], doc),
    bar,
    status,
    results,
  ], doc);
}
