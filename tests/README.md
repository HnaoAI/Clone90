# tests/

Tests `node:test`, sans dépendance. Lancer : `node --test "tests/*.test.mjs"` (guillemets conservés).

- `systems.test.mjs` : validité de `systems.json` (schéma, ids uniques, amiga et neogeo complets).
- `serve.test.mjs` : serveur local (index.html, MIME, 404, Range, refus de `../`).
- `serve-port.test.mjs` : choix du port (`--port`, `PORT`, défaut 8080).
