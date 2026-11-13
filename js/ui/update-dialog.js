// Fenêtre de mise à jour (T35) : prévient AVANT la mise à jour (règle de Hicham, 2026-11-13), compte à rebours de 5 s, puis lance la mise à jour
// toute seule ; « Plus tard » annule pour cette ouverture, « Mettre à jour maintenant » démarre sans attendre. Ensuite : avancement, puis rechargement.
// Dépend de ui/dialog.js et ui/dom.js. La source (Mac ou navigateur, js/update-check.js) est fournie par app.js.
// INVARIANT : comme toute boîte (dialog.js), elle ne lit ni clavier ni manette ; l'hôte lui transmet les actions (handleAction).
import { el } from './dom.js';
import { createDialog } from './dialog.js';

export const COUNTDOWN_SECONDS = 5;
export const NOW_LABEL = 'Mettre à jour maintenant';
export const LATER_LABEL = 'Plus tard';

/**
 * Texte principal de la fenêtre.
 * @param {{current: string, latest: string, canApply: boolean, message?: string}} update @param {'mac'|'browser'} kind
 */
export function describeUpdate(update, kind) {
  if (!update.canApply) return `Une nouvelle version de Clone90 existe (v${update.latest}, tu as la v${update.current}), mais Clone90 ne peut pas se mettre à jour tout seul. ${update.message ?? ''}`.trim();
  return kind === 'mac'
    ? `Mise à jour disponible : Clone90 v${update.latest} (tu as la v${update.current}). Clone90 va télécharger la nouvelle version puis redémarrer, en 30 secondes environ. Tes jeux, BIOS et réglages ne sont pas touchés.`
    : `Une nouvelle version de Clone90 arrive (v${update.latest}, tu as la v${update.current}). Tes jeux et BIOS de « Mes fichiers » ne sont pas touchés.`;
}

/** Texte du compte à rebours. @param {number} seconds @param {'mac'|'browser'} kind */
export function countdownText(seconds, kind) {
  const unit = `${seconds} seconde${seconds > 1 ? 's' : ''}`;
  return kind === 'mac' ? `La mise à jour commence dans ${unit}.` : `La page se recharge dans ${unit}.`;
}

/** Texte d'une étape de la mise à jour. @param {'updating'|'restarting'} step */
export const stepText = (step) => (step === 'restarting'
  ? 'Redémarrage de Clone90... La page va se recharger toute seule.'
  : 'Mise à jour en cours, ne ferme pas Clone90...');

/**
 * Ouvre la fenêtre et mène la mise à jour.
 * @param {object} options
 * @param {{current: string, latest: string, canApply: boolean, message?: string}} options.update résultat de source.check() (status 'available')
 * @param {{kind: 'mac'|'browser', apply: Function}} options.source
 * @param {Node} options.parent où ouvrir la fenêtre (document.body)
 * @param {() => void} [options.reload] recharge la page (location.reload) ; injectable
 * @param {(ms: number) => Promise<void>} [options.wait] pause d'une seconde du compte à rebours ; injectable
 * @param {Document} [doc]
 * @returns {{dialog: ReturnType<typeof createDialog>, done: Promise<'later'|'reloaded'|'error'|'closed'>}}
 */
export function openUpdateDialog({ update, source, parent, reload = () => globalThis.location.reload(), wait = (ms) => new Promise((r) => { setTimeout(r, ms); }) }, doc = globalThis.document) {
  let state = update.canApply ? 'countdown' : 'blocked';
  const message = el('p', { class: 'dialog-message', text: describeUpdate(update, source.kind), attrs: { id: 'update-message' } }, [], doc);
  const status = el('p', { class: 'folders-status update-status', attrs: { role: 'status', 'aria-live': 'polite' } }, [], doc);
  let start;
  const dialog = createDialog({
    title: update.canApply ? 'Mise à jour disponible' : 'Nouvelle version disponible',
    content: [message, status],
    buttons: update.canApply ? [{ label: NOW_LABEL }, { label: LATER_LABEL, secondary: true }] : [{ label: 'Fermer', secondary: true }],
    describedBy: 'update-message',
    cancelValue: 'later',
    onPress: (index, { close }) => {
      if (state === 'countdown' && index === 0) start();
      else if (state === 'countdown' || state === 'blocked' || state === 'error') close(state === 'error' ? 'error' : state === 'blocked' ? 'closed' : 'later');
    },
  }, doc);
  // Pendant la mise à jour, ni retour ni clic hors de la boîte ne ferment la fenêtre.
  dialog.element.addEventListener('click', (e) => { if (state === 'running') e.stopImmediatePropagation(); }, true);
  const baseHandle = dialog.handleAction;
  dialog.handleAction = (action) => (state === 'running' ? true : baseHandle(action));

  const done = new Promise((resolve) => {
    dialog.result.then((value) => { if (state !== 'running') { state = 'closed'; resolve(value); } });
    start = async () => {
      if (state !== 'countdown') return;
      state = 'running';
      for (const b of dialog.buttons) b.setAttribute('hidden', '');
      status.setAttribute('class', 'folders-status update-status is-info');
      status.textContent = stepText('updating');
      const result = await source.apply((step) => { status.textContent = stepText(step); });
      if (result.status === 'ready') { resolve('reloaded'); reload(); return; }
      state = 'error';
      status.setAttribute('class', 'folders-status update-status is-error');
      status.textContent = result.message;
      const last = dialog.buttons.at(-1);
      last.textContent = 'Fermer';
      last.removeAttribute('hidden');
      last.focus();
    };
  });

  dialog.open(parent);
  if (state === 'countdown') {
    (async () => {
      for (let s = COUNTDOWN_SECONDS; s > 0; s--) {
        if (state !== 'countdown') return;
        status.textContent = countdownText(s, source.kind);
        await wait(1000);
      }
      if (state === 'countdown') start();
    })();
  }
  return { dialog, done };
}
