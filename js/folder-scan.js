// Scan d'un dossier de jeux choisi sur l'appareil (T38) : un sous-dossier par machine (comme roms/ du Mac), et bios/ s'il existe.
// Fonctions PURES : la liste des fichiers donnée par le sélecteur de dossier devient la liste des copies à faire dans « Mes fichiers »
// (js/local-library.js, chemins `roms/<machine>/...` et `bios/...`), puis le message de fin. Aucune lecture de fichier ici.
// Dépend de local-library.js (noms sûrs, nom exact des BIOS), games-builder.js (extensions). Aucune liste de machines (CLAUDE.md règle 2).
import { sanitizeFileName, biosStoragePath } from './local-library.js';
import { extOf, IMAGE_EXTENSIONS } from './games-builder.js';
import { ROMS_DIR, BIOS_DIR } from './config.js';

/** Fichiers texte utiles à la liste des jeux, gardés quelle que soit la machine (comme le générateur). */
const TEXT_EXTENSIONS = ['m3u', 'bios'];
/** Pistes citées par un .cue (Mega-CD, PC Engine CD) : gardées seulement pour une machine qui lit les .cue. */
export const CUE_TRACK_EXTENSIONS = ['bin', 'img', 'iso', 'wav', 'mp3', 'ogg', 'flac', 'ape'];
/** Dossiers ignorés sans être comptés : métadonnées des archives macOS. Les noms commençant par un point aussi. */
const HIDDEN_DIRS = ['__macosx'];

/**
 * Vrai si le navigateur sait choisir un dossier entier (`<input webkitdirectory>` : Chrome, Edge, Firefox, Safari ordinateur).
 * @param {object} [win] fenêtre (globalThis par défaut)
 */
export function folderPickingSupported(win = globalThis) {
  const proto = win?.HTMLInputElement?.prototype;
  return Boolean(proto && 'webkitdirectory' in proto);
}

const isHiddenSegment = (s) => s.startsWith('.') || HIDDEN_DIRS.includes(s.toLowerCase());

/**
 * Plan d'import d'un dossier choisi.
 * Règle : dans le chemin de chaque fichier, le premier dossier dont le nom est l'id d'une machine (sans tenir compte de la casse) ou `bios`
 * décide du rangement. Le dossier choisi peut donc être roms/, son parent (roms/ + bios/) ou un dossier de machine.
 * - Machine : `roms/<id>/<fichier>`. Un niveau de sous-dossier est lu, comme scripts/generate-games.mjs, mais son contenu est rangé À PLAT
 *   dans `roms/<id>/` : la bibliothèque locale ne garde que des fichiers directement dans le dossier de la machine (T27, testé dans
 *   tests/local-library.test.mjs). Un .cue cite ses pistes par nom, relatif à son dossier, donc un jeu Mega-CD en sous-dossier reste jouable.
 *   Deux fichiers de même nom dans deux sous-dossiers : le premier est gardé (`duplicates`). Formats gardés : extensions de la machine,
 *   jaquettes, .m3u, .bios, et pistes de .cue si la machine lit les .cue.
 * - Un fichier dont le nom est un BIOS déclaré de sa machine (neogeo.zip) va dans bios/ sous son nom exact : jamais un jeu.
 * - bios/ : fichiers directement dedans, nom exact retrouvé comme pour « Choisir des BIOS » (`known: false` si inattendu).
 * - Déjà dans la bibliothèque au même chemin avec la même taille : pas recopié (`already`). Même destination deux fois : `duplicates`.
 * @param {{webkitRelativePath?: string, name: string, size: number}[]} files fichiers du sélecteur (File), dans l'ordre
 * @param {object[]} systems machines de systems.json
 * @param {{path: string, size: number}[]} [existing] contenu actuel de la bibliothèque
 * @returns {{items: {index: number, path: string, kind: 'rom'|'bios', systemId: string|null, known?: boolean, size: number}[],
 *   skipped: {relativePath: string, reason: 'machine'|'format'|'depth'|'name'}[], already: number, duplicates: number, hidden: number, flat: boolean}}
 *   `index` : position dans `files` ; `flat` : le navigateur n'a donné aucun chemin de dossier (rien n'est deviné)
 * @throws {TypeError} si `files` n'est pas une liste
 */
export function planFolderImport(files, systems, existing = []) {
  if (!Array.isArray(files)) throw new TypeError('planFolderImport : une liste de fichiers est attendue');
  const plan = { items: [], skipped: [], already: 0, duplicates: 0, hidden: 0, flat: false };
  if (!files.length) return plan;
  plan.flat = files.every((f) => !f?.webkitRelativePath);
  if (plan.flat) return plan;
  const byId = new Map(systems.map((s) => [s.id.toLowerCase(), s]));
  const sizes = new Map(existing.map((e) => [e.path, e.size]));
  const seen = new Set();
  const biosOf = new Map(systems.map((s) => [s.id, new Set((s.bios ?? []).map((b) => b.file).filter((x) => typeof x === 'string').map((x) => x.toLowerCase()))]));

  files.forEach((file, index) => {
    const relativePath = String(file?.webkitRelativePath ?? '');
    const segments = relativePath.split(/[\\/]/).filter(Boolean);
    const skip = (reason) => plan.skipped.push({ relativePath, reason });
    if (!segments.length) return skip('machine');
    if (segments.some(isHiddenSegment)) { plan.hidden += 1; return undefined; }
    const at = segments.slice(0, -1).findIndex((s) => s.toLowerCase() === BIOS_DIR || byId.has(s.toLowerCase()));
    if (at < 0) return skip('machine');
    const inner = segments.slice(at + 1);
    const folder = segments[at].toLowerCase();
    let target;
    if (folder === BIOS_DIR) {
      if (inner.length > 1) return skip('depth');
      target = biosStoragePath(inner[0], systems);
      if (!target) return skip('name');
      target = { ...target, kind: 'bios', systemId: null };
    } else {
      const system = byId.get(folder);
      if (inner.length > 2) return skip('depth');
      const clean = inner.map(sanitizeFileName);
      if (clean.some((s) => !s)) return skip('name');
      const name = clean[clean.length - 1];
      if (biosOf.get(system.id).has(name.toLowerCase())) {
        target = { ...biosStoragePath(name, systems), kind: 'bios', systemId: null };
      } else {
        const ext = extOf(name);
        const accepted = system.extensions.map((e) => e.toLowerCase());
        const allowed = accepted.includes(ext) || IMAGE_EXTENSIONS.includes(ext) || TEXT_EXTENSIONS.includes(ext)
          || (accepted.includes('cue') && CUE_TRACK_EXTENSIONS.includes(ext));
        if (!allowed) return skip('format');
        target = { path: `${ROMS_DIR}/${system.id}/${name}`, kind: 'rom', systemId: system.id };
      }
    }
    if (seen.has(target.path)) { plan.duplicates += 1; return undefined; }
    seen.add(target.path);
    if (sizes.has(target.path) && sizes.get(target.path) === file.size) { plan.already += 1; return undefined; }
    const item = { index, path: target.path, kind: target.kind, systemId: target.systemId, size: file.size };
    if (target.kind === 'bios') item.known = target.known;
    plan.items.push(item);
    return undefined;
  });
  return plan;
}

/**
 * Chiffres du message de fin.
 * @param {ReturnType<typeof planFolderImport>} plan @param {object[]} systems
 * @returns {{machines: {systemId: string, name: string, count: number}[], bios: number, unknownBios: string[], already: number,
 *   skipped: number, flat: boolean, total: number}} machines dans l'ordre de systems.json, sans celles à 0
 */
export function summarizePlan(plan, systems) {
  const counts = new Map();
  for (const item of plan.items) if (item.kind === 'rom') counts.set(item.systemId, (counts.get(item.systemId) ?? 0) + 1);
  const bios = plan.items.filter((i) => i.kind === 'bios');
  return {
    machines: systems.filter((s) => counts.has(s.id)).map((s) => ({ systemId: s.id, name: s.name, count: counts.get(s.id) })),
    bios: bios.length,
    unknownBios: bios.filter((i) => i.known === false).map((i) => i.path.slice(BIOS_DIR.length + 1)),
    already: plan.already, skipped: plan.skipped.length, flat: plan.flat, total: plan.items.length,
  };
}

const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;

/**
 * Message affiché après le scan (toast).
 * @param {ReturnType<typeof summarizePlan> & {copied: number}} result `copied` : fichiers réellement copiés (moins que `total` si la copie a échoué)
 * @returns {string}
 */
export function describeFolderImport({ machines = [], bios = 0, unknownBios = [], already = 0, skipped = 0, flat = false, total = 0, copied = 0 }) {
  if (flat) return 'Ce navigateur ne donne pas les dossiers : ajoutez les jeux machine par machine avec les boutons ci-dessous.';
  if (copied < total) return `Copie interrompue après ${plural(copied, 'fichier')} sur ${total} : plus assez de place sur l'appareil ?`;
  const ignored = skipped ? `${plural(skipped, 'fichier')} ${skipped > 1 ? 'ignorés' : 'ignoré'} (format ou dossier non reconnu)` : null;
  const present = already ? `${already} déjà ${already > 1 ? 'présents' : 'présent'}` : null;
  if (total === 0 && already) return [`Rien de nouveau : ${plural(already, 'fichier')} déjà ${already > 1 ? 'présents' : 'présent'}`, ignored].filter(Boolean).join(' ; ');
  if (total === 0) return 'Aucun jeu trouvé : choisissez le dossier qui contient un sous-dossier par machine (amiga, neogeo…).';
  const parts = [];
  if (machines.length) parts.push(machines.map((m) => `${m.name} ${plural(m.count, 'fichier')}`).join(', '));
  if (bios) parts.push(`${bios} BIOS`);
  if (present) parts.push(present);
  if (ignored) parts.push(ignored);
  if (unknownBios.length) parts.push(`nom de BIOS inattendu : ${unknownBios.join(', ')} (renommez-le avec le nom exact)`);
  return `Dossier importé : ${parts.join(' ; ')}`;
}
