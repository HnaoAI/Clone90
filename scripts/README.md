# scripts/

Scripts Node.js sans dépendance (Node 18 ou plus récent).

- `serve.mjs` : serveur statique local (port 8080, `--port` ou `PORT`), MIME wasm/js/json, Range, liste blanche des fichiers publics, protection contre `../`, refus (403) des liens symboliques qui sortent de la racine (realpath ; pour `roms/` et `bios/`, de leur propre realpath, donc liables vers un autre disque), `X-Content-Type-Options: nosniff` partout. Tests : `tests/serve*.test.mjs`.
- `project-root.mjs` : constante `PROJECT_ROOT` partagée par les scripts.
- `generate-games.mjs` : scanne `roms/<machine>/` d'après `systems.json` et écrit `games.json` (`--check` pour un simple diagnostic). Tri des titres via `js/sort.js` (partagé avec le navigateur). Fonctions pures exportées (`cleanTitle`, `makeId`, `resolveTitle`, `parseM3u`, `buildSystemGames`) ; racine via `project-root.mjs`. Tests : `tests/generate-games.test.mjs`.
- `generate-logos.mjs` : génère `assets/logos/<id>.svg` (nom en lettres pixel sur la couleur d'accent, forme géométrique) d'après `systems.json` et `css/base.css`. À relancer quand une machine ou une couleur change ; `pixel-font.mjs` est la police 5x7 partagée.
- `generate-icons.mjs` : génère les icônes PWA `assets/icons/icon-*.png` (PNG fait maison, sans dépendance). À relancer seulement pour changer le dessin.
