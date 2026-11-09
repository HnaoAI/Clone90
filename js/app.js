// Point d'entrée de index.html (T5) : charge les données, branche le routeur et la couche d'entrée sur l'écran courant.
// Dépend de data, router, screens, input/*, ui/*. Seul module qui touche à la page entière ; la logique est dans screens.js et ui/.
// Contrat d'un écran : il rend dans #screen des éléments `data-nav` ; `current.onBack` (facultatif) traite l'action retour.
import { loadData, groupGamesBySystem } from './data.js';
import { createRouter } from './router.js';
import { createActionSource } from './input/actions.js';
import { createFocusNavigator } from './input/focus-nav.js';
import { visibleSystems, resolveRoute } from './screens.js';
import { buildMachineTiles, renderHome } from './ui/machine-grid.js';
import { renderFatalError } from './ui/error-screen.js';
import { createToast } from './ui/toast.js';
import { clear, el } from './ui/dom.js';

const screen = document.getElementById('screen');
const toast = createToast(document.getElementById('toast'));

/** Mode manette : l'anneau de focus s'affiche même sans :focus-visible (docs/ux.md 4.3). La souris ou le tactile le coupent. */
const setGamepadMode = (on) => document.body.classList.toggle('input-gamepad', on);
window.addEventListener('pointerdown', () => setGamepadMode(false));

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

  // TODO(T6) : remplacer par game-grid.js (grille de jeux, état vide, focus de retour).
  function showSystemPlaceholder(machine) {
    clear(screen);
    lastSystem = machine.id;
    screen.append(el('section', { class: 'message-screen' }, [
      el('h2', { class: 'screen-title', text: machine.name }),
      el('p', { text: 'La grille de jeux arrive bientôt.' }),
      el('a', { class: 'button', text: 'Revenir aux machines', attrs: { href: '#/' }, dataset: { nav: '' } }),
    ]));
    current = { onBack: () => router.navigate({ name: 'home' }) };
    nav.focusFirst();
  }

  function onRoute(route) {
    const target = resolveRoute(route, systems);
    if (target.name === 'home') {
      if (route.name !== 'home') { location.replace('#/'); return; } // route inconnue : on réécrit le hash sans polluer l'historique
      showHome();
    } else {
      showSystemPlaceholder(target.machine);
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
