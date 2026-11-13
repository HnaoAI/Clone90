// Mises à jour (T35) : numéro de version, comparaison, et deux sources avec la même interface `check()` / `apply(onStep)`.
// - Mac (`createMacUpdateSource`) : le serveur local lit la dernière version sur github.com et fait `git pull` (scripts/updater.mjs, api/update...),
//   puis redémarre ; on attend que js/version.js serve la nouvelle version avant de recharger.
// - Navigateur (`createBrowserUpdateSource`, site Pages, téléphone) : compare la version du site (js/version.js relu au réseau) à celle chargée ;
//   « appliquer » = recharger la page (le service worker sert le réseau d'abord, sw.js).
// Fonctions pures partagées avec scripts/updater.mjs (parseAppVersion, compareVersions). fetch et attente injectables.
import { APP_VERSION } from './version.js';

const VERSION_URL = 'js/version.js';
const POLL_MS = 1000;
/** Délai maximal d'attente du serveur relancé (pull + redémarrage). */
export const RESTART_TIMEOUT_MS = 90_000;

/** Numéro x.y.z lu dans le texte de js/version.js, ou null. */
export function parseAppVersion(text) {
  return /export const APP_VERSION = '(\d+\.\d+\.\d+)'/.exec(String(text ?? ''))?.[1] ?? null;
}

/** Compare deux versions x.y.z : négatif si a < b, 0 si égales, positif si a > b. */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Version servie en ce moment (js/version.js, jamais du cache HTTP), ou null si illisible. */
async function servedVersion(fetchFn) {
  try {
    const res = await fetchFn(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
    return res.ok ? parseAppVersion(await res.text()) : null;
  } catch { return null; }
}

/**
 * Source du Mac.
 * @param {{fetchFn?: typeof fetch, wait?: Function, now?: () => number}} [options]
 * @returns {{kind: 'mac', check: () => Promise<object>, apply: (onStep?: Function) => Promise<{status: 'ready'} | {status: 'error', message: string}>}}
 *   check -> {status: 'uptodate'|'available'|'error', current?, latest?, canApply?, message?} ; onStep('updating'|'restarting')
 */
export function createMacUpdateSource({ fetchFn = globalThis.fetch, wait = sleep, now = Date.now } = {}) {
  const post = (path) => fetchFn(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Clone90': '1' }, body: '{}' });
  return {
    kind: 'mac',
    async check() {
      try {
        const body = await (await post('api/update/check')).json();
        return isObject(body) && ['uptodate', 'available', 'error'].includes(body.status) ? body : { status: 'error', message: 'Réponse inattendue.' };
      } catch { return { status: 'error', message: 'Impossible de joindre Clone90.' }; }
    },
    async apply(onStep = () => {}) {
      let started;
      try { const res = await post('api/update/apply'); started = { status: res.status, body: await res.json().catch(() => null) }; } catch {
        return { status: 'error', message: 'Impossible de joindre Clone90.' };
      }
      if (started.status !== 202) return { status: 'error', message: started.body?.message || 'Impossible de lancer la mise à jour.' };
      onStep('updating');
      let version = null;
      for (;;) {
        let state = null;
        try { const res = await fetchFn('api/update', { cache: 'no-store' }); state = res.ok ? await res.json() : null; } catch { state = null; }
        if (isObject(state) && state.status === 'error') return { status: 'error', message: state.message };
        if (isObject(state) && state.status === 'done') { version = state.version; break; }
        if (!isObject(state) || state.status === 'idle') break; // serveur déjà en train de redémarrer
        await wait(POLL_MS);
      }
      onStep('restarting');
      const deadline = now() + RESTART_TIMEOUT_MS;
      while (now() < deadline) {
        const served = await servedVersion(fetchFn);
        if (served && (version ? served === version : compareVersions(served, APP_VERSION) > 0)) return { status: 'ready' };
        await wait(POLL_MS);
      }
      return { status: 'error', message: 'Clone90 ne répond plus après la mise à jour. Relance Clone90.' };
    },
  };
}

/**
 * Source du navigateur : version du site comparée à celle chargée.
 * @param {{fetchFn?: typeof fetch, current?: string}} [options]
 */
export function createBrowserUpdateSource({ fetchFn = globalThis.fetch, current = APP_VERSION } = {}) {
  return {
    kind: 'browser',
    async check() {
      const latest = await servedVersion(fetchFn);
      if (!latest) return { status: 'error', message: 'Version du site illisible.' };
      return compareVersions(latest, current) > 0 ? { status: 'available', current, latest, canApply: true } : { status: 'uptodate', current };
    },
    async apply() { return { status: 'ready' }; },
  };
}
