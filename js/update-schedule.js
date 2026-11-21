// Quand vérifier les mises à jour (T35, puis T47) : à l'ouverture, puis à nouveau au retour sur l'onglet si la dernière vérification a plus de 5 h.
// Pur, sans dépendance : app.js fournit l'heure, le stockage de l'onglet (sessionStorage) et l'état de la page.
// T47 (Hicham, 2026-11-21, « plutôt sur 5 h ») : un onglet resté ouvert plusieurs jours ne revérifiait jamais (Mac resté en v0.37 du 13 au 21/11).

/** Délai entre deux vérifications du même onglet : 5 heures (décision de Hicham, 2026-11-21). */
export const UPDATE_RECHECK_MS = 5 * 60 * 60 * 1000;
/** Clé sessionStorage : heure (ms depuis 1970) de la dernière vérification de cet onglet. Ancienne valeur T35 « 1 » : lue comme très ancienne. */
export const UPDATE_CHECKED_KEY = 'clone90-update-checked';

/**
 * Lit l'heure de la dernière vérification de l'onglet.
 * @param {{getItem: (k: string) => string|null}|null|undefined} storage sessionStorage (peut lever ou manquer)
 * @returns {number|null} null si jamais vérifié, illisible ou stockage refusé
 */
export function readLastCheck(storage) {
  try {
    const raw = storage?.getItem(UPDATE_CHECKED_KEY);
    if (raw == null || !/^\d+$/.test(raw)) return null;
    return Number(raw);
  } catch { return null; }
}

/**
 * Note l'heure de la vérification. Ne lève jamais (stockage refusé : la mémoire de app.js prend le relais).
 * @param {{setItem: (k: string, v: string) => void}|null|undefined} storage @param {number} now
 */
export function markChecked(storage, now) {
  try { storage?.setItem(UPDATE_CHECKED_KEY, String(Math.floor(now))); } catch { /* stockage refusé */ }
}

/**
 * Faut-il vérifier maintenant ?
 * Jamais vérifié : oui. Sinon oui si la dernière vérification a au moins `recheckMs`, ou si l'horloge a reculé (heure changée à la main : on ne bloque pas 5 h).
 * @param {{lastCheckedAt: number|null, now: number, recheckMs?: number}} p
 * @returns {boolean}
 */
export function isCheckDue({ lastCheckedAt, now, recheckMs = UPDATE_RECHECK_MS }) {
  if (lastCheckedAt == null || !Number.isFinite(lastCheckedAt)) return true;
  if (now < lastCheckedAt) return true;
  return now - lastCheckedAt >= recheckMs;
}

/**
 * Peut-on ouvrir la vérification maintenant, sans gêner la personne ?
 * Non si la page est cachée (on attend son retour), si une fenêtre de mise à jour ou un panneau est ouvert, ou si une vérification est déjà prévue.
 * Une partie ne tourne jamais dans index.html (player.html est une autre page, sans vérification) : revenir d'un jeu recharge l'accueil, qui vérifie alors si c'est dû.
 * @param {{hidden: boolean, dialogOpen: boolean, panelOpen: boolean, pending: boolean}} p
 * @returns {boolean}
 */
export function canCheckNow({ hidden, dialogOpen, panelOpen, pending }) {
  return !hidden && !dialogOpen && !panelOpen && !pending;
}
