// Lecture des couleurs déclarées dans css/base.css et contraste WCAG (T24). Sans dépendance.
// Source unique des couleurs : les variables CSS de css/base.css (bloc :root). Les scripts de génération (logos, icônes)
// et les tests les lisent ici au lieu de les recopier.

/** Variables couleur #rrggbb du CSS : { '--bg': '#0a1233', ... } (hex en minuscules, valeurs rgba() ignorées). */
export function readCssColors(css) {
  return Object.fromEntries([...css.matchAll(/(--[a-z0-9-]+):\s*(#[0-9a-f]{6})\b/gi)].map((m) => [m[1], m[2].toLowerCase()]));
}

const luminance = (hex) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

/** Rapport de contraste WCAG 2.x entre deux couleurs #rrggbb. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Couleur #rrggbb en triplet d'octets [r, g, b]. */
export const hexToRgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
