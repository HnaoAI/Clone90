// Appairage des téléphones pour le partage Mac -> téléphone (T43) : code à 6 chiffres affiché sur le Mac, jeton remis au téléphone qui
// donne le bon code, liste des téléphones associés. État gardé dans `clone90.sync.json` (ignoré par git) : partage activé ou non, et
// EMPREINTES (SHA-256) des jetons, jamais les jetons eux-mêmes.
// INVARIANT (sécurité) : un code n'existe que si la personne l'a demandé sur le Mac, vaut 5 minutes et PAIRING_MAX_TRIES essais en tout
//   (au-delà il est annulé) ; un code accepté est aussitôt annulé (un seul téléphone par code). Comparaisons à temps constant.
import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';
import { readFile, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { PAIRING_CODE_TTL_MS, PAIRING_MAX_TRIES } from '../js/sync-plan.js';

export const SYNC_STATE_FILE = 'clone90.sync.json';
/** Nombre maximal de téléphones associés (le plus ancien est oublié au-delà). */
export const MAX_DEVICES = 10;

const hash = (token) => createHash('sha256').update(token).digest('hex');
const sameText = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Lit l'état. @returns {Promise<{enabled: boolean, devices: {hash: string, pairedAt: number}[]}>} défaut : partage arrêté, aucun téléphone */
export async function readSyncState(root) {
  try {
    const data = JSON.parse(await readFile(join(root, SYNC_STATE_FILE), 'utf8'));
    const devices = Array.isArray(data?.devices)
      ? data.devices.filter((d) => d && /^[0-9a-f]{64}$/.test(d.hash) && Number.isFinite(d.pairedAt)).slice(-MAX_DEVICES) : [];
    return { enabled: data?.enabled === true, devices };
  } catch {
    return { enabled: false, devices: [] };
  }
}

/** Écrit l'état (fichier temporaire puis renommage : jamais de fichier à moitié écrit). */
export async function writeSyncState(root, state) {
  const target = join(root, SYNC_STATE_FILE);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, `${JSON.stringify({ enabled: state.enabled, devices: state.devices }, null, 2)}\n`, { mode: 0o600 });
  await rename(tmp, target);
}

/**
 * Appairage en mémoire, adossé au fichier d'état.
 * @param {{root: string, now?: () => number, makeCode?: () => string, makeToken?: () => string}} options injectables pour les tests
 */
export async function createPairing({ root, now = Date.now, makeCode = () => String(randomInt(0, 1000000)).padStart(6, '0'),
  makeToken = () => randomBytes(32).toString('hex') }) {
  let state = await readSyncState(root);
  let code = null; // {value, expiresAt, tries}
  const save = () => writeSyncState(root, state);
  const liveCode = () => (code && code.expiresAt > now() && code.tries < PAIRING_MAX_TRIES ? code : null);
  return {
    get enabled() { return state.enabled; },
    get deviceCount() { return state.devices.length; },
    async setEnabled(enabled) {
      state = { ...state, enabled };
      if (!enabled) code = null;
      await save();
    },
    /** Nouveau code (l'ancien est annulé). @returns {{value: string, expiresAt: number}} */
    newCode() {
      code = { value: makeCode(), expiresAt: now() + PAIRING_CODE_TTL_MS, tries: 0 };
      return { value: code.value, expiresAt: code.expiresAt };
    },
    /** Code en cours, null s'il n'y en a pas (expiré, trop d'essais, déjà utilisé). */
    currentCode() {
      const c = liveCode();
      return c ? { value: c.value, expiresAt: c.expiresAt } : null;
    },
    /**
     * Essai d'un code venant du réseau.
     * @returns {Promise<{token: string}|{error: 'no-code'|'wrong-code'}>}
     */
    async tryCode(value) {
      const c = liveCode();
      if (!c) return { error: 'no-code' };
      c.tries += 1;
      if (!sameText(value, c.value)) return { error: 'wrong-code' };
      code = null;
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
    /** Oublie tous les téléphones (ils devront être associés de nouveau). */
    async forgetDevices() {
      state = { ...state, devices: [] };
      code = null;
      await save();
    },
  };
}
