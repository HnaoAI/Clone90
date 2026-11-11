// Version de l'application (T16) : SEULE source de vérité du numéro affiché (accueil, panneau de diagnostic) et du nom du cache du service worker.
// Aucune dépendance. Format : 0.<numéro du dernier ticket livré>.<n>, par exemple 0.16.0 puis 0.16.1 pour une correction du ticket 16.
// INVARIANT : à relever à CHAQUE livraison (voir README, « Numéro de version »). tests/version.test.mjs échoue si le numéro de ticket est en retard.
// Le service worker (sw.js, script classique) ne peut pas importer ce module : pwa.js l'enregistre sous `sw.js?v=<APP_VERSION>` et sw.js lit ce paramètre.

export const APP_VERSION = '0.20.1';
/** Date de la livraison, au format ISO (AAAA-MM-JJ). */
export const APP_DATE = '2026-11-11';

/**
 * Libellé affiché : « Clone90 v0.16.0 - 11/11/2026 » (date en JJ/MM/AAAA).
 * @param {string} [version] @param {string} [date] AAAA-MM-JJ ; une date mal formée est affichée telle quelle
 */
export function formatVersionLabel(version = APP_VERSION, date = APP_DATE) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const shown = match ? `${match[3]}/${match[2]}/${match[1]}` : date;
  return `Clone90 v${version} - ${shown}`;
}
