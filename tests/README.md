# tests/

Tests `node:test`, sans dépendance. Lancer : `node --test "tests/*.test.mjs"` (guillemets conservés).

- `systems.test.mjs` : validité de `systems.json` (schéma, ids uniques, amiga et neogeo complets).
- `serve.test.mjs` : serveur local (index.html, MIME, 404, Range, refus de `../`).
- `serve-port.test.mjs` : choix du port (`--port`, `PORT`, défaut 8080).
- `generate-games.test.mjs` : générateur de `games.json` sur de faux fichiers temporaires (titres, .m3u, jaquettes, tri, cas limites).
- `actions.test.mjs` : clavier et manette vers actions, répétition, réveil de manette, boucle avec environnement factice (T4).
- `focus-nav.test.mjs` : navigation spatiale avec rectangles et éléments factices (T4).
- `data.test.mjs` : validation de `systems.json` et `games.json`, `loadData` avec `games.json` absent, encodage des chemins (T3).
- `router.test.mjs` : routes hash, `?focus=`, aller-retour, routeur avec fenêtre factice (T3).
- `sort.test.mjs` : tri des titres partagé (T3).
- `dom.test.mjs` : helpers `el` et `clear` avec document factice (T3).
- `machine-grid.test.mjs` : accueil (tuiles, 0 jeu en fin de liste, 12 machines, messages games.json, choix d'écran, rendu avec document factice) (T5).
