// Réception d'un jeu ou d'une pochette envoyés par un téléphone associé (T44), pour le serveur de partage (sync-server.mjs, route POST /sync/upload?path=).
// Le fichier est écrit dans le dossier des jeux du Mac, `<dossier des jeux>/<machine>/<fichier>`, comme un jeu ou une pochette ajoutés à la main.
// T53 (décision de Hicham du 2026-11-22) : un BIOS `bios/[<sous-dossier>/]<fichier>` est écrit dans le dossier des BIOS du Mac, mêmes garanties.
//   Un BIOS du même nom à la casse près (SYSCARD3.PCE / syscard3.pce) compte comme déjà présent : jamais de doublon ni d'écrasement.
// Dépend de js/sync-plan.js (`uploadTargetPath`, `maxUploadBytes`, partagés avec le téléphone). Aucune dépendance npm.
// INVARIANT (sécurité, plan validé par Hicham le 2026-11-15) : seulement si la personne a coché « Accepter les jeux du téléphone » sur le Mac
//   (vérifié par l'appelant) ; seulement des jeux, pochettes et BIOS (`uploadTargetPath` : machine connue, aucun logo, fichier caché ni `..`) ;
//   JAMAIS d'écrasement (lien physique `link`, qui échoue si le nom existe) ; dossier de la machine vérifié par son chemin réel (un lien qui
//   sort du dossier des jeux est refusé) ; taille annoncée obligatoire et limitée (jeu 1 Go, pochette 10 Mo) ; place libre vérifiée ; fichier temporaire caché effacé si
//   l'envoi est incomplet : jamais de jeu à moitié écrit.
// T52 : envoi abandonné après UPLOAD_IDLE_MS sans donnée (téléphone en pause ou disparu) ; BIOS déclaré rangé avec les jeux refusé.
import { createWriteStream } from 'node:fs';
import { link, lstat, mkdir, readdir, realpath, stat, statfs, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { uploadTargetPath, maxUploadBytes, isCoverPath, isBiosPath, UPLOAD_STALL_MS } from '../js/sync-plan.js';
import { ROMS_DIR } from '../js/config.js';

/** Place gardée libre sur le disque du Mac après l'envoi. */
export const UPLOAD_SPACE_MARGIN = 500 * 1024 * 1024;

/** Place libre du disque d'un dossier, en octets. */
export async function freeBytes(dir) {
  const s = await statfs(dir);
  return s.bavail * s.bsize;
}

/**
 * T52 : délai sans aucune donnée reçue après lequel un envoi est abandonné (fichier temporaire effacé, verrou du serveur libéré).
 * Avant T52, seul le requestTimeout d'une heure du serveur s'appliquait : un téléphone disparu en plein envoi bloquait le Mac 1 heure.
 */
export const UPLOAD_IDLE_MS = UPLOAD_STALL_MS;

const refuse = (status, error, message) => ({ status, body: { error, message } });

/**
 * Reçoit un jeu, une pochette ou (T53) un BIOS.
 * @param {import('node:http').IncomingMessage} req corps = contenu du fichier, `Content-Length` obligatoire
 * @param {{path: string, romsDir: string, biosDir?: string, systemIds: string[], biosFiles?: Set<string>, getFreeBytes?: (dir: string) => Promise<number>,
 *   idleMs?: number}} options `biosFiles` (T52) : declaredBiosFiles(systems), refusés ; `idleMs` (T52) : délai sans donnée avant abandon
 * @returns {Promise<{status: number, body: object}>} 201 `{path, size, mtime}` ; sinon `{error, message}` : 400 bad-path, bios ou incomplete, 408 stalled,
 *   411 no-length, 413 too-big, 409 exists ou no-folder, 507 no-space. Ne lève pas pour une erreur de la requête.
 */
export async function receiveUpload(req, { path, romsDir, biosDir, systemIds, biosFiles = new Set(), getFreeBytes = freeBytes, idleMs = UPLOAD_IDLE_MS }) {
  if (uploadTargetPath(path, systemIds) && !uploadTargetPath(path, systemIds, biosFiles)) {
    return refuse(400, 'bios', 'Ce fichier est un BIOS rangé avec les jeux : il n\'est pas envoyé au Mac (rangez-le dans le dossier des BIOS).');
  }
  const target = uploadTargetPath(path, systemIds, biosFiles);
  if (!target) return refuse(400, 'bad-path', 'Seuls les jeux, pochettes et BIOS des machines connues peuvent être envoyés au Mac.');
  const lengthText = req.headers['content-length'];
  const length = /^\d{1,15}$/.test(lengthText ?? '') ? Number(lengthText) : NaN;
  if (!Number.isSafeInteger(length)) return refuse(411, 'no-length', 'Taille du fichier manquante.');
  if (length > maxUploadBytes(target)) return refuse(413, 'too-big', isCoverPath(target) ? 'Pochette trop grosse (plus de 10 Mo).' : 'Fichier trop gros (plus de 1 Go).');
  const [top, ...folders] = target.split('/');
  const name = folders.pop();
  const bios = isBiosPath(target);
  const base = top === ROMS_DIR ? romsDir : biosDir;
  let dir;
  try {
    if (bios) await mkdir(base, { recursive: true });
    const realBase = await realpath(base);
    const expected = join(realBase, ...folders);
    await mkdir(expected, { recursive: true });
    dir = await realpath(expected);
    // Chemin réel identique (à la casse près : macOS rend `roms/Amiga` pour `roms/amiga`) : un lien qui sort du dossier est refusé.
    if (dir.toLowerCase() !== expected.toLowerCase() || (folders.length && !dir.startsWith(realBase + sep))) {
      return refuse(409, 'no-folder', bios ? 'Le dossier des BIOS du Mac n\'est pas utilisable.' : 'Le dossier de cette machine sur le Mac n\'est pas utilisable.');
    }
  } catch {
    return refuse(409, 'no-folder', bios ? 'Le dossier des BIOS du Mac est introuvable.' : 'Le dossier des jeux du Mac est introuvable.');
  }
  const final = join(dir, name);
  const sameName = bios && (await readdir(dir).catch(() => [])).some((n) => n.toLowerCase() === name.toLowerCase());
  if (sameName || await lstat(final).then(() => true, () => false)) return refuse(409, 'exists', 'Un fichier du même nom est déjà sur le Mac : il n\'est jamais remplacé.');
  const free = await getFreeBytes(dir).catch(() => Infinity);
  if (free < length + UPLOAD_SPACE_MARGIN) return refuse(507, 'no-space', 'Plus assez de place sur le Mac.');
  const tmp = join(dir, `.clone90-upload-${randomBytes(8).toString('hex')}.part`);
  let received = 0;
  let stalled = false;
  let idle = null;
  const arm = () => {
    clearTimeout(idle);
    idle = setTimeout(() => { stalled = true; req.destroy(new Error('plus aucune donnée')); }, idleMs);
  };
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      arm();
      received += chunk.length;
      cb(received > length ? new Error('trop de données') : null, chunk);
    },
  });
  arm();
  try {
    await pipeline(req, counter, createWriteStream(tmp, { flags: 'wx', mode: 0o644 }));
    if (received !== length) return refuse(400, 'incomplete', 'Envoi incomplet : le fichier n\'a pas été gardé.');
    await link(tmp, final);
  } catch (err) {
    if (stalled) return refuse(408, 'stalled', 'Envoi abandonné : plus rien n\'arrivait du téléphone. Le fichier n\'a pas été gardé.');
    if (err.code === 'EEXIST') return refuse(409, 'exists', 'Un fichier du même nom est déjà sur le Mac : il n\'est jamais remplacé.');
    return refuse(400, 'incomplete', 'Envoi incomplet : le fichier n\'a pas été gardé.');
  } finally {
    clearTimeout(idle);
    await unlink(tmp).catch(() => {});
  }
  const info = await stat(final);
  return { status: 201, body: { path: target, size: info.size, mtime: Math.floor(info.mtimeMs) } };
}
