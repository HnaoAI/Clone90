// Panneau « Dossiers des jeux » de l'accueil (T25) : dossiers actuels, quatre choix, « Télécharger les pochettes » (T28) et « Télécharger les logos des machines » (T29).
// Dépend de ui/dialog.js et ui/dom.js. Aucun appel réseau ici : `choose(kind)`, `covers` et `logos` (js/folders-client.js) sont fournis par l'écran hôte. Textes en français.
// Pochettes et logos suivent le même mécanisme (lancement, suivi par lecture de l'état, résumé) : une seule implémentation, paramétrée par `DOWNLOADS`.
// INVARIANT : comme toute boîte (dialog.js), le panneau ne lit jamais clavier ni manette ; l'hôte lui transmet les actions.
import { el, clear } from './dom.js';
import { createDialog } from './dialog.js';

/** Choix proposés, dans l'ordre d'affichage. `kind` est le type envoyé à l'API. */
export const FOLDER_CHOICES = [
  { kind: 'roms', label: 'Choisir le dossier des ROMs' },
  { kind: 'bios', label: 'Choisir le dossier des BIOS' },
  { kind: 'roms-default', label: 'Utiliser les ROMs du projet' },
  { kind: 'bios-default', label: 'Utiliser les BIOS du projet' },
];
export const COVERS_LABEL = 'Télécharger les pochettes';
// Texte validé par le PO : dit clairement quand Clone90 se connecte, à qui, et ce que GitHub voit (adresse IP et noms des images demandées, qui reprennent les titres des jeux).
export const COVERS_INFO = 'Pochettes : Clone90 se connecte à Internet (github.com, base libre libretro-thumbnails) uniquement quand vous cliquez sur ce bouton. '
  + 'GitHub voit votre adresse IP et les noms des jeux cherchés (les images demandées portent leurs titres) ; rien d\'autre n\'est envoyé. '
  + 'Les images sont copiées à côté de vos jeux, pour votre usage personnel, et ne sont jamais publiées.';
export const LOGOS_LABEL = 'Télécharger les logos des machines';
export const LOGOS_INFO = 'Logos : même principe (github.com, thème libre es-theme-carbon), uniquement quand vous cliquez sur ce bouton. '
  + 'GitHub voit votre adresse IP, aucun nom de jeu n\'est envoyé. Les logos restent dans votre dossier des ROMs et ne sont jamais publiés.';
const COVERS_POLL_MS = 1000;
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

/** Texte d'avancement du téléchargement des pochettes. @param {{phase?: string, system?: string, done?: number, total?: number}} [progress] */
export function describeCoversProgress(progress) {
  if (progress?.phase === 'listing' && progress.system) return `Lecture de la liste des pochettes (${progress.system})...`;
  if (progress?.phase === 'downloading' && progress.total > 0) return `Téléchargement des pochettes : ${progress.done} sur ${progress.total}...`;
  return 'Recherche des pochettes en cours...';
}

/**
 * Clé d'annonce d'un avancement : le lecteur d'écran n'est prévenu qu'à chaque changement de clé (changement de phase ou de machine, puis tous les 10 %).
 * @returns {string}
 */
export function coversAnnounceKey(progress) {
  if (progress?.phase === 'downloading' && progress.total > 0) return `d:${Math.floor((progress.done * 10) / progress.total)}`;
  return `l:${progress?.system ?? ''}`;
}

/** Texte d'avancement du téléchargement des logos (T29). */
export function describeLogosProgress(progress) {
  return progress?.total > 0 ? `Téléchargement des logos : ${progress.done} sur ${progress.total}...` : 'Téléchargement des logos en cours...';
}

/** Message d'un état d'un téléchargement (fin, erreur ou avancement). */
function describeJobState(state, describeProgress, failedText) {
  if (state?.status === 'done') return { text: state.lines.join('\n'), tone: state.found > 0 ? 'ok' : 'info', finished: true };
  if (state?.status === 'error') return { text: state.message || failedText, tone: 'error', finished: true };
  return { text: describeProgress(state?.progress), tone: 'info', finished: false };
}
/** Message d'un état renvoyé par GET api/covers. @returns {{text: string, tone: 'ok'|'info'|'error', finished: boolean}} */
export const describeCoversState = (state) => describeJobState(state, describeCoversProgress, 'Le téléchargement des pochettes a échoué.');
/** Message d'un état renvoyé par GET api/logos (T29). @returns {{text: string, tone: 'ok'|'info'|'error', finished: boolean}} */
export const describeLogosState = (state) => describeJobState(state, describeLogosProgress, 'Le téléchargement des logos a échoué.');

/** Les téléchargements du panneau, dans l'ordre des boutons. `api` et `running` sont les noms des options de createFoldersPanel. */
const DOWNLOADS = [
  { api: 'covers', running: 'coversRunning', done: 'onCoversDone', label: COVERS_LABEL, info: COVERS_INFO, infoId: 'folders-covers-info',
    describeState: describeCoversState, describeProgress: describeCoversProgress, stopped: 'Le téléchargement des pochettes s\'est arrêté.', cannotStart: 'Impossible de lancer le téléchargement des pochettes.' },
  { api: 'logos', running: 'logosRunning', done: 'onLogosDone', label: LOGOS_LABEL, info: LOGOS_INFO, infoId: 'folders-logos-info',
    describeState: describeLogosState, describeProgress: describeLogosProgress, stopped: 'Le téléchargement des logos s\'est arrêté.', cannotStart: 'Impossible de lancer le téléchargement des logos.' },
];

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
 * @param {() => void} options.onChanged appelée après un choix de dossier réussi (l'accueil recharge la liste des jeux)
 * @param {(state: object) => void} [options.onCoversDone] appelée à la fin d'un téléchargement de pochettes (terminé ou en erreur), MÊME panneau fermé ;
 *   l'hôte recharge l'accueil et prévient par un message. Plusieurs panneaux peuvent suivre le même travail : l'hôte distingue les travaux par `state.id`
 * @param {{start: () => Promise<{status: string, message?: string}>, status: () => Promise<object|null>}} [options.covers] API des pochettes ; sans elle, pas de bouton
 * @param {boolean} [options.coversRunning] un téléchargement était déjà en cours à l'ouverture : on reprend son suivi
 * @param {{start: Function, status: Function}} [options.logos] API des logos des machines (T29), même forme que `covers` ; sans elle, pas de bouton
 * @param {boolean} [options.logosRunning] @param {(state: object) => void} [options.onLogosDone] comme pour les pochettes
 * @param {(ms: number) => Promise<void>} [options.wait] pause entre deux lectures de l'état (injectable)
 * @param {Document} [doc]
 * @returns {ReturnType<typeof createDialog>} `open(parent)`, `handleAction(action)`, `result` (résolu à la fermeture)
 */
export function createFoldersPanel(options, doc = globalThis.document) {
  const { settings, choose, onChanged, wait = (ms) => new Promise((r) => { setTimeout(r, ms); }) } = options;
  let busy = false;
  const downloads = DOWNLOADS.filter((d) => options[d.api]).map((d) => ({ ...d, client: options[d.api], onDone: options[d.done] ?? (() => {}) }));
  const list = el('ul', { class: 'folder-list' }, describeFolderLines(settings).map((l) => renderLine(l, doc)), doc);
  const status = el('p', { class: 'folders-status', attrs: { role: 'status', 'aria-live': 'polite' } }, [], doc);
  // Barre visuelle HORS de la zone annoncée (aria-hidden) : elle bouge à chaque lecture, la zone `status` seulement aux changements de clé.
  const bar = el('progress', { class: 'covers-progress', attrs: { max: '100', 'aria-hidden': 'true', hidden: '' } }, [], doc);
  let announcedKey = null;
  const dialog = createDialog({
    title: 'Dossiers des jeux',
    content: [el('p', { class: 'dialog-message', text: 'Clone90 cherche vos jeux et vos BIOS dans ces dossiers.', attrs: { id: 'folders-intro' } }, [], doc), list,
      ...downloads.map((d) => el('p', { class: 'dialog-message covers-info', text: d.info, attrs: { id: d.infoId } }, [], doc)), bar, status],
    buttons: [...FOLDER_CHOICES.map((c) => ({ label: c.label })), ...downloads.map((d, i) => ({ label: d.label, separated: i === 0 })), { label: CLOSE_LABEL, secondary: true }],
    vertical: true,
    boxClass: 'is-wide',
    describedBy: ['folders-intro', ...downloads.map((d) => d.infoId)].join(' '),
    onPress: (index, { close }) => {
      if (index === dialog.buttons.length - 1) close(true);
      else if (busy) return;
      else if (index >= FOLDER_CHOICES.length) runDownload(downloads[index - FOLDER_CHOICES.length]);
      else run(FOLDER_CHOICES[index].kind);
    },
  }, doc);

  const show = (text, tone = 'info') => {
    status.textContent = text;
    status.setAttribute('class', `folders-status is-${tone}`);
  };
  const setBusy = (value) => {
    busy = value;
    for (const b of dialog.buttons.slice(0, -1)) b.setAttribute('aria-disabled', String(value));
  };

  async function run(kind) {
    setBusy(true);
    show(kind.endsWith('-default') ? SAVING_TEXT : PENDING_TEXT);
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

  /** Affiche l'avancement : barre à chaque lecture, annonce (zone status) seulement quand la clé change. */
  function showProgress(download, progress) {
    const total = progress?.total > 0 && progress.phase === 'downloading';
    bar.removeAttribute('hidden');
    if (total) bar.setAttribute('value', String(Math.round((progress.done * 100) / progress.total)));
    else bar.removeAttribute('value');
    const key = coversAnnounceKey(progress);
    if (key !== announcedKey) { announcedKey = key; show(download.describeProgress(progress)); }
  }

  /** Lance un téléchargement (pochettes ou logos) puis suit son avancement jusqu'à la fin. */
  async function runDownload(download) {
    setBusy(true);
    announcedKey = null;
    showProgress(download);
    const started = await download.client.start().catch(() => ({ status: 'error' }));
    if (started.status === 'started') await follow(download);
    else {
      bar.setAttribute('hidden', '');
      show(started.message || download.cannotStart, 'error');
      setBusy(false);
    }
  }

  /** Suit le travail jusqu'à sa fin, panneau fermé ou non : l'hôte est prévenu à la fin (onCoversDone, onLogosDone). */
  async function follow(download) {
    setBusy(true);
    for (;;) {
      const state = await download.client.status().catch(() => null);
      if (!state) { show('Impossible de joindre Clone90. Le serveur est-il toujours lancé ?', 'error'); break; }
      const effective = state.status === 'idle' ? { status: 'error', message: download.stopped } : state;
      const { text, tone, finished } = download.describeState(effective);
      if (finished) {
        show(text, tone);
        download.onDone(effective);
        break;
      }
      showProgress(download, state.progress);
      await wait(COVERS_POLL_MS);
    }
    bar.setAttribute('hidden', '');
    setBusy(false);
  }

  const resumed = downloads.find((d) => options[d.running]);
  if (resumed) follow(resumed);
  return dialog;
}
