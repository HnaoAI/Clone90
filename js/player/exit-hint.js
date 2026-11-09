// Rappel de la sortie au lancement du jeu (T7, docs/ux.md 4.4) : bandeau de 4 s, seulement les 3 premiers lancements
// (compteur en localStorage). Aucune dépendance ; le stockage est injectable.

export const EXIT_HINT_TEXT = 'Quitter : Select + Start (maintenir) - F10 - bouton Menu';
export const EXIT_HINT_MS = 4000;
export const EXIT_HINT_MAX_LAUNCHES = 3;
export const EXIT_HINT_STORAGE_KEY = 'clone90.exitHintCount';

/**
 * Vrai si le rappel doit être montré à ce lancement, et compte ce lancement. Stockage indisponible
 * (navigation privée, accès refusé) : on le montre, sans compter.
 * @param {{getItem: Function, setItem: Function}|null|undefined} storage
 */
export function shouldShowExitHint(storage) {
  try {
    const count = Number.parseInt(storage.getItem(EXIT_HINT_STORAGE_KEY), 10);
    const launches = Number.isFinite(count) && count > 0 ? count : 0;
    if (launches >= EXIT_HINT_MAX_LAUNCHES) return false;
    storage.setItem(EXIT_HINT_STORAGE_KEY, String(launches + 1));
    return true;
  } catch {
    return true;
  }
}
