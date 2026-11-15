// Source des vrais logos des machines (T29, rendue commune en T42) : adresse du thème libre es-theme-carbon de RetroPie (commit figé), chemin
// du logo dans le dossier des ROMs, contrôle qu'un SVG reçu est une image inoffensive. Fonctions pures, sans dépendance, partagées par
// scripts/machine-logos.mjs (Mac) et js/local-logos.js (« Mes fichiers », navigateur).
// INVARIANT : `logoUrl` est la SEULE fabrique d'adresses : hôte fixe, dépôt fixe, commit fixe, dossier du thème contrôlé.

/** Dossier des logos téléchargés dans le dossier des ROMs (Mac) ou sous roms/ dans la bibliothèque du navigateur. Même valeur que LOGOS_DIR de scripts/generate-games.mjs. */
export const LOGOS_DIR = 'clone90-logos';

export const MAX_LOGO_BYTES = 256 * 1024;
/** Commit du thème es-theme-carbon (RetroPie) vérifié le 2026-11-12 : l'adresse figée garantit que le contenu ne change pas sans nous. */
export const LOGO_THEME_COMMIT = 'b09973e0b0c589cb11fe772c169a6ff5d588b390';
const SAFE_NAME = /^[a-z0-9]+$/;
/** Dossier du thème : comme SAFE_NAME, avec des tirets entre les mots (T30 : `tg-cd`, le thème n'a pas de dossier `pcenginecd` à ce commit). */
const SAFE_THEME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Seule fabrique d'adresses : hôte fixe, commit fixe, dossier du thème contrôlé. @throws {Error} si le nom est invalide */
export function logoUrl(themeDir) {
  if (!SAFE_THEME.test(themeDir ?? '')) throw new Error(`Dossier de logo invalide : ${themeDir}`);
  return `https://raw.githubusercontent.com/RetroPie/es-theme-carbon/${LOGO_THEME_COMMIT}/${themeDir}/art/system.svg`;
}

/** Chemin du logo d'une machine, relatif au dossier des ROMs. @throws {Error} si l'id est invalide */
export function logoTargetPath(systemId) {
  if (!SAFE_NAME.test(systemId ?? '')) throw new Error(`Identifiant de machine invalide : ${systemId}`);
  return `${LOGOS_DIR}/${systemId}.svg`;
}

// Un logo est une image : rien qui exécute du code, charge une autre ressource ou lise un fichier (entités XML).
const FORBIDDEN = [
  [/<\s*script/i, 'script'],
  [/<\s*(foreignObject|iframe|embed|object)\b/i, 'contenu HTML'],
  [/\son[a-z]+\s*=/i, 'gestionnaire d\'événement'],
  [/javascript\s*:/i, 'lien javascript'],
  [/@import/i, 'feuille de style externe'],
  [/url\(\s*['"]?\s*(?!#|data:image\/)/i, 'ressource externe'],
];
// Entités : seules les définitions internes en texte simple (en-tête des fichiers d'Adobe Illustrator : `<!ENTITY ns_ai "http://ns.adobe.com/...">`) sont admises ;
// une entité externe (SYSTEM, PUBLIC), paramètre (%) ou qui en contient une autre (expansion en chaîne) est refusée.
const ENTITY = /<!ENTITY([^>]*)>/gi;
const SIMPLE_ENTITY = /^\s+[A-Za-z_][\w.-]*\s+("[^"&%<]*"|'[^'&%<]*')\s*$/;
const HREF = /\b(?:xlink:)?href\s*=\s*(["'])(.*?)\1/gi;

/**
 * Vérifie qu'un texte est un logo SVG inoffensif.
 * @param {string} text contenu reçu
 * @returns {string|null} null si accepté, sinon la raison en français (« refusé : ... »)
 */
export function checkSvg(text) {
  const body = (text ?? '').replace(/^﻿/, '').trim();
  for (const [pattern, what] of FORBIDDEN) if (pattern.test(body)) return `refusé : ${what}`;
  for (const [, definition] of body.matchAll(ENTITY)) if (!SIMPLE_ENTITY.test(definition)) return 'refusé : entité XML';
  const start = body.replace(/^(<\?xml[^>]*\?>|<!--[\s\S]*?-->|<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>|\s)+/gi, ''); // en-tête XML, commentaires, DOCTYPE
  if (!/^<svg[\s>]/i.test(start)) return 'le fichier reçu n\'est pas un logo SVG';
  for (const [, , target] of body.matchAll(HREF)) {
    if (!target.startsWith('#') && !/^data:image\/(png|jpeg|gif);/i.test(target)) return 'refusé : lien externe';
  }
  return null;
}
