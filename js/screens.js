// Choix de l'écran à afficher (T5) : logique pure, séparée de app.js (qui touche au DOM). Dépend de rien.
// INVARIANT : la liste des machines vient de systems.json, jamais d'ici (CLAUDE.md règle 2).

/** Dernière vague de machines affichée (architecture 6.1 : wave 1 = livré à l'étape 1). À relever quand la vague 2 est livrée. */
export const MAX_VISIBLE_WAVE = 1;

/**
 * Machines affichées par l'application : celles dont la vague est livrée (sans `wave` = affichée).
 * @param {object[]} systems machines de systems.json
 * @param {number} [maxWave]
 */
export const visibleSystems = (systems, maxWave = MAX_VISIBLE_WAVE) => systems.filter((s) => (s.wave ?? 1) <= maxWave);

/**
 * Ramène une route lue dans le hash à un écran affichable : route inconnue ou machine non affichée = accueil.
 * @param {{name: string, system?: string, focus?: string|null}} route résultat de parseHash
 * @param {object[]} systems machines AFFICHÉES (voir visibleSystems)
 * @returns {{name: 'home'} | {name: 'system', system: string, focus: string|null, machine: object}}
 */
export function resolveRoute(route, systems) {
  if (route.name !== 'system') return { name: 'home' };
  const machine = systems.find((s) => s.id === route.system);
  return machine ? { name: 'system', system: route.system, focus: route.focus ?? null, machine } : { name: 'home' };
}
