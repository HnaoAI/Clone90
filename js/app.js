// Point d'entrée de index.html (T5) : charge les données, branche le routeur et la couche d'entrée sur l'écran courant.
// Dépend de data, router, screens, input/*, ui/*. Seul module qui touche à la page entière ; la logique est dans screens.js et ui/.
// Contrat d'un écran : il rend dans #screen des éléments `data-nav` ; `current.onBack` (facultatif) traite l'action retour.
import { loadData, groupGamesBySystem } from './data.js';
import { createRouter } from './router.js';
import { createActionSource } from './input/actions.js';
import { createFocusNavigator } from './input/focus-nav.js';
import { visibleSystems, resolveRoute } from './screens.js';
import { buildMachineTiles, renderHome } from './ui/machine-grid.js';
import { renderGameGrid, initialFocusId, EMPTY_NAV_ID } from './ui/game-grid.js';
import { renderFatalError } from './ui/error-screen.js';
import { createToast } from './ui/toast.js';
import { clear } from './ui/dom.js';
import { setGamepadMode, watchPointer } from './ui/input-mode.js';

const screen = document.getElementById('screen');
const toast = createToast(document.getElementById('toast'));

watchPointer();

async function main() {
  let data;
  try {
    data = await loadData();
  } catch (e) {
    screen.append(renderFatalError(e.message));
    createFocusNavigator({ getRoot: () => screen }).focusFirst();
    return;
  }
  const systems = visibleSystems(data.systems, data.games);
  const gamesBySystem = groupGamesBySystem(systems, data.games);
  const nav = createFocusNavigator({ getRoot: () => screen });
  const router = createRouter(window);
  let current = {};
  let lastSystem = null;

  function showHome() {
    clear(screen);
    const tiles = buildMachineTiles(systems, gamesBySystem);
    screen.append(renderHome({ tiles, gamesStatus: data.gamesStatus, skipped: data.skipped }));
    current = {};
    if (lastSystem) nav.focusById(lastSystem); // retour d'une grille : le focus revient sur la machine quittée
  }

  function showGameGrid(machine, focus) {
    clear(screen);
    lastSystem = machine.id;
    const games = gamesBySystem.get(machine.id) ?? [];
    screen.append(renderGameGrid({ machine, games }));
    current = { onBack: () => router.navigate({ name: 'home' }) };
    window.scrollTo(0, 0);
    // Focus sur le jeu quitté (?focus=), sinon le 1er jeu, sinon (état vide) le bouton "Revenir aux machines".
    nav.focusById(initialFocusId(games, focus) ?? EMPTY_NAV_ID);
  }

  function onRoute(route) {
    const target = resolveRoute(route, systems);
    if (target.name === 'home') {
      if (route.name !== 'home') { location.replace('#/'); return; } // route inconnue : on réécrit le hash sans polluer l'historique
      showHome();
    } else {
      showGameGrid(target.machine, target.focus);
    }
  }

  const actions = createActionSource({
    onWake: () => {
      setGamepadMode(true);
      toast('Manette connectée');
      if (!screen.contains(document.activeElement)) nav.focusFirst();
    },
  });
  actions.start((action, source) => {
    setGamepadMode(source === 'gamepad');
    if (action === 'back') current.onBack?.();
    else nav.handleAction(action);
  });
  router.start(onRoute);
}

main();
