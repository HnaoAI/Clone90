// Sources de l'écran « Télécharger depuis une page » (T34) : même interface `scan(url)` / `download(items, onProgress)` pour les deux cas.
// - Mac (`createMacLinkSource`) : le serveur local lit la page et télécharge (scripts/link-relay.mjs, via api/links...). Aucun chemin envoyé.
// - Navigateur (`createBrowserLinkSource`, téléphone, GitHub Pages) : le navigateur lit lui-même, ce qui ne marche que si le site l'autorise
//   (CORS) ; les fichiers vont dans « Mes fichiers » (local-library.js). Sinon, message clair qui renvoie vers le Mac.
// Dépend de link-finder.js et local-library.js. fetch, attente et bibliothèque injectables pour les tests.
// INVARIANT (CLAUDE.md règle 5) : aucune connexion sans action de la personne ; seule l'adresse qu'elle a donnée (et les fichiers qu'elle a cochés) est lue.
import { findDownloadableFiles, checkDownloadItem, checkPageAddress, formatLinksSummary } from './link-finder.js';
import { romStoragePath } from './local-library.js';
import { BIOS_DIR } from './config.js';

const UNREACHABLE_TEXT = 'Impossible de joindre Clone90. Le serveur est-il toujours lancé ?';
export const BLOCKED_TEXT = 'Ce site ne se laisse pas lire depuis un navigateur (ou il ne répond pas). Fais-le depuis Clone90 sur le Mac : '
  + 'les jeux seront ensuite jouables depuis ce téléphone sur le réseau local.';
const POLL_MS = 1000;
/** Taille maximale d'une page lue par le navigateur (même limite que le relais du Mac). */
const MAX_PAGE_CHARS = 2 * 1024 * 1024;
/** Taille maximale d'un fichier gardé dans le navigateur. */
const MAX_FILE_BYTES = 1024 * 1024 * 1024;
/** Options de lecture : jamais de cookie ni de référent envoyé au site. */
const FETCH_INIT = { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store' };

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * Source du Mac (serveur local, API active).
 * @param {{fetchFn?: typeof fetch, wait?: (ms: number) => Promise<void>}} [options]
 * @returns {{kind: 'mac', scan: Function, download: Function}}
 *   scan(url) -> {status: 'ok', url, files, truncated} | {status: 'error', message} ;
 *   download(items, onProgress) -> {status: 'done', found, lines} | {status: 'error', message} ; ne lèvent jamais d'exception
 */
export function createMacLinkSource({ fetchFn = globalThis.fetch, wait = sleep } = {}) {
  const post = (path, body) => fetchFn(path, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Clone90': '1' }, body: JSON.stringify(body) });
  return {
    kind: 'mac',
    async scan(url) {
      try {
        const res = await post('api/links/scan', { url });
        const body = await res.json().catch(() => null);
        if (isObject(body) && body.status === 'ok' && Array.isArray(body.files)) return body;
        if (isObject(body) && typeof body.message === 'string') return { status: 'error', message: body.message };
        return { status: 'error', message: 'La page n\'a pas pu être analysée.' };
      } catch { return { status: 'error', message: UNREACHABLE_TEXT }; }
    },
    async download(items, onProgress = () => {}) {
      let started;
      try {
        const res = await post('api/links/download', { items });
        started = { status: res.status, body: await res.json().catch(() => null) };
      } catch { return { status: 'error', message: UNREACHABLE_TEXT }; }
      if (started.status !== 202) return { status: 'error', message: started.body?.message || 'Impossible de lancer le téléchargement.' };
      for (;;) {
        let state = null;
        try { const res = await fetchFn('api/links', { cache: 'no-store' }); state = res.ok ? await res.json() : null; } catch { state = null; }
        if (!isObject(state)) return { status: 'error', message: UNREACHABLE_TEXT };
        if (state.status === 'done') return { status: 'done', found: state.found, lines: state.lines };
        if (state.status === 'error') return { status: 'error', message: state.message };
        if (state.status === 'idle') return { status: 'error', message: 'Le téléchargement s\'est arrêté.' };
        onProgress(state.progress ?? {});
        await wait(POLL_MS);
      }
    },
  };
}

/**
 * Source du navigateur (téléphone) : lecture directe, fichiers rangés dans la bibliothèque locale.
 * @param {{systems: object[], openLibrary: () => Promise<{put: Function, list: Function}>, fetchFn?: typeof fetch}} options
 * @returns {{kind: 'browser', scan: Function, download: Function}} même contrat que createMacLinkSource ; scan peut aussi renvoyer {status: 'blocked', message}
 */
export function createBrowserLinkSource({ systems, openLibrary, fetchFn = globalThis.fetch }) {
  return {
    kind: 'browser',
    async scan(text) {
      const checked = checkPageAddress(text);
      if (!checked.ok) return { status: 'error', message: checked.message };
      let res;
      // Une page refusée par CORS et un site injoignable donnent la même TypeError : le navigateur ne dit pas lequel (sécurité).
      try { res = await fetchFn(checked.url, FETCH_INIT); } catch { return { status: 'blocked', message: BLOCKED_TEXT }; }
      if (!res.ok) return { status: 'error', message: `Le site a répondu « erreur ${res.status} ».` };
      const html = await res.text().catch(() => '');
      if (html.length > MAX_PAGE_CHARS) return { status: 'error', message: 'Cette page est trop grande pour être analysée.' };
      const url = res.url || checked.url;
      return { status: 'ok', url, ...findDownloadableFiles(html, url, systems) };
    },
    async download(items, onProgress = () => {}) {
      let library;
      try { library = await openLibrary(); } catch { return { status: 'error', message: 'Ce navigateur ne peut pas garder de fichiers.' }; }
      const present = new Set((await library.list()).map((e) => e.path));
      const summary = { downloaded: [], present: [], failed: [] };
      for (const [i, item] of items.entries()) {
        const checked = checkDownloadItem(item, systems);
        const label = checked.ok ? `${checked.target}/${checked.name}` : String(item?.url ?? '?').split('/').pop();
        onProgress({ phase: 'downloading', done: i, total: items.length, name: label });
        if (!checked.ok) { summary.failed.push({ name: label, message: checked.message }); continue; }
        const path = checked.target === 'bios' ? `${BIOS_DIR}/${checked.name}` : romStoragePath(checked.target, checked.name);
        if (!path) { summary.failed.push({ name: label, message: 'Nom de fichier illisible.' }); continue; }
        if (present.has(path)) { summary.present.push(label); continue; }
        try {
          const res = await fetchFn(checked.url, FETCH_INIT);
          if (!res.ok) throw new Error(`erreur ${res.status}`);
          const blob = await res.blob();
          if (blob.size > MAX_FILE_BYTES) throw new Error('fichier trop gros');
          await library.put(path, blob);
          present.add(path);
          summary.downloaded.push(label);
        } catch (err) {
          summary.failed.push({ name: label, message: err instanceof TypeError ? 'le site refuse la lecture depuis un navigateur' : err.message });
        }
      }
      onProgress({ phase: 'downloading', done: items.length, total: items.length });
      return { status: 'done', found: summary.downloaded.length, lines: formatLinksSummary(summary) };
    },
  };
}
