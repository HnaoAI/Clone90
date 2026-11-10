// Rappel de la sortie au lancement du jeu (T7, docs/ux.md 4.4) : bandeau de 4 s, seulement les 3 premiers lancements
// (compteur en localStorage). Aucune dépendance ; le stockage est injectable.

export const EXIT_HINT_TEXT = 'Quitter : Select + Start (maintenir) - F10 - bouton Menu';
/** Rappel court pour un appareil tactile sans manette (ni clavier ni Select+Start à citer). */
export const EXIT_HINT_TEXT_TOUCH = 'Quitter : bouton Menu';
/** 2e ligne du rappel pour un jeu à plusieurs disquettes (T12, avis ux). */
export const DISK_HINT_TEXT = 'Disquette : Select + RB - F9';
/**
 * @param {boolean} touchOnly appareil tactile sans manette détectée
 * @param {boolean} [multiDisk] jeu à plusieurs disquettes : ajoute la ligne du raccourci (sauf tactile sans manette, la barre d'EmulatorJS suffit)
 */
export const exitHintText = (touchOnly, multiDisk = false) => {
  if (touchOnly) return EXIT_HINT_TEXT_TOUCH;
  return multiDisk ? `${EXIT_HINT_TEXT}\n${DISK_HINT_TEXT}` : EXIT_HINT_TEXT;
};
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
