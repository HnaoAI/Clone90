// Petit message temporaire ("Manette connectée", docs/ux.md 4.2). Dépend de rien ; horloge et conteneur injectables.

/**
 * Affiche `text` dans `host` (région `role="status"`) puis l'efface après `ms`. Un nouveau message remplace l'ancien.
 * @param {{textContent: string, classList: {add: Function, remove: Function}}} host
 * @param {string} text
 * @param {{ms?: number, setTimer?: Function, clearTimer?: Function}} [options]
 * @returns {(text: string) => void} fonction d'affichage
 */
export function createToast(host, { ms = 2000, setTimer = setTimeout, clearTimer = clearTimeout } = {}) {
  let timer = null;
  return (text) => {
    if (timer !== null) clearTimer(timer);
    host.textContent = text;
    host.classList.add('is-visible');
    timer = setTimer(() => { host.textContent = ''; host.classList.remove('is-visible'); timer = null; }, ms);
  };
}
