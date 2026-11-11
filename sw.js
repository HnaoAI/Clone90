// Service worker de Clone90 (T8) : met en cache la COQUILLE de l'application seulement, pour l'installer et l'ouvrir hors ligne.
// Fichier classique (pas un module : Firefox et d'anciens Safari ne gèrent pas les service workers en module).
// Les fonctions pures sont exposées dans `self.Clone90SW` pour être testées sous Node (tests/sw.test.mjs, via node:vm).
// INVARIANT (CLAUDE.md règle 6) : JAMAIS de roms/, bios/, games.json ni de ressource d'une autre origine (CDN EmulatorJS)
// dans le cache. Le service worker ne répond même pas à ces requêtes : elles vont directement au réseau.
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
  'css/base.css', 'css/home.css', 'css/grid.css', 'css/player.css',
  'js/app.js', 'js/config.js', 'js/data.js', 'js/router.js', 'js/screens.js', 'js/sort.js', 'js/version.js',
  'js/input/actions.js', 'js/input/focus-nav.js',
  'js/ui/dialog.js', 'js/ui/dom.js', 'js/ui/error-screen.js', 'js/ui/format.js', 'js/ui/game-grid.js',
  'js/ui/input-mode.js', 'js/ui/logo.js', 'js/ui/machine-grid.js', 'js/ui/toast.js',
  'js/player/diagnostic-log.js', 'js/player/diagnostic-panel.js', 'js/player/disk-shortcut.js', 'js/player/ejs-start-watch.js', 'js/player/exit-guard.js', 'js/player/exit-hint.js', 'js/player/launcher.js', 'js/player/player-main.js', 'js/player/player-ui.js', 'js/player/retroarch-cfg.js',
  'js/pwa.js',
  'assets/icons/icon-192.png', 'assets/icons/icon-512.png', 'assets/icons/icon-192-maskable.png', 'assets/icons/icon-512-maskable.png',
  'assets/fonts/PressStart2P-Regular.ttf', 'assets/fonts/OFL.txt',
];

/** Dossiers et fichiers qui ne doivent JAMAIS entrer dans le cache (jeux, BIOS, liste des jeux). */
const NEVER_CACHED = ['roms/', 'bios/', 'games.json'];

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

self.Clone90SW = { CACHE_VERSION, SHELL_FILES, NEVER_CACHED, scopedPath, isNeverCached, isShellPath, shouldHandle, logoPaths, staleCacheNames };

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

  // Réseau d'abord, cache en secours : le développeur et le joueur voient toujours la dernière version quand le réseau répond.
  self.addEventListener('fetch', (event) => {
    const { request } = event;
    if (!shouldHandle(request.method, request.url, scope(), logos)) return; // pas de respondWith : réseau direct, rien en cache
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      try {
        const res = await fetch(request);
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
