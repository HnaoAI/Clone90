// Réception d'un jeu ou d'une pochette envoyés par un téléphone associé (T44), pour le serveur de partage (sync-server.mjs, route POST /sync/upload?path=).
// Le fichier est écrit dans le dossier des jeux du Mac, `<dossier des jeux>/<machine>/<fichier>`, comme un jeu ou une pochette ajoutés à la main.
// Dépend de js/sync-plan.js (`uploadTargetPath`, `maxUploadBytes`, partagés avec le téléphone). Aucune dépendance npm.
// INVARIANT (sécurité, plan validé par Hicham le 2026-11-15) : seulement si la personne a coché « Accepter les jeux du téléphone » sur le Mac
//   (vérifié par l'appelant) ; seulement des jeux et pochettes (`uploadTargetPath` : machine connue, aucun BIOS, logo, fichier caché ni `..`) ;
//   JAMAIS d'écrasement (lien physique `link`, qui échoue si le nom existe) ; dossier de la machine vérifié par son chemin réel (un lien qui
//   sort du dossier des jeux est refusé) ; taille annoncée obligatoire et limitée (jeu 1 Go, pochette 10 Mo) ; place libre vérifiée ; fichier temporaire caché effacé si
//   l'envoi est incomplet : jamais de jeu à moitié écrit.
import { createWriteStream } from 'node:fs';
import { link, lstat, mkdir, realpath, stat, statfs, unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join, sep } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { uploadTargetPath, maxUploadBytes, isCoverPath } from '../js/sync-plan.js';

/** Place gardée libre sur le disque du Mac après l'envoi. */
export const UPLOAD_SPACE_MARGIN = 500 * 1024 * 1024;

/** Place libre du disque d'un dossier, en octets. */
export async function freeBytes(dir) {
  const s = await statfs(dir);
  return s.bavail * s.bsize;
}

const refuse = (status, error, message) => ({ status, body: { error, message } });

/**
 * Reçoit un jeu ou une pochette.
 * @param {import('node:http').IncomingMessage} req corps = contenu du fichier, `Content-Length` obligatoire
 * @param {{path: string, romsDir: string, systemIds: string[], getFreeBytes?: (dir: string) => Promise<number>}} options
 * @returns {Promise<{status: number, body: object}>} 201 `{path, size, mtime}` ; sinon `{error, message}` : 400 bad-path ou incomplete,
 *   411 no-length, 413 too-big, 409 exists ou no-folder, 507 no-space. Ne lève pas pour une erreur de la requête.
 */
export async function receiveUpload(req, { path, romsDir, systemIds, getFreeBytes = freeBytes }) {
  const target = uploadTargetPath(path, systemIds);
  if (!target) return refuse(400, 'bad-path', 'Seuls les jeux et pochettes des machines connues peuvent être envoyés au Mac.');
  const lengthText = req.headers['content-length'];
  const length = /^\d{1,15}$/.test(lengthText ?? '') ? Number(lengthText) : NaN;
  if (!Number.isSafeInteger(length)) return refuse(411, 'no-length', 'Taille du fichier manquante.');
  if (length > maxUploadBytes(target)) return refuse(413, 'too-big', isCoverPath(target) ? 'Pochette trop grosse (plus de 10 Mo).' : 'Fichier trop gros (plus de 1 Go).');
  const [, machine, name] = target.split('/');
  let dir;
  try {
    const realRoms = await realpath(romsDir);
    await mkdir(join(realRoms, machine), { recursive: true });
    dir = await realpath(join(realRoms, machine));
    if (dir !== join(realRoms, machine) || !dir.startsWith(realRoms + sep)) return refuse(409, 'no-folder', 'Le dossier de cette machine sur le Mac n\'est pas utilisable.');
  } catch {
    return refuse(409, 'no-folder', 'Le dossier des jeux du Mac est introuvable.');
  }
  const final = join(dir, name);
  if (await lstat(final).then(() => true, () => false)) return refuse(409, 'exists', 'Un fichier du même nom est déjà sur le Mac : il n\'est jamais remplacé.');
  const free = await getFreeBytes(dir).catch(() => Infinity);
  if (free < length + UPLOAD_SPACE_MARGIN) return refuse(507, 'no-space', 'Plus assez de place sur le Mac.');
  const tmp = join(dir, `.clone90-upload-${randomBytes(8).toString('hex')}.part`);
  let received = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      received += chunk.length;
      cb(received > length ? new Error('trop de données') : null, chunk);
    },
  });
  try {
    await pipeline(req, counter, createWriteStream(tmp, { flags: 'wx', mode: 0o644 }));
    if (received !== length) return refuse(400, 'incomplete', 'Envoi incomplet : le fichier n\'a pas été gardé.');
    await link(tmp, final);
  } catch (err) {
    if (err.code === 'EEXIST') return refuse(409, 'exists', 'Un fichier du même nom est déjà sur le Mac : il n\'est jamais remplacé.');
    return refuse(400, 'incomplete', 'Envoi incomplet : le fichier n\'a pas été gardé.');
  } finally {
    await unlink(tmp).catch(() => {});
  }
  const info = await stat(final);
  return { status: 201, body: { path: target, size: info.size, mtime: Math.floor(info.mtimeMs) } };
}
