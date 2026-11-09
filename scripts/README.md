# scripts/

Scripts Node.js sans dépendance (Node 18 ou plus récent).

- `serve.mjs` : serveur statique local (port 8080, `--port` ou `PORT`), MIME wasm/js/json, Range, protection contre `../`. Tests : `tests/serve*.test.mjs`.
- `generate-games.mjs` : à venir (ticket T2), scanne `roms/` et produit `games.json`.
