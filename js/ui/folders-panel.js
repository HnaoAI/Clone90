// Panneau « Dossiers des jeux » de l'accueil (T25) : dossiers actuels, quatre choix et (T28) « Télécharger les pochettes ». Dépend de ui/dialog.js et ui/dom.js.
// Aucun appel réseau ici : `choose(kind)` et `covers` (js/folders-client.js) sont fournis par l'écran hôte. Textes en français.
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
const COVERS_INFO = 'Pochettes : Clone90 peut chercher les images manquantes dans la base libre libretro-thumbnails et les copier à côté de vos jeux, pour votre usage personnel. Elles restent sur ce Mac.';
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

/** Message d'un état renvoyé par GET api/covers. @returns {{text: string, tone: 'ok'|'info'|'error', finished: boolean}} */
export function describeCoversState(state) {
  if (state?.status === 'done') return { text: state.lines.join(' ; '), tone: state.found > 0 ? 'ok' : 'info', finished: true };
  if (state?.status === 'error') return { text: state.message || 'Le téléchargement des pochettes a échoué.', tone: 'error', finished: true };
  return { text: describeCoversProgress(state?.progress), tone: 'info', finished: false };
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
 * @param {() => void} options.onChanged appelée après un choix réussi ou des pochettes téléchargées (l'accueil recharge la liste des jeux)
 * @param {{start: () => Promise<{status: string, message?: string}>, status: () => Promise<object|null>}} [options.covers] API des pochettes ; sans elle, pas de bouton
 * @param {boolean} [options.coversRunning] un téléchargement était déjà en cours à l'ouverture : on reprend son suivi
 * @param {(ms: number) => Promise<void>} [options.wait] pause entre deux lectures de l'état (injectable)
 * @param {Document} [doc]
 * @returns {ReturnType<typeof createDialog>} `open(parent)`, `handleAction(action)`, `result` (résolu à la fermeture)
 */
export function createFoldersPanel({ settings, choose, onChanged, covers, coversRunning = false,
  wait = (ms) => new Promise((r) => { setTimeout(r, ms); }) }, doc = globalThis.document) {
  let busy = false;
  let closed = false;
  const coversIndex = covers ? FOLDER_CHOICES.length : -1;
  const list = el('ul', { class: 'folder-list' }, describeFolderLines(settings).map((l) => renderLine(l, doc)), doc);
  const status = el('p', { class: 'folders-status', attrs: { role: 'status', 'aria-live': 'polite' } }, [], doc);
  const dialog = createDialog({
    title: 'Dossiers des jeux',
    content: [el('p', { class: 'dialog-message', text: 'Clone90 cherche vos jeux et vos BIOS dans ces dossiers.' }, [], doc), list,
      covers && el('p', { class: 'dialog-message covers-info', text: COVERS_INFO }, [], doc), status].filter(Boolean),
    buttons: [...FOLDER_CHOICES.map((c) => ({ label: c.label })), ...(covers ? [{ label: COVERS_LABEL }] : []), { label: CLOSE_LABEL, secondary: true }],
    vertical: true,
    boxClass: 'is-wide',
    onPress: (index, { close }) => {
      if (index === dialog.buttons.length - 1) close(true);
      else if (busy) return;
      else if (index === coversIndex) runCovers();
      else run(FOLDER_CHOICES[index].kind);
    },
  }, doc);
  dialog.result.then(() => { closed = true; }); // fermé : on arrête de suivre le téléchargement (il continue côté serveur)

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

  /** Lance le téléchargement des pochettes puis suit son avancement jusqu'à la fin. */
  async function runCovers() {
    setBusy(true);
    show(describeCoversProgress());
    const started = await covers.start().catch(() => ({ status: 'error' }));
    if (started.status === 'started') await followCovers();
    else {
      show(started.message || 'Impossible de lancer le téléchargement des pochettes.', 'error');
      setBusy(false);
    }
  }

  async function followCovers() {
    setBusy(true);
    while (!closed) {
      const state = await covers.status().catch(() => null);
      if (closed) return;
      if (!state) { show('Impossible de joindre Clone90. Le serveur est-il toujours lancé ?', 'error'); break; }
      const { text, tone, finished } = describeCoversState(state.status === 'idle' ? { status: 'error', message: 'Le téléchargement des pochettes s\'est arrêté.' } : state);
      show(text, tone);
      if (finished) {
        if (state.status === 'done' && state.found > 0) onChanged();
        break;
      }
      await wait(COVERS_POLL_MS);
    }
    setBusy(false);
  }

  if (covers && coversRunning) followCovers();
  return dialog;
}
