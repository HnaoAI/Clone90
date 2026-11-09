# js/

Modules ES sans framework ni build. Chemins relatifs uniquement.

- `config.js` : constantes (version du CDN EmulatorJS, noms de fichiers de données, dossiers roms/bios).
- `data.js` : charge et valide `systems.json` et `games.json` (`games.json` absent = statut `absent`, pas d'erreur), regroupement par machine, encodage des chemins et des ids pour les URL.
- `router.js` : routes hash `#/` et `#/<machine>?focus=<id>` (`parseHash`, `buildHash`, `createRouter`) et `buildPlayerUrl`. Aucune logique d'écran.
- `sort.js` : `compareTitles`, règle de tri des titres partagée avec `scripts/generate-games.mjs`.
- `ui/dom.js` : helpers `el` et `clear` (pas d'`innerHTML`).
- À venir : `input/` (T4), écrans et `player/` (T5 à T7).

Tests : `tests/data.test.mjs`, `tests/router.test.mjs`, `tests/dom.test.mjs`.
