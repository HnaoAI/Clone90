// Point d'entrée de index.html (T5) : charge les données, branche le routeur et la couche d'entrée sur l'écran courant.
// Dépend de data, folders-client, router, screens, input/*, ui/*. Seul module qui touche à la page entière ; la logique est dans screens.js et ui/.
// Contrat d'un écran : il rend dans #screen des éléments `data-nav` ; `current.onBack` (facultatif) traite l'action retour.
// T27 : écran « Mes fichiers » (#/fichiers) ; après un ajout ou une suppression, les données sont rechargées (reload) sans recharger la page.
import { loadData, groupGamesBySystem } from './data.js';
import { loadLocalGames } from './local-games.js';
import { openLocalLibrary, canUseLocalLibrary, romStoragePath, biosStoragePath, requestPersistentStorage } from './local-library.js';
import { renderLibrary, pickFiles, describeImport, addGamesNavId, ADD_BIOS_NAV_ID, LIBRARY_BACK_NAV_ID } from './ui/library-screen.js';
import { createRouter } from './router.js';
import { createActionSource } from './input/actions.js';
import { createFocusNavigator } from './input/focus-nav.js';
import { visibleSystems, resolveRoute } from './screens.js';
import { buildMachineTiles, renderHome, FOLDERS_NAV_ID } from './ui/machine-grid.js';
import { fetchFolderSettings, requestFolderChoice, requestCoversDownload, fetchCoversStatus } from './folders-client.js';
import { createFoldersPanel } from './ui/folders-panel.js';
import { renderGameGrid, initialFocusId, EMPTY_NAV_ID, ADD_LOCAL_NAV_ID } from './ui/game-grid.js';
import { renderFatalError } from './ui/error-screen.js';
import { createToast } from './ui/toast.js';
import { clear } from './ui/dom.js';
import { setGamepadMode, watchPointer } from './ui/input-mode.js';
import { registerServiceWorker } from './pwa.js';

const screen = document.getElementById('screen');
const toast = createToast(document.getElementById('toast'));

watchPointer();

const localSupported = canUseLocalLibrary(window);
const loadAll = () => loadData(undefined, localSupported ? (systems) => loadLocalGames(systems) : null);

async function main() {
  let data;
  try {
    data = await loadAll();
  } catch (e) {
    console.error('Chargement de systems.json impossible :', e.cause ?? e);
    screen.append(renderFatalError(e.message));
    createFocusNavigator({ getRoot: () => screen }).focusFirst();
    return;
  }
  let systems;
  let gamesBySystem;
  const applyData = (loaded) => {
    data = loaded;
    systems = visibleSystems(data.systems, data.games);
    gamesBySystem = groupGamesBySystem(systems, data.games);
  };
  applyData(data);
  // T25 : le bouton « Dossiers des jeux » n'existe que si l'API locale répond (jamais sur GitHub Pages ni en mode réseau).
  let folderSettings = await fetchFolderSettings();
  let foldersPanel = null;
  const nav = createFocusNavigator({ getRoot: () => screen });
  const router = createRouter(window);
  let current = {};
  let lastSystem = null;
  let libraryBusy = false;

  /** Relit games.json et la bibliothèque locale (T27, après un ajout ou une suppression). Garde les données d'avant en cas d'échec. */
  async function reload() {
    try {
      applyData(await loadAll());
    } catch (e) { console.error('Rechargement impossible :', e.cause ?? e); }
  }

  function showHome() {
    clear(screen);
    const tiles = buildMachineTiles(systems, gamesBySystem);
    screen.append(renderHome({
      tiles, gamesStatus: data.gamesStatus, skipped: data.skipped, localSupported, onOpenFolders: folderSettings ? openFolders : undefined,
    }));
    current = {};
    if (lastSystem) nav.focusById(lastSystem); // retour d'une grille : le focus revient sur la machine quittée
  }

  /** Écran « Mes fichiers » (T27). `focusId` : bouton à refocaliser après un nouveau rendu. */
  async function showLibrary(machine, focusId = null) {
    let entries = [];
    let library = null;
    if (localSupported) {
      try { library = await openLocalLibrary(); entries = await library.list(); } catch (e) { console.error('Bibliothèque locale illisible :', e); }
    }
    const render = (focus) => {
      clear(screen);
      screen.append(renderLibrary({
        systems: data.systems, entries, supported: Boolean(library), machine, busy: libraryBusy,
        onAddGames: (systemId) => importFiles((file) => ({ path: romStoragePath(systemId, file.name) }), addGamesNavId(systemId)),
        onAddBios: () => importFiles((file) => biosStoragePath(file.name, data.systems), ADD_BIOS_NAV_ID),
        onRemove: async (path) => {
          if (!window.confirm(`Supprimer ${path.split('/').pop()} de cet appareil ?`)) return;
          try { await library.remove(path); toast('Fichier supprimé'); } catch { toast('Suppression impossible'); }
          await reload();
          showLibrary(machine, LIBRARY_BACK_NAV_ID);
        },
      }));
      if (focus) nav.focusById(focus);
    };
    /** Copie les fichiers choisis dans la bibliothèque. `target(file)` : {path, known?} ou null (nom inutilisable). */
    async function importFiles(target, returnFocus) {
      const files = await pickFiles(document);
      if (!files.length) return;
      libraryBusy = true;
      render(null);
      const result = { added: 0, rejected: 0, unknownBios: [] };
      try {
        for (const file of files) {
          const t = target(file);
          if (!t?.path) { result.rejected += 1; continue; }
          await library.put(t.path, file);
          result.added += 1;
          if (t.known === false) result.unknownBios.push(file.name);
        }
        requestPersistentStorage();
        toast(describeImport(result));
      } catch (e) {
        console.error('Copie impossible :', e);
        toast(`${describeImport(result)}. Copie interrompue : plus assez de place sur l'appareil ?`);
      } finally {
        libraryBusy = false;
      }
      await reload();
      showLibrary(machine, returnFocus);
    }
    render(focusId ?? (machine ? addGamesNavId(machine) : LIBRARY_BACK_NAV_ID));
    current = { onBack: () => router.navigate({ name: 'home' }) };
  }

  /** Après un choix de dossier réussi : recharge games.json et redessine l'accueil (le panneau reste ouvert par-dessus). */
  async function reloadGames() {
    await reload();
    showHome();
  }

  /** Fin d'un téléchargement de pochettes (T28), panneau ouvert ou fermé : une seule fois par travail (`state.id`), même si deux panneaux l'ont suivi. */
  let lastCoversJob = null;
  async function onCoversDone(state) {
    if (state.id !== undefined && state.id === lastCoversJob) return;
    lastCoversJob = state.id;
    if (state.status === 'done' && state.found > 0) { // l'utilisateur a pu quitter l'accueil : on recharge les données, on ne redessine l'accueil que s'il est affiché
      await reload();
      if (screen.querySelector('.home')) showHome();
    }
    toast(state.status === 'done' ? state.lines[0] : state.message);
  }

  async function openFolders() {
    folderSettings = (await fetchFolderSettings()) ?? folderSettings; // valeurs fraîches ; si le serveur ne répond plus, les précédentes
    const coversRunning = (await fetchCoversStatus())?.status === 'running'; // T28 : un téléchargement lancé avant la fermeture du panneau continue
    foldersPanel = createFoldersPanel({
      settings: folderSettings, choose: (kind) => requestFolderChoice(kind), onChanged: reloadGames,
      covers: { start: () => requestCoversDownload(), status: () => fetchCoversStatus() }, coversRunning, onCoversDone,
    });
    foldersPanel.open(document.body);
    await foldersPanel.result;
    foldersPanel = null;
    nav.focusById(FOLDERS_NAV_ID); // le bouton a été recréé par le rechargement : on lui rend le focus
  }

  function showGameGrid(machine, focus) {
    clear(screen);
    lastSystem = machine.id;
    const games = gamesBySystem.get(machine.id) ?? [];
    screen.append(renderGameGrid({ machine, games, localSupported }));
    current = { onBack: () => router.navigate({ name: 'home' }) };
    window.scrollTo(0, 0);
    // Focus sur le jeu quitté (?focus=), sinon le 1er jeu, sinon (état vide) le bouton "Revenir aux machines".
    nav.focusById(initialFocusId(games, focus) ?? (localSupported ? ADD_LOCAL_NAV_ID : EMPTY_NAV_ID)); // T27 : sur téléphone, le bouton d'ajout
  }

  function onRoute(route) {
    const target = resolveRoute(route, systems);
    if (target.name === 'library') { window.scrollTo(0, 0); showLibrary(target.machine); return; }
    if (target.name === 'home') {
      if (route.name !== 'home') { location.replace('#/'); return; } // route inconnue : on réécrit le hash sans polluer l'historique
      showHome();
    } else {
      showGameGrid(target.machine, target.focus);
    }
  }

  const actions = createActionSource({
    hasFocusedTarget: nav.hasFocus,
    onWake: () => {
      setGamepadMode(true);
      toast('Manette connectée');
      if (!foldersPanel && !screen.contains(document.activeElement)) nav.focusFirst();
    },
  });
  actions.start((action, source) => {
    setGamepadMode(source === 'gamepad');
    if (foldersPanel?.handleAction(action)) return; // le panneau ouvert capte toutes les actions
    if (action === 'back') current.onBack?.();
    else nav.handleAction(action);
  });
  router.start(onRoute);
}

main();
registerServiceWorker(); // T8 : hors ligne et installation ; sans effet hors HTTPS/localhost
