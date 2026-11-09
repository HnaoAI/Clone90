# js/

Modules ES sans framework ni build. Chemins relatifs uniquement.

- `config.js` : constantes (version du CDN EmulatorJS, noms de fichiers de données, dossiers roms/bios).
- `data.js` : charge et valide `systems.json` et `games.json` (`games.json` absent = statut `absent`, pas d'erreur), regroupement par machine, encodage des chemins et des ids pour les URL.
- `router.js` : routes hash `#/` et `#/<machine>?focus=<id>` (`parseHash`, `buildHash`, `createRouter`) et `buildPlayerUrl`. Aucune logique d'écran.
- `sort.js` : `compareTitles`, règle de tri des titres partagée avec `scripts/generate-games.mjs`.
- `ui/dom.js` : helpers `el` et `clear` (pas d'`innerHTML`).
- `input/actions.js` : clavier + manette vers `up/down/left/right/confirm/back` (`createActionSource`, répétition, front montant, réveil de manette).
- `input/focus-nav.js` : navigation spatiale du focus sur les éléments `data-nav` (`pickNext`, `createFocusNavigator`).
- `screens.js` : choix de l'écran (`visibleSystems`, `resolveRoute`), logique pure.
- `app.js` : point d'entrée de `index.html` (données, routeur, couche d'entrée, écran courant).
- `ui/machine-grid.js` : accueil (`buildMachineTiles`, `describeGamesStatus`, `renderHome`). `ui/format.js` : libellés partagés. `ui/toast.js` : message temporaire. `ui/error-screen.js` : erreur bloquante.
- À venir : grille de jeux, dialogue et `player/` (T6, T7).

Tests : `tests/actions.test.mjs`, `tests/focus-nav.test.mjs`, `tests/data.test.mjs`, `tests/router.test.mjs`, `tests/dom.test.mjs`, `tests/machine-grid.test.mjs`.
