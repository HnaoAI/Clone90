// Textes d'interface partagés par les écrans (T5). Aucune dépendance.

/**
 * Libellé du nombre de jeux : "0 jeu", "1 jeu", "12 jeux" (singulier jusqu'à 1, règle française).
 * @param {number} count
 */
export const formatGameCount = (count) => `${count} ${count <= 1 ? 'jeu' : 'jeux'}`;

const CODE_PATTERN = /(roms\/<machine>\/|node scripts\/[\w.-]+\.mjs|games\.json)/;

/**
 * Découpe un texte en segments, en isolant chemins et commandes (roms/<machine>/, node scripts/x.mjs, games.json)
 * pour les afficher en police mono et les rendre copiables.
 * @param {string} text
 * @returns {{text: string, code: boolean}[]}
 */
export const splitCode = (text) => text.split(CODE_PATTERN).filter(Boolean).map((part) => ({ text: part, code: CODE_PATTERN.test(part) }));
