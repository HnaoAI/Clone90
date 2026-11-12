// Logos des machines téléchargés (T29) : pour chaque machine qui a un `logoTheme` (systems.json), lit `<logoTheme>/art/system.svg` du thème libre
// es-theme-carbon de RetroPie (figé sur un commit) et l'écrit dans le dossier des ROMs, sous clone90-logos/<id>.svg. Docs : architecture.md section 7.5.
// Même mécanisme que les pochettes (covers.mjs, dont on reprend `defaultFetchBytes`). Dépend de generate-games.mjs et local-settings.mjs. Node 18+, sans dépendance.
// INVARIANT : les SEULES requêtes réseau sont des lectures vers raw.githubusercontent.com (`logoUrl`) ; aucun nom de jeu ni donnée de Clone90 n'est envoyé.
// INVARIANT : on ne remplace jamais un logo existant (écriture exclusive `wx`) et on n'écrit qu'un SVG vérifié par `checkSvg`, de 256 Ko au plus.
// Usage : node scripts/machine-logos.mjs
import { writeFile, mkdir, access } from 'node:fs/promises';
import { join, dirname, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PROJECT_ROOT } from './project-root.mjs';
import { readLocalSettings } from './local-settings.mjs';
import { readSystems, runGenerate, LOGOS_DIR } from './generate-games.mjs';
import { defaultFetchBytes } from './covers.mjs';

export const MAX_LOGO_BYTES = 256 * 1024;
/** Commit du thème es-theme-carbon (RetroPie) vérifié le 2026-11-12 : l'adresse figée garantit que le contenu ne change pas sans nous. */
export const LOGO_THEME_COMMIT = 'b09973e0b0c589cb11fe772c169a6ff5d588b390';
const SAFE_NAME = /^[a-z0-9]+$/;
/** Dossier du thème : comme SAFE_NAME, avec des tirets entre les mots (T30 : `tg-cd`, le thème n'a pas de dossier `pcenginecd` à ce commit). */
const SAFE_THEME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** Dossier des logos, DANS le dossier des ROMs (jamais dans le dépôt : roms/ est ignoré par git). */
export { LOGOS_DIR };

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

const exists = (path) => access(path).then(() => true, () => false);
const errorText = (err) => err?.message ?? String(err);

/**
 * Télécharge les logos manquants puis régénère games.json si au moins un a été écrit.
 * @param {object} [options]
 * @param {string} [options.root] racine du projet
 * @param {Date} [options.now]
 * @param {{fetchBytes?: Function}} [options.net] accès réseau injectable (tests)
 * @param {(event: {phase: 'downloading', system?: string, done: number, total: number}) => void} [options.onProgress]
 * @returns {Promise<{exitCode: number, summary: {found: string[], alreadyHave: number, failed: {system: string, reason: string}[], noSource: string[]}}>}
 */
export async function runLogos({ root = PROJECT_ROOT, now = new Date(), net = {}, onProgress = () => {} } = {}) {
  const fetchBytes = net.fetchBytes ?? defaultFetchBytes;
  const summary = { found: [], alreadyHave: 0, failed: [], noSource: [] };
  const systems = [...await readSystems(root)].sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.id < b.id ? -1 : 1));
  const { romsDir } = await readLocalSettings(root);
  const todo = systems.filter((s) => s.logoTheme);
  summary.noSource.push(...systems.filter((s) => !s.logoTheme).map((s) => s.name));
  let done = 0;
  for (const system of todo) {
    onProgress({ phase: 'downloading', system: system.name, done, total: todo.length });
    await handleSystem({ system, romsDir, fetchBytes, summary });
    done += 1;
  }
  onProgress({ phase: 'downloading', done, total: todo.length });
  const exitCode = summary.found.length ? (await runGenerate({ root, now, log: () => {}, logError: () => {} })).exitCode : 0;
  return { exitCode, summary };
}

/** Une machine : déjà présent, ou téléchargement, vérification et écriture exclusive. Remplit `summary`. */
async function handleSystem({ system, romsDir, fetchBytes, summary }) {
  let target;
  try {
    target = resolve(romsDir, logoTargetPath(system.id));
    if (!target.startsWith(resolve(romsDir) + sep)) throw new Error('chemin refusé');
    if (await exists(target)) { summary.alreadyHave += 1; return; }
    const text = Buffer.from(await fetchBytes(logoUrl(system.logoTheme), { maxBytes: MAX_LOGO_BYTES })).toString('utf8');
    const problem = checkSvg(text);
    if (problem) throw new Error(problem);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, text, { flag: 'wx' });
    summary.found.push(system.name);
  } catch (err) {
    if (err.code === 'EEXIST') summary.alreadyHave += 1; // apparu entre-temps : on n'y touche pas
    else summary.failed.push({ system: system.name, reason: errorText(err) });
  }
}

/**
 * Résumé en français, une ligne par résultat, compteurs à 0 omis.
 * @param {{summary: object}} result
 * @param {{details?: boolean}} [options] `details` : une ligne par échec (ligne de commande)
 * @returns {string[]}
 */
export function formatLogosSummary({ summary: s }, { details = true } = {}) {
  const lines = [[s.found.length, 'Logos téléchargés'], [s.alreadyHave, 'Déjà présents'], [s.failed.length, 'Échecs']]
    .filter(([n]) => n > 0).map(([n, label]) => `${label} : ${n}`);
  if (s.noSource.length) lines.push(`Machines sans logo à télécharger : ${s.noSource.join(', ')}`);
  if (!lines.length) lines.push('Aucun logo à télécharger.');
  if (details) lines.push(...s.failed.map((f) => `  Échec : ${f.system} (${f.reason})`));
  return lines;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const result = await runLogos();
  for (const line of formatLogosSummary(result)) console.log(line);
  if (result.summary.found.length) console.log('games.json mis à jour.');
  console.log('Logos du thème libre es-theme-carbon (RetroPie), pour un usage personnel. Ils restent sur ce Mac et ne sont jamais publiés.');
  process.exitCode = result.exitCode;
}
