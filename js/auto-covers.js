// Pochettes automatiques sur le Mac (T40, décision de Hicham le 2026-11-15 : « Passe en automatique sur mac ») : à l'ouverture de Clone90
// et après un ajout de jeux par Clone90 (« Depuis une page web », choix d'un dossier), s'il reste des jeux du disque sans pochette, le
// téléchargement de T28 (API locale `api/covers`, scripts/covers.mjs) est lancé sans clic, puis suivi jusqu'à la fin.
// Pur : l'API (lancer, lire l'état) et l'attente sont injectées (js/folders-client.js dans app.js). Ne lève jamais.
// INVARIANT (CLAUDE.md règle 5, exception a) : seulement si un jeu en a besoin ; la liste des images reste en cache 7 jours sur le Mac,
//   donc une ouverture sans nouveau jeu ne contacte pas GitHub.

/** Intervalle de lecture de l'état et nombre maximal de lectures sans réponse du serveur avant d'abandonner le suivi. */
const POLL_MS = 1000;
const MAX_SILENT_POLLS = 5;

/**
 * Nombre de jeux du disque (pas de « Mes fichiers ») sans pochette, dont la machine a une base de pochettes (`thumbnailsRepo`).
 * @param {object[]|undefined} games @param {object[]} systems
 */
export function countMissingCovers(games, systems) {
  const withBase = new Set(systems.filter((s) => s.thumbnailsRepo).map((s) => s.id));
  return (games ?? []).filter((g) => g && g.local !== true && !g.cover && withBase.has(g.system)).length;
}

/**
 * Lance le téléchargement si nécessaire et le suit jusqu'à la fin.
 * @param {{games: object[], systems: object[], start: () => Promise<{status: string}>, status: () => Promise<object|null>, wait?: (ms: number) => Promise<void>}} input
 * @returns {Promise<object|null>} état final (`done` ou `error`) ; null si rien n'a été lancé (rien à chercher, occupé, erreur) ou si le serveur ne répond plus
 */
export async function runAutoCovers({ games, systems, start, status, wait = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!countMissingCovers(games, systems)) return null;
  try {
    if ((await start())?.status !== 'started') return null; // autre téléchargement en cours, ou refus : on n'insiste pas
    let silent = 0;
    for (;;) {
      const state = await status();
      if (state && state.status !== 'running') return state;
      silent = state ? 0 : silent + 1;
      if (silent >= MAX_SILENT_POLLS) return null;
      await wait(POLL_MS);
    }
  } catch {
    return null;
  }
}

/** Message de fin : seulement si des pochettes ont été ajoutées (une recherche sans résultat à l'ouverture ne dérange personne). @returns {string|null} */
export function autoCoversToast(state) {
  return state?.status === 'done' && state.found > 0 ? (state.lines?.[0] ?? null) : null;
}
