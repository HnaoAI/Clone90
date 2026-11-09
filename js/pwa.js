// Enregistrement du service worker (T8). Aucune dépendance ; la navigation est injectable pour les tests.
// Un service worker exige HTTPS ou localhost (architecture section 9) : sinon on ne fait rien, sans erreur.
import { SERVICE_WORKER_URL } from './config.js';

/** Vrai si l'environnement permet un service worker (API présente et contexte sécurisé). */
export const canRegisterServiceWorker = (nav = globalThis.navigator, secure = globalThis.isSecureContext) => Boolean(nav && 'serviceWorker' in nav && secure);

/**
 * Enregistre sw.js (chemin relatif, portée = dossier de l'application). N'échoue jamais : l'application marche sans.
 * @returns {Promise<boolean>} vrai si l'enregistrement a réussi
 */
export async function registerServiceWorker(nav = globalThis.navigator, secure = globalThis.isSecureContext) {
  if (!canRegisterServiceWorker(nav, secure)) return false;
  try {
    await nav.serviceWorker.register(SERVICE_WORKER_URL);
    return true;
  } catch {
    return false;
  }
}
