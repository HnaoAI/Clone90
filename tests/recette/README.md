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
- `manette-tactile.mjs` : même montage que `mobile-menu.mjs` (schéma de manette par défaut forcé par `EJS_controlScheme`, et schéma NES) : joystick gris clair, Select / Start / Slow / Fast hors de l'image et sous le joystick en paysage, toujours actifs ; `CAPTURES=<dossier>` pour les captures (T31).
- `joystick-tactile.mjs` : même montage, vrais évènements tactiles (CDP) sur le joystick du schéma par défaut : direction envoyée au cœur (`simulateInput`) rejouée ; jamais « gauche » en allant à droite, zone morte, jamais deux directions opposées, 8 directions (T32).
- `mobile-menu-lib.mjs` : outils de ces deux recettes (CDN EmulatorJS servi en local, mesure de l'image du jeu, recouvrement).
- `subpath-server.mjs` : serveur statique minimal qui imite GitHub Pages (sous-chemin, pas de roms/, bios/, games.json).

Chaque script écrit une ligne JSON par vérification sur la sortie standard (`id`, `verdict`, `detail`).
