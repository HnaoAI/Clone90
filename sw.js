// Service worker de Clone90 (T8) : met en cache la COQUILLE de l'application seulement, pour l'installer et l'ouvrir hors ligne.
// Fichier classique (pas un module : Firefox et d'anciens Safari ne gèrent pas les service workers en module).
// Les fonctions pures sont exposées dans `self.Clone90SW` pour être testées sous Node (tests/sw.test.mjs, via node:vm).
// INVARIANT (CLAUDE.md règle 6) : JAMAIS de roms/, bios/, games.json, api/ (T25) ni de ressource d'une autre origine (CDN EmulatorJS)
// dans le cache. games.json, api/ et le CDN vont directement au réseau.
// T27 (jouer sur téléphone sans le Mac) : une requête GET ou HEAD vers roms/ ou bios/ est d'abord cherchée dans la bibliothèque locale
// (IndexedDB `clone90-local`, fichiers que la personne a choisis sur son appareil, voir js/local-library.js) ; absente, elle part au réseau
// telle quelle (Mac : rien ne change). Ces réponses ne sont JAMAIS écrites dans le cache (Cache Storage) : rien n'est téléchargé ni copié.
// Décision (architecture 8.4) : EmulatorJS garde lui-même ses cœurs en cache navigateur ; le CDN n'est pas pris en charge ici.
// INVARIANT : tout fichier de js/, css/ ou assets/icons/ ou assets/fonts/ doit figurer dans SHELL_FILES (les logos de assets/logos/ viennent de systems.json, voir logoPaths) (vérifié par tests/sw.test.mjs).
// Nom du cache (T16) : `clone90-shell-v<APP_VERSION>`. La version vient de js/version.js (source unique) par l'adresse d'enregistrement
// `sw.js?v=<version>` (js/pwa.js) : un script classique ne peut pas importer un module ES. Relever APP_VERSION à chaque livraison suffit donc
// à renouveler le cache (l'activation supprime les anciens caches) et à faire détecter une nouvelle version du service worker par le navigateur.
// Chemins relatifs à la portée du service worker (GitHub Pages sous /<dépôt>/).
const CACHE_PREFIX = 'clone90-shell-';

/** Version lue dans l'adresse du script (`?v=`). Seuls chiffres, lettres, point et tiret sont admis ; sinon 'dev'. */
function versionFromScriptSearch(search) {
  const value = /[?&]v=([^&#]*)/.exec(search ?? '')?.[1];
  return value && /^[0-9A-Za-z.-]{1,32}$/.test(value) ? value : 'dev';
}
const CACHE_VERSION = `${CACHE_PREFIX}v${versionFromScriptSearch(self.location?.search)}`;

const SHELL_FILES = [
  './', 'index.html', 'player.html', 'manifest.webmanifest', 'systems.json',
  'css/base.css', 'css/home.css', 'css/grid.css', 'css/library.css', 'css/player.css',
  'js/app.js', 'js/config.js', 'js/data.js', 'js/folders-client.js', 'js/router.js', 'js/screens.js', 'js/sort.js', 'js/version.js',
  'js/games-builder.js', 'js/posix-path.js', 'js/local-library.js', 'js/local-games.js', 'js/link-finder.js', 'js/link-explorer.js', 'js/link-download.js', 'js/update-check.js',
  'js/input/actions.js', 'js/input/focus-nav.js',
  'js/ui/dialog.js', 'js/ui/dom.js', 'js/ui/error-screen.js', 'js/ui/folders-panel.js', 'js/ui/format.js', 'js/ui/game-grid.js',
  'js/ui/input-mode.js', 'js/ui/library-screen.js', 'js/ui/link-screen.js', 'js/ui/update-dialog.js', 'js/ui/logo.js', 'js/ui/machine-grid.js', 'js/ui/toast.js',
  'js/player/diagnostic-log.js', 'js/player/diagnostic-panel.js', 'js/player/disk-shortcut.js', 'js/player/ejs-start-watch.js', 'js/player/exit-guard.js', 'js/player/exit-hint.js', 'js/player/game-scale.js', 'js/player/launcher.js', 'js/player/player-main.js', 'js/player/player-ui.js', 'js/player/retroarch-cfg.js', 'js/player/virtual-stick.js',
  'js/pwa.js',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-192-maskable.png', 'assets/icons/icon-512-maskable.png',
  'assets/fonts/PressStart2P-Regular.ttf', 'assets/fonts/OFL.txt',
];

/**
 * Options du fetch réseau de la coquille (T28, mise à jour sur téléphone). GitHub Pages sert avec Cache-Control: max-age=600 :
 * un fetch simple pouvait rendre l'ancienne version depuis le cache HTTP du navigateur jusqu'à 10 minutes après une livraison
 * (Hicham restait en 0.27 sur son téléphone). no-cache revalide toujours auprès du serveur (304 si rien n'a changé, donc peu coûteux).
 */
const NETWORK_FETCH_INIT = { cache: 'no-cache' };

/** Dossiers et fichiers qui ne doivent JAMAIS entrer dans le cache (jeux, BIOS, liste des jeux, API locale). */
const NEVER_CACHED = ['roms/', 'bios/', 'games.json', 'api/']; // api/ (T25) : API locale des dossiers, toujours au réseau

/** Chemin de `url` relatif à `scope`, sans paramètres ni ancre ; null si autre origine ou hors portée. */
function scopedPath(url, scope) {
  const u = new URL(url);
  const s = new URL(scope);
  if (u.origin !== s.origin || !u.pathname.startsWith(s.pathname)) return null;
  return decodeURIComponent(u.pathname.slice(s.pathname.length));
}

/** Vrai si ce chemin relatif est interdit de cache (roms/, bios/, games.json, à n'importe quel niveau de la liste). */
function isNeverCached(path) {
  return NEVER_CACHED.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p));
}

/** Vrai si le chemin relatif appartient à la coquille ('' = la racine, servie par index.html). */
function isShellPath(path, logos = []) {
  if (isNeverCached(path)) return false;
  const normalized = path === '' ? './' : path;
  return SHELL_FILES.includes(normalized) || logos.includes(normalized);
}

/** Filtre de cache : cette requête (méthode, URL) peut-elle être servie ou stockée par le service worker ? */
function shouldHandle(method, url, scope, logos = []) {
  if (method !== 'GET') return false;
  const path = scopedPath(url, scope);
  return path !== null && isShellPath(path, logos);
}

/** Chemins des logos déclarés dans systems.json (source unique des machines) : ajoutés à la coquille s'ils existent. */
function logoPaths(systemsJson) {
  const systems = Array.isArray(systemsJson?.systems) ? systemsJson.systems : [];
  return systems.map((s) => s?.logo).filter((p) => typeof p === 'string' && p && !p.startsWith('/') && !p.includes('..') && !p.includes(':') && !isNeverCached(p));
}

/** Noms de caches de Clone90 à supprimer (anciennes versions). Les caches d'autres applications restent intacts. */
const staleCacheNames = (names, current = CACHE_VERSION) => names.filter((n) => n.startsWith(CACHE_PREFIX) && n !== current);

/** Base de la bibliothèque locale (T27). INVARIANT : identique à LOCAL_DB de js/local-library.js (tests/local-library.test.mjs). */
const LOCAL_DB = { name: 'clone90-local', version: 1, store: 'files' };

/** Dossiers servis depuis la bibliothèque locale quand le fichier y est (T27). */
const LOCAL_PREFIXES = ['roms/', 'bios/'];

/** Chemin à chercher dans la bibliothèque locale pour cette requête (GET ou HEAD vers roms/ ou bios/ dans la portée), sinon null. */
function localLibraryPath(method, url, scope) {
  if (method !== 'GET' && method !== 'HEAD') return null;
  let path;
  try { path = scopedPath(url, scope); } catch { return null; }
  return path !== null && LOCAL_PREFIXES.some((p) => path.startsWith(p)) && !path.split('/').includes('..') ? path : null;
}

/** En-têtes de la réponse d'un fichier local : type générique (comme le serveur local pour une ROM) et taille. */
function localResponseInit(record) {
  return { status: 200, headers: { 'Content-Type': record.blob?.type || 'application/octet-stream', 'Content-Length': String(record.size ?? record.blob?.size ?? 0), 'Cache-Control': 'no-store' } };
}

self.Clone90SW = { CACHE_VERSION, NETWORK_FETCH_INIT, SHELL_FILES, NEVER_CACHED, LOCAL_DB, LOCAL_PREFIXES, scopedPath, isNeverCached, isShellPath, shouldHandle, logoPaths, staleCacheNames, localLibraryPath, localResponseInit };

if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
  const scope = () => self.registration.scope;
  const toUrl = (file) => new URL(file, scope()).href;
  let logos = [];

  /** Logos de systems.json, lus à l'installation et à chaque requête réseau réussie de systems.json. */
  async function readLogos() {
    try {
      const res = await fetch(toUrl('systems.json'), { cache: 'no-cache' });
      return res.ok ? logoPaths(await res.json()) : [];
    } catch { return []; }
  }

  self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
      const cache = await caches.open(CACHE_VERSION);
      await cache.addAll(SHELL_FILES.map((f) => new Request(toUrl(f), { cache: 'reload' })));
      logos = await readLogos();
      // Les logos sont facultatifs (le visuel de repli existe) : un logo absent n'empêche pas l'installation.
      await Promise.all(logos.map((l) => cache.add(new Request(toUrl(l), { cache: 'reload' })).catch(() => {})));
      await self.skipWaiting();
    })());
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
      await Promise.all(staleCacheNames(await caches.keys()).map((n) => caches.delete(n)));
      logos = await readLogos();
      await self.clients.claim();
    })());
  });

  /** Ouvre la bibliothèque locale (même création de magasin que js/local-library.js). Rejet si IndexedDB est indisponible. */
  const openLocalDb = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(LOCAL_DB.name, LOCAL_DB.version);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(LOCAL_DB.store)) request.result.createObjectStore(LOCAL_DB.store, { keyPath: 'path' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  /** Enregistrement local de `path`, ou null (absent, ou base illisible : on retombe alors sur le réseau). */
  async function readLocal(path) {
    try {
      const db = await openLocalDb();
      try {
        return await new Promise((resolve, reject) => {
          const request = db.transaction(LOCAL_DB.store, 'readonly').objectStore(LOCAL_DB.store).get(path);
          request.onsuccess = () => resolve(request.result ?? null);
          request.onerror = () => reject(request.error);
        });
      } finally { db.close(); }
    } catch { return null; }
  }

  // Réseau d'abord, cache en secours : le développeur et le joueur voient toujours la dernière version quand le réseau répond.
  self.addEventListener('fetch', (event) => {
    const { request } = event;
    const localPath = localLibraryPath(request.method, request.url, scope());
    if (localPath !== null) { // T27 : fichier importé sur cet appareil, sinon réseau ; jamais de cache
      event.respondWith((async () => {
        const record = await readLocal(localPath);
        if (!record?.blob) return fetch(request);
        return new Response(request.method === 'HEAD' ? null : record.blob, localResponseInit(record));
      })());
      return;
    }
    if (!shouldHandle(request.method, request.url, scope(), logos)) return; // pas de respondWith : réseau direct, rien en cache
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        const res = await fetch(request, NETWORK_FETCH_INIT);
        if (res.ok) await cache.put(request.url.split('#')[0].split('?')[0], res.clone());
        return res;
      } catch {
        const cached = await cache.match(request, { ignoreSearch: true });
        if (cached) return cached;
        throw new Error('Hors ligne et fichier absent du cache');
      }
    })());
  });
}
