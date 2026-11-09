// Textes d'interface partagés par les écrans (T5). Aucune dépendance.

/**
 * Libellé du nombre de jeux : "0 jeu", "1 jeu", "12 jeux" (singulier jusqu'à 1, règle française).
 * @param {number} count
 */
export const formatGameCount = (count) => `${count} ${count <= 1 ? 'jeu' : 'jeux'}`;
