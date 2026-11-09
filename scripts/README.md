# scripts/

Scripts Node.js sans dépendance (Node 18 ou plus récent).

- `serve.mjs` : serveur statique local (port 8080, `--port` ou `PORT`), MIME wasm/js/json, Range, liste blanche des fichiers publics, protection contre `../`. Tests : `tests/serve*.test.mjs`.
- `project-root.mjs` : constante `PROJECT_ROOT` partagée par les scripts.
- `generate-games.mjs` : scanne `roms/<machine>/` d'après `systems.json` et écrit `games.json` (`--check` pour un simple diagnostic). Tri des titres via `js/sort.js` (partagé avec le navigateur). Fonctions pures exportées (`cleanTitle`, `makeId`, `resolveTitle`, `parseM3u`, `buildSystemGames`) ; racine via `project-root.mjs`. Tests : `tests/generate-games.test.mjs`.
