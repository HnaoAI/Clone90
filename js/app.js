// Point d'entrée de index.html (T5) : charge les données, branche le routeur et la couche d'entrée sur l'écran courant.
// Dépend de data, folders-client, router, screens, input/*, ui/*. Seul module qui touche à la page entière ; la logique est dans screens.js et ui/.
// Contrat d'un écran : il rend dans #screen des éléments `data-nav` ; `current.onBack` (facultatif) traite l'action retour.
// T27 : écran « Mes fichiers » (#/fichiers) ; après un ajout ou une suppression, les données sont rechargées (reload) sans recharger la page.
// T34 : écran « Depuis une page web » (#/telecharger), source Mac (API locale) si elle répond, sinon navigateur (bibliothèque locale).
// T35 : vérification des mises à jour 5 s après l'ouverture, fenêtre js/ui/update-dialog.js.
// T43 : synchronisation Mac -> téléphone (js/sync-client.js) à l'ouverture et dans « Mes fichiers » ; panneau du partage sur le Mac (ui/sync-panel.js).
// T44 : « Envoyer mes jeux au Mac » dans « Mes fichiers » (sendGamesToMac), au clic seulement.
// T40 : après chaque import de jeux dans « Mes fichiers » (fichiers, dossier, page web) et sur un bouton, pochettes manquantes (local-covers.js) ;
// sur le Mac, pochettes manquantes cherchées sans clic à l'ouverture et après un ajout de jeux par Clone90 (auto-covers.js, décision du 2026-11-15).
// T41 : barre de navigation du bas (ui/bottom-nav.js), rendue une fois dans #app, onglet actif suivi à chaque route.
import { loadData, groupGamesBySystem } from './data.js';
import { formatShortVersionLabel } from './version.js';
import { loadLocalGames } from './local-games.js';
import { openLocalLibrary, canUseLocalLibrary, romStoragePath, biosStoragePath, requestPersistentStorage } from './local-library.js';
import { findLocalCovers, describeCoversResult } from './local-covers.js';
import { findLocalLogos, loadLocalLogos } from './local-logos.js';
import { runAutoCovers, autoCoversToast } from './auto-covers.js';
import { renderLibrary, pickFiles, pickFolder, describeImport, addGamesNavId, ADD_BIOS_NAV_ID, LIBRARY_BACK_NAV_ID, SCAN_FOLDER_NAV_ID, FIND_COVERS_NAV_ID } from './ui/library-screen.js';
import { planFolderImport, summarizePlan, describeFolderImport, folderPickingSupported } from './folder-scan.js';
import { createRouter } from './router.js';
import { createActionSource } from './input/actions.js';
import { createFocusNavigator } from './input/focus-nav.js';
import { visibleSystems, resolveRoute } from './screens.js';
import { buildMachineTiles, renderHome } from './ui/machine-grid.js';
import { renderBottomNav, markActiveTab, activeTabFor, FOLDERS_NAV_ID } from './ui/bottom-nav.js';
import { fetchFolderSettings, requestFolderChoice, requestCoversDownload, fetchCoversStatus, requestLogosDownload, fetchLogosStatus } from './folders-client.js';
import { createFoldersPanel } from './ui/folders-panel.js';
import { createLinkScreen, LINK_INPUT_NAV_ID } from './ui/link-screen.js';
import { createMacLinkSource, createBrowserLinkSource } from './link-download.js';
import { createMacUpdateSource, createBrowserUpdateSource } from './update-check.js';
import { openUpdateDialog } from './ui/update-dialog.js';
import { renderGameGrid, initialFocusId, EMPTY_NAV_ID, ADD_LOCAL_NAV_ID } from './ui/game-grid.js';
import { renderFatalError } from './ui/error-screen.js';
import { createToast } from './ui/toast.js';
import { clear } from './ui/dom.js';
import { setGamepadMode, watchPointer } from './ui/input-mode.js';
import { registerServiceWorker } from './pwa.js';
import { readSyncPairing, pairWithMac, syncFromMac, sendGamesToMac, forgetSyncPairing } from './sync-client.js';
import { createSyncPanel, fetchSyncStatus } from './ui/sync-panel.js';
import { SYNC_NAV } from './ui/sync-section.js';

const screen = document.getElementById('screen');
const toast = createToast(document.getElementById('toast'));

watchPointer();

const localSupported = canUseLocalLibrary(window);
/** T35 : délai avant la vérification des mises à jour, et marque « déjà vérifié dans cet onglet ». */
const UPDATE_CHECK_DELAY_MS = 5000;
const UPDATE_CHECKED_KEY = 'clone90-update-checked';
const loadAll = () => loadData(undefined, localSupported ? (systems) => loadLocalGames(systems) : null, localSupported ? (systems) => loadLocalLogos(systems) : null); // T42 : logos gardés dans le navigateur

async function main() {
  // T45 : numéro sous « Clone90 » (visible sur le téléphone, css/base.css), rempli d'abord pour rester affiché même si le chargement échoue.
  const headerVersion = document.querySelector('.site-version');
  if (headerVersion) headerVersion.textContent = formatShortVersionLabel();
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
  let updateDialog = null;
  // T41 : la barre du bas est dans la racine de la navigation (bas depuis la dernière rangée), à côté de l'écran ; rendue une fois.
  const appRoot = document.getElementById('app');
  const dock = renderBottomNav({ localSupported, linksAvailable: Boolean(folderSettings) || localSupported, onOpenFolders: folderSettings ? () => openFolders() : undefined });
  document.getElementById('dock-slot').replaceWith(dock);
  document.body.classList.add('has-dock');
  const nav = createFocusNavigator({ getRoot: () => appRoot });
  const router = createRouter(window);
  let current = {};
  let lastSystem = null;
  let libraryBusy = false;
  let libraryBusyText = null; // T40 : avancement de la recherche des pochettes
  let syncNotice = null; // T43 : résultat de la dernière synchronisation, affiché une fois dans « Mes fichiers »
  let openSyncNext = false; // T43 : le panneau des dossiers a demandé le panneau du partage

  /** Relit games.json et la bibliothèque locale (T27, après un ajout ou une suppression). Garde les données d'avant en cas d'échec. */
  async function reload() {
    try {
      applyData(await loadAll());
    } catch (e) { console.error('Rechargement impossible :', e.cause ?? e); }
  }

  /** T40 : pochettes des jeux de « Mes fichiers » qui n'en ont pas ; données rechargées si des images ont été ajoutées. Ne lève jamais.
   *  T42 : puis les vrais logos des machines qui manquent (une fois par machine), sans message : ils apparaissent sur l'accueil.
   *  @returns {Promise<string|null>} résumé d'une ligne, null s'il n'y avait rien à chercher */
  async function addLocalCovers(library, onProgress) {
    await reload(); // les jeux tout juste importés doivent être dans data.games
    const summary = await findLocalCovers({ systems: data.systems, games: data.games, library, onProgress });
    const logos = await findLocalLogos({ systems: data.systems, library });
    if (logos.failed.length) console.warn('Logos des machines non téléchargés :', logos.failed);
    if (summary.found.length || logos.found.length) await reload();
    return describeCoversResult(summary);
  }

  function showHome() {
    clear(screen);
    const tiles = buildMachineTiles(systems, gamesBySystem);
    screen.append(renderHome({ tiles, gamesStatus: data.gamesStatus, skipped: data.skipped }));
    current = {};
    if (lastSystem) nav.focusById(lastSystem); // retour d'une grille : le focus revient sur la machine quittée
  }

  /** Écran « Mes fichiers » (T27). `focusId` : bouton à refocaliser après un nouveau rendu. */
  async function showLibrary(machine, focusId = null, notice = null) { // T38 : `notice` = résultat du dernier scan, affiché dans l'écran
    let entries = [];
    let library = null;
    const syncMessage = syncNotice;
    syncNotice = null;
    if (localSupported) {
      try { library = await openLocalLibrary(); entries = await library.list(); } catch (e) { console.error('Bibliothèque locale illisible :', e); }
    }
    const render = (focus) => {
      clear(screen);
      screen.append(renderLibrary({
        systems: data.systems, entries, supported: Boolean(library), machine, busy: libraryBusy, busyText: libraryBusyText,
        folderPicking: folderPickingSupported(window), onScanFolder: () => importFolder(), notice,
        onAddGames: (systemId) => importFiles((file) => ({ path: romStoragePath(systemId, file.name) }), addGamesNavId(systemId), true),
        onFindCovers: () => findCovers(FIND_COVERS_NAV_ID),
        // T43 : rubrique du téléphone seulement (sur le Mac, c'est le Mac qui partage)
        sync: folderSettings ? null : { pairing: readSyncPairing(), message: syncMessage, onPair: (address, code) => pairAndSync(address, code), onSyncNow: () => syncNow(SYNC_NAV.now), onSend: () => sendToMac(),
          onForget: () => { if (window.confirm('Oublier ce Mac ? Les fichiers déjà copiés restent sur ce téléphone.')) { forgetSyncPairing(); showLibrary(machine, SYNC_NAV.address); } } },
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
    /** T40 : recherche des pochettes avec avancement dans l'écran, puis nouveau rendu avec le résumé (`before` : message de l'import, gardé devant). */
    async function findCovers(returnFocus, before = null) {
      libraryBusy = true;
      libraryBusyText = 'Recherche des pochettes…';
      render(null);
      let text = null;
      try {
        text = await addLocalCovers(library, (p) => {
          libraryBusyText = p.total > 0 && p.phase === 'downloading' ? `Recherche des pochettes : ${Math.min(p.done + 1, p.total)} sur ${p.total}…` : 'Recherche des pochettes…';
          render(null);
        });
      } finally {
        libraryBusy = false;
        libraryBusyText = null;
      }
      showLibrary(machine, returnFocus, [before, text ?? (before ? null : 'Pochettes : aucun jeu sans pochette.')].filter(Boolean).join('. ') || null);
    }
    /** T43 : association avec le Mac, puis première synchronisation. */
    async function pairAndSync(address, code) {
      libraryBusy = true;
      libraryBusyText = 'Association avec le Mac…';
      render(null);
      const paired = await pairWithMac({ address, code });
      libraryBusy = false;
      libraryBusyText = null;
      if (!paired.ok) { syncNotice = paired.message; showLibrary(machine, SYNC_NAV.address); return; }
      await syncNow(SYNC_NAV.now);
    }
    /** T43 : copie depuis le Mac avec avancement dans l'écran, puis nouveau rendu avec le résumé. */
    async function syncNow(returnFocus) {
      libraryBusy = true;
      libraryBusyText = 'Lecture de la liste du Mac…';
      render(null);
      let result;
      try {
        result = await syncFromMac({ library, systems: data.systems, onProgress: (p) => {
          libraryBusyText = p.total ? `Copie depuis le Mac : ${Math.min(p.done + 1, p.total)} sur ${p.total}${p.name ? ` (${p.name})` : ''}…` : 'Copie depuis le Mac…';
          render(null);
        } });
      } finally {
        libraryBusy = false;
        libraryBusyText = null;
      }
      if (result.changed) { requestPersistentStorage(); await reload(); }
      syncNotice = result.text;
      showLibrary(machine, returnFocus);
    }
    /** T44 : envoi des jeux du téléphone au Mac, avec avancement dans l'écran, puis nouveau rendu avec le résumé. */
    async function sendToMac() {
      libraryBusy = true;
      libraryBusyText = 'Lecture de la liste du Mac…';
      render(null);
      let result;
      try {
        result = await sendGamesToMac({ library, systems: data.systems, onProgress: (p) => {
          libraryBusyText = p.total ? `Envoi au Mac : ${Math.min(p.done + 1, p.total)} sur ${p.total}${p.name ? ` (${p.name})` : ''}…` : 'Envoi au Mac…';
          render(null);
        } });
      } finally {
        libraryBusy = false;
        libraryBusyText = null;
      }
      syncNotice = result.text;
      showLibrary(machine, SYNC_NAV.send);
    }
    /** Copie les fichiers choisis dans la bibliothèque. `target(file)` : {path, known?} ou null (nom inutilisable). `covers` : jeux (T40). */
    async function importFiles(target, returnFocus, covers = false) {
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
      if (covers && result.added) { await findCovers(returnFocus, describeImport(result)); return; }
      await reload();
      showLibrary(machine, returnFocus);
    }
    /** T38 : copie tout un dossier choisi (un sous-dossier par machine), d'après le plan pur de folder-scan.js. */
    async function importFolder() {
      const files = await pickFolder(document);
      if (!files.length) return;
      const plan = planFolderImport(files, data.systems, entries);
      const summary = summarizePlan(plan, data.systems);
      libraryBusy = true;
      render(null);
      let copied = 0;
      try {
        for (const item of plan.items) {
          await library.put(item.path, files[item.index]);
          copied += 1;
        }
        if (copied) requestPersistentStorage();
      } catch (e) {
        console.error('Copie du dossier impossible :', e);
      } finally {
        libraryBusy = false;
      }
      // Le résumé est affiché dans l'écran, sous le bouton (pas de toast : 2 s ne suffisent pas pour le lire et il le recouvrirait).
      if (copied) { await findCovers(SCAN_FOLDER_NAV_ID, describeFolderImport({ ...summary, copied })); return; }
      await reload();
      showLibrary(machine, SCAN_FOLDER_NAV_ID, describeFolderImport({ ...summary, copied }));
    }
    render(focusId ?? (machine ? addGamesNavId(machine) : LIBRARY_BACK_NAV_ID));
    current = { onBack: () => router.navigate({ name: 'home' }) };
  }

  /** Écran « Depuis une page web » (T34) : le serveur du Mac lit et télécharge s'il répond ; sinon le navigateur, vers « Mes fichiers ». */
  function showLinks() {
    clear(screen);
    const source = folderSettings ? createMacLinkSource()
      : localSupported ? createBrowserLinkSource({ systems: data.systems, openLibrary: () => openLocalLibrary() }) : null;
    screen.append(createLinkScreen({
      systems: data.systems, source,
      onFinished: async () => {
        if (folderSettings) { await reload(); autoCovers(); return; } // T40 : jeux tout juste téléchargés sur le Mac
        requestPersistentStorage();
        // T40 : jeux arrivés dans « Mes fichiers » : leurs pochettes, résumé en message temporaire (on reste sur cet écran).
        let text = null;
        try { text = await addLocalCovers(await openLocalLibrary()); } catch { await reload(); }
        if (text) toast(text);
      },
      focus: (id) => nav.focusById(id),
    }));
    nav.focusById(source ? LINK_INPUT_NAV_ID : 'back');
    current = { onBack: () => router.navigate({ name: 'home' }) };
  }

  /** Après un choix de dossier réussi : recharge games.json et redessine l'accueil (le panneau reste ouvert par-dessus). */
  async function reloadGames() {
    await reload();
    showHome();
    autoCovers(); // T40 : nouveau dossier, nouveaux jeux peut-être sans pochette
  }

  /** T40 (Mac) : pochettes manquantes cherchées sans clic. Rien si aucun jeu n'en manque, si un autre téléchargement tourne ou sans API locale.
   *  Message seulement si des pochettes ont été ajoutées ; la fin est traitée par onDownloadDone comme pour le bouton. */
  let autoCoversRunning = false;
  async function autoCovers() {
    if (!folderSettings || autoCoversRunning) return;
    autoCoversRunning = true;
    try {
      const state = await runAutoCovers({ games: data.games, systems: data.systems, start: () => requestCoversDownload(), status: () => fetchCoversStatus() });
      if (state) await onDownloadDone(state, { quiet: true });
    } finally {
      autoCoversRunning = false;
    }
  }

  /** Fin d'un téléchargement de pochettes (T28) ou de logos (T29), panneau ouvert ou fermé : une seule fois par travail (`state.id`, numéroté
   *  par le serveur pour les deux), même si deux panneaux l'ont suivi. */
  let lastDownloadJob = null;
  async function onDownloadDone(state, { quiet = false } = {}) { // quiet (T40, recherche automatique) : message seulement si des pochettes ont été ajoutées
    if (state.id !== undefined && state.id === lastDownloadJob) return;
    lastDownloadJob = state.id;
    if (state.status === 'done' && state.found > 0) { // l'utilisateur a pu quitter l'accueil : on recharge les données, on ne redessine l'accueil que s'il est affiché
      await reload();
      if (screen.querySelector('.home')) showHome();
    }
    const text = quiet ? autoCoversToast(state) : (state.status === 'done' ? state.lines[0] : state.message);
    if (text) toast(text);
  }

  async function openFolders() {
    folderSettings = (await fetchFolderSettings()) ?? folderSettings; // valeurs fraîches ; si le serveur ne répond plus, les précédentes
    // T28, T29 : un téléchargement lancé avant la fermeture du panneau continue ; on reprend son suivi
    const [coversRunning, logosRunning] = (await Promise.all([fetchCoversStatus(), fetchLogosStatus()])).map((s) => s?.status === 'running');
    foldersPanel = createFoldersPanel({
      onOpenSync: () => { openSyncNext = true; },
      settings: folderSettings, choose: (kind) => requestFolderChoice(kind), onChanged: reloadGames,
      covers: { start: () => requestCoversDownload(), status: () => fetchCoversStatus() }, coversRunning, onCoversDone: onDownloadDone,
      logos: { start: () => requestLogosDownload(), status: () => fetchLogosStatus() }, logosRunning, onLogosDone: onDownloadDone,
    });
    foldersPanel.open(document.body);
    await foldersPanel.result;
    foldersPanel = null;
    if (openSyncNext) { openSyncNext = false; await openSyncPanel(); return; }
    nav.focusById(FOLDERS_NAV_ID); // T41 : l'onglet « Dossiers » de la barre du bas reprend le focus
  }

  /** T43 (Mac) : panneau « Partager avec le téléphone », ouvert depuis le panneau des dossiers ; capte les actions comme lui. */
  async function openSyncPanel() {
    foldersPanel = createSyncPanel({ initial: await fetchSyncStatus() });
    foldersPanel.open(document.body);
    await foldersPanel.result;
    foldersPanel = null;
    nav.focusById(FOLDERS_NAV_ID);
  }

  /** T43 (téléphone associé) : synchronisation sans clic à l'ouverture ; message seulement si quelque chose a changé ou échoué. Ne lève jamais. */
  async function autoSync() {
    if (folderSettings || !localSupported || !readSyncPairing()) return;
    try {
      const result = await syncFromMac({ library: await openLocalLibrary(), systems: data.systems, quiet: true });
      if (result.changed) {
        requestPersistentStorage();
        await reload();
        if (screen.querySelector('.home')) showHome();
      }
      if (result.text) toast(result.text);
    } catch (e) { console.error('Synchronisation automatique impossible :', e); }
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
    markActiveTab(dock, activeTabFor(target.name));
    if (target.name === 'library') { window.scrollTo(0, 0); showLibrary(target.machine); return; }
    if (target.name === 'links') { window.scrollTo(0, 0); showLinks(); return; }
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
      if (!foldersPanel && !appRoot.contains(document.activeElement)) nav.focusFirst();
    },
  });
  actions.start((action, source) => {
    setGamepadMode(source === 'gamepad');
    if (updateDialog?.handleAction(action)) return; // T35 : la fenêtre de mise à jour ouverte capte toutes les actions
    if (foldersPanel?.handleAction(action)) return; // le panneau ouvert capte toutes les actions
    if (action === 'back') current.onBack?.();
    else nav.handleAction(action);
  });
  router.start(onRoute);
  scheduleUpdateCheck();

  /**
   * T35 : vérification des mises à jour à chaque ouverture de Clone90, 5 s après le lancement (règle de Hicham, 2026-11-13).
   * Mac (API locale) : le serveur lit la dernière version sur github.com ; sinon (site, téléphone) : version du site relue au réseau.
   * Une fois par onglet (sessionStorage) : revenir d'un jeu recharge index.html, ce n'est pas une nouvelle ouverture.
   */
  function scheduleUpdateCheck() {
    try {
      if (sessionStorage.getItem(UPDATE_CHECKED_KEY)) return;
      sessionStorage.setItem(UPDATE_CHECKED_KEY, '1');
    } catch { /* stockage refusé : on vérifie quand même */ }
    setTimeout(async () => {
      const source = folderSettings ? createMacUpdateSource() : createBrowserUpdateSource();
      const update = await source.check();
      if (update.status !== 'available') { autoCovers(); autoSync(); return; } // T43 : synchronisation avec le Mac, après la vérification // T40 : après la vérification, jamais pendant une mise à jour
      if (foldersPanel) return;
      const { dialog, done } = openUpdateDialog({ update, source, parent: document.body });
      updateDialog = dialog;
      await done;
      updateDialog = null;
    }, UPDATE_CHECK_DELAY_MS);
  }
}

main();
registerServiceWorker(); // T8 : hors ligne et installation ; sans effet hors HTTPS/localhost
