// Choix de l'écran à afficher (T5) : logique pure, séparée de app.js (qui touche au DOM). Dépend de config.js.
import { MAX_VISIBLE_WAVE } from './config.js';
// INVARIANT : la liste des machines vient de systems.json, jamais d'ici (CLAUDE.md règle 2).

/**
 * Machines affichées : celles dont la vague est livrée (sans `wave` = affichée), ou qui ont au moins un jeu
 * (arbitrage PO : qui dépose des ROMs NES voit la NES sans attendre la vague 2). Ordre de `systems` conservé.
 * @param {object[]} systems machines de systems.json
 * @param {object[]} games jeux de games.json
 * @param {number} [maxWave]
 */
export function visibleSystems(systems, games, maxWave = MAX_VISIBLE_WAVE) {
  const withGames = new Set(games.map((g) => g.system));
  return systems.filter((s) => (s.wave ?? 1) <= maxWave || withGames.has(s.id));
}

/**
 * Ramène une route lue dans le hash à un écran affichable : route inconnue ou machine non affichée = accueil.
 * @param {{name: string, system?: string, focus?: string|null}} route résultat de parseHash
 * @param {object[]} systems machines AFFICHÉES (voir visibleSystems)
 * @returns {{name: 'home'} | {name: 'library', machine: string|null} | {name: 'links'} | {name: 'system', system: string, focus: string|null, machine: object}}
 */
export function resolveRoute(route, systems) {
  if (route.name === 'links') return { name: 'links' }; // T34
  if (route.name === 'library') return { name: 'library', machine: systems.some((s) => s.id === route.machine) ? route.machine : null }; // T27
  if (route.name !== 'system') return { name: 'home' };
  const machine = systems.find((s) => s.id === route.system);
  return machine ? { name: 'system', system: route.system, focus: route.focus ?? null, machine } : { name: 'home' };
}
