// Appairage des téléphones pour le partage Mac -> téléphone (T43 ; T51 : par MOT DE PASSE choisi une fois sur le Mac, à la place du code à
// 6 chiffres) : mot de passe vérifié, jeton remis au téléphone qui donne le bon mot de passe, liste des téléphones associés. État gardé dans
// `clone90.sync.json` (ignoré par git, 0600) : partage activé ou non, EMPREINTE scrypt du mot de passe (jamais le mot de passe), EMPREINTES
// (SHA-256) des jetons, jamais les jetons eux-mêmes. T44 : `acceptUploads`, réception des jeux du téléphone (éteinte par défaut).
// INVARIANT (sécurité, T51) : après PASSWORD_MAX_TRIES mauvais mots de passe, plus aucun essai n'est permis pendant PASSWORD_LOCK_MS (tous
//   appareils confondus) ; changer le mot de passe oublie les téléphones associés. Comparaisons à temps constant.
import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { isSyncPassword, PASSWORD_MAX_TRIES, PASSWORD_LOCK_MS } from '../js/sync-plan.js';

export const SYNC_STATE_FILE = 'clone90.sync.json';
/** Nombre maximal de téléphones associés (le plus ancien est oublié au-delà). */
export const MAX_DEVICES = 10;

const hash = (token) => createHash('sha256').update(token).digest('hex');
/** Empreinte scrypt d'un mot de passe (sel de 16 octets, clé de 32 octets). @returns {Promise<string>} hexadécimal */
const scryptHex = (password, saltHex) => new Promise((resolve, reject) => {
  scryptCb(password.normalize('NFC'), Buffer.from(saltHex, 'hex'), 32, (err, key) => (err ? reject(err) : resolve(key.toString('hex'))));
});
const isPasswordRecord = (p) => p && typeof p === 'object' && /^[0-9a-f]{32}$/.test(p.salt) && /^[0-9a-f]{64}$/.test(p.hash);
const sameText = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Lit l'état. @returns {Promise<{enabled: boolean, acceptUploads: boolean, password: {salt: string, hash: string}|null, devices: {hash: string, pairedAt: number}[]}>}
 *   défaut : partage arrêté, réception des jeux du téléphone éteinte (T44), pas de mot de passe (T51), aucun téléphone
 */
export async function readSyncState(root) {
  try {
    const data = JSON.parse(await readFile(join(root, SYNC_STATE_FILE), 'utf8'));
    const devices = Array.isArray(data?.devices)
      ? data.devices.filter((d) => d && /^[0-9a-f]{64}$/.test(d.hash) && Number.isFinite(d.pairedAt)).slice(-MAX_DEVICES) : [];
    const password = isPasswordRecord(data?.password) ? { salt: data.password.salt, hash: data.password.hash } : null;
    return { enabled: data?.enabled === true, acceptUploads: data?.acceptUploads === true, password, devices };
  } catch {
    return { enabled: false, acceptUploads: false, password: null, devices: [] };
  }
}

/** Écrit l'état (fichier temporaire puis renommage : jamais de fichier à moitié écrit). */
export async function writeSyncState(root, state) {
  const target = join(root, SYNC_STATE_FILE);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ enabled: state.enabled, acceptUploads: state.acceptUploads === true,
    password: isPasswordRecord(state.password) ? state.password : null, devices: state.devices }, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, target);
}

/**
 * Appairage en mémoire, adossé au fichier d'état.
 * @param {{root: string, now?: () => number, makeToken?: () => string}} options injectables pour les tests
 */
export async function createPairing({ root, now = Date.now, makeToken = () => randomBytes(32).toString('hex') }) {
  let state = await readSyncState(root);
  let failures = 0;
  let lockedUntil = 0;
  const save = () => writeSyncState(root, state);
  return {
    get enabled() { return state.enabled; },
    get deviceCount() { return state.devices.length; },
    /** T51 : vrai si un mot de passe est choisi sur le Mac. */
    get hasPassword() { return state.password !== null; },
    /** T51 : fin du blocage après trop de mauvais mots de passe (ms), ou null. */
    get lockedUntil() { return lockedUntil > now() ? lockedUntil : null; },
    /** T44 : vrai si la personne a permis, sur le Mac, de recevoir les jeux des téléphones associés. */
    get acceptUploads() { return state.acceptUploads; },
    async setAcceptUploads(accept) {
      state = { ...state, acceptUploads: accept === true };
      await save();
    },
    async setEnabled(enabled) {
      state = { ...state, enabled };
      await save();
    },
    /**
     * T51 : choisit (ou change) le mot de passe. Les téléphones déjà associés sont oubliés : ils devront saisir le nouveau.
     * @returns {Promise<boolean>} faux si le mot de passe n'est pas acceptable (isSyncPassword)
     */
    async setPassword(password) {
      if (!isSyncPassword(password)) return false;
      const salt = randomBytes(16).toString('hex');
      state = { ...state, password: { salt, hash: await scryptHex(password, salt) }, devices: [] };
      failures = 0;
      lockedUntil = 0;
      await save();
      return true;
    },
    /**
     * T51 : essai d'un mot de passe venant du réseau.
     * @returns {Promise<{token: string}|{error: 'no-password'}|{error: 'locked', retryAt: number}|{error: 'wrong-password', triesLeft: number}>}
     */
    async tryPassword(password) {
      if (!state.password) return { error: 'no-password' };
      if (lockedUntil > now()) return { error: 'locked', retryAt: lockedUntil };
      const ok = isSyncPassword(password) && sameText(await scryptHex(password, state.password.salt), state.password.hash);
      if (!ok) {
        failures += 1;
        if (failures >= PASSWORD_MAX_TRIES) { failures = 0; lockedUntil = now() + PASSWORD_LOCK_MS; return { error: 'locked', retryAt: lockedUntil }; }
        return { error: 'wrong-password', triesLeft: PASSWORD_MAX_TRIES - failures };
      }
      failures = 0;
      const token = makeToken();
      state = { ...state, devices: [...state.devices, { hash: hash(token), pairedAt: now() }].slice(-MAX_DEVICES) };
      await save();
      return { token };
    },
    /** Vrai si le jeton est celui d'un téléphone associé. */
    isValidToken(token) {
      if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return false;
      const h = hash(token);
      return state.devices.some((d) => sameText(d.hash, h));
    },
    /** Oublie tous les téléphones (ils devront saisir de nouveau le mot de passe). */
    async forgetDevices() {
      state = { ...state, devices: [] };
      await save();
    },
  };
}
