# tests/recette

Recette T9 : scripts Playwright lancés à la main (pas dans `node --test`, car ils demandent Playwright, des navigateurs installés et un serveur lancé).
Playwright est cherché dans `PLAYWRIGHT_PATH` (défaut : `~/node_modules/playwright`). Rien n'est installé par ces scripts.

- `lib.mjs` : lancement du navigateur, manette simulée (Gamepad API remplacée par script), faux EmulatorJS (le CDN est intercepté), collecte des verdicts.
- `ux.mjs` : critères CA-* de docs/ux.md. `node tests/recette/ux.mjs [chromium|firefox|webkit]`, serveur `node scripts/serve.mjs --port 8765` lancé avant, avec de FAUX fichiers dans `roms/` puis `node scripts/generate-games.mjs`.
- `a11y.mjs` : accessibilité manuelle (reduced-motion, contrastes sur tous les écrans, zoom 200 % simulé, noms accessibles, ordre de tabulation).
- `page-fns.mjs` : fonctions de mesure exécutées dans la page (débordement, contraste, cibles tactiles).
- `perf.mjs` : coût d'une flèche avec 3000 tuiles (faux fichiers `roms/amiga/`).
- `pages.mjs` : simulation GitHub Pages sous `/Clone90/` (sans roms ni games.json), service worker, manifest.
- `robustesse.mjs` : games.json corrompu, systems.json illisible, noms spéciaux, ROM manquante.
- `mobile-menu.mjs` : Pixel 7 portrait et paysage avec le VRAI EmulatorJS (paquets npm dépaquetés, `EJS_DATA` et `EJS_CORE`) et une ROM NES homebrew : bouton Menu et ☰ hors de l'image du jeu, 48 px, ☰ toujours actif (T28).
- `subpath-server.mjs` : serveur statique minimal qui imite GitHub Pages (sous-chemin, pas de roms/, bios/, games.json).

Chaque script écrit une ligne JSON par vérification sur la sortie standard (`id`, `verdict`, `detail`).
