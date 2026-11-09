// Comparaison de titres, partagée par js/data.js (navigateur) et scripts/generate-games.mjs (Node) : une seule règle de tri.
// INVARIANT : aucune dépendance (importable par le navigateur et par Node).

const TITLE_COLLATOR = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

/**
 * Compare deux titres : sans casse ni accents, nombres comparés comme des nombres ("Game 2" avant "Game 10").
 * @param {string} a
 * @param {string} b
 * @returns {number} négatif, nul ou positif (utilisable dans Array.prototype.sort)
 */
export const compareTitles = (a, b) => TITLE_COLLATOR.compare(a, b);
