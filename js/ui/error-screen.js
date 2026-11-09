// Écran d'erreur bloquante (T5) : systems.json illisible (docs/ux.md : toujours une action possible). Dépend de ui/dom.js.
import { el } from './dom.js';

/**
 * @param {string} message détail technique (ex. "systems.json : HTTP 404")
 * @param {Document} [doc]
 * @returns {HTMLElement} bloc avec un bouton "Réessayer" navigable (`data-nav`)
 */
export function renderFatalError(message, doc = globalThis.document) {
  return el('section', { class: 'message-screen', attrs: { role: 'alert' } }, [
    el('h2', { class: 'screen-title', text: 'Impossible de charger les machines' }, [], doc),
    el('p', { text: message }, [], doc),
    el('p', { class: 'muted', text: 'Ouvrez le site avec le serveur local : node scripts/serve.mjs, puis http://localhost:8080 (index.html ouvert directement ne fonctionne pas).' }, [], doc),
    el('button', { class: 'button', text: 'Réessayer', attrs: { type: 'button' }, dataset: { nav: '' }, on: { click: () => globalThis.location.reload() } }, [], doc),
  ], doc);
}
