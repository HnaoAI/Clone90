# js/

Modules ES sans framework ni build. Chemins relatifs uniquement.

- `version.js` : `APP_VERSION`, `APP_DATE`, `formatVersionLabel` (source unique du numéro de version, T16).
- `config.js` : constantes (version du CDN EmulatorJS, noms de fichiers de données, dossiers roms/bios).
- `data.js` : charge et valide `systems.json` et `games.json` (`games.json` absent = statut `absent`, pas d'erreur), regroupement par machine, encodage des chemins (par segment) et des ids pour les URL, messages d'erreur français de systems.json, statuts de games.json (`ok`, `empty`, `absent`, `offline`, `invalid`).
- `router.js` : routes hash `#/` et `#/<machine>?focus=<id>` (`parseHash`, `buildHash`, `createRouter`) et `buildPlayerUrl`. Aucune logique d'écran.
- `sort.js` : `compareTitles`, règle de tri des titres partagée avec `scripts/generate-games.mjs`.
- `ui/dom.js` : helpers `el` et `clear` (pas d'`innerHTML`).
- `input/actions.js` : clavier + manette vers `up/down/left/right/confirm/back` (`createActionSource`, répétition, front montant, réveil de manette).
- `input/focus-nav.js` : navigation spatiale du focus sur les éléments `data-nav` (`pickNext`, `createFocusNavigator`).
- `screens.js` : choix de l'écran (`visibleSystems`, `resolveRoute`), logique pure.
- `app.js` : point d'entrée de `index.html` (données, routeur, couche d'entrée, écran courant).
- `ui/machine-grid.js` : accueil (`buildMachineTiles`, `describeGamesStatus`, `renderHome`). `ui/logo.js` : logo machine et couleur d'accent (`createLogo`, `accentVar`). `ui/format.js` : libellés partagés. `ui/toast.js` : message temporaire. `ui/error-screen.js` : erreur bloquante.
- `ui/game-grid.js` : grille de jeux (`gameInitials`, `buildGameTiles`, `initialFocusId`, `describeEmptyState`, `renderGameGrid`). `ui/dialog.js` : boîte de confirmation réutilisable (`createConfirmDialog`, actions transmises par l'écran hôte).
- `player/launcher.js` : SEUL module qui connaît EmulatorJS (`buildLaunchPlan` pur, `findMissingFiles`, `loadEmulator`, `pauseEmulator`/`resumeEmulator`, `getDiskState`/`switchToDisk`). `player/retroarch-cfg.js` : fabrique les lignes AJOUTÉES au retroarch.cfg d'EmulatorJS par surcharge de `getRetroArchCfg` (journal d'erreurs, raccourcis RetroArch à nul si `disableRetroArchHotkeys`). `player/ejs-start-watch.js` : détecte un contenu refusé par le cœur (ligne `[ERROR] [Content]` de RetroArch), importé par `launcher.js` seulement. `player/exit-guard.js` : détection de sortie en lecture seule (Select+Start 1 s, F10, Échap maintenu 1 s). `player/disk-shortcut.js` : raccourci disquette suivante (Select+RB, F9), lecture seule comme le garde. `player/exit-hint.js` : rappel de sortie des 3 premiers lancements. `player/diagnostic-log.js` : journal du mode `debug=1` (pur). `player/diagnostic-panel.js` : panneau de diagnostic repliable (`mountDiagnostic`, null sans `debug=1`). `player/player-ui.js` : écran Jouer, messages, bouton Menu et anneau. `player/player-main.js` : point d'entrée de `player.html`.
- `pwa.js` : enregistrement du service worker `sw.js` (`registerServiceWorker`, sans effet hors HTTPS ou localhost). Le service worker lui-même est à la racine (`sw.js`).
- `ui/input-mode.js` : mode manette de l'anneau de focus (partagé par `app.js` et `player-main.js`).

Tests : `tests/actions.test.mjs`, `tests/focus-nav.test.mjs`, `tests/data.test.mjs`, `tests/router.test.mjs`, `tests/dom.test.mjs`, `tests/machine-grid.test.mjs`, `tests/game-grid.test.mjs`, `tests/launcher.test.mjs`, `tests/exit-guard.test.mjs`, `tests/disk-shortcut.test.mjs`, `tests/retroarch-cfg.test.mjs`, `tests/ejs-start-watch.test.mjs`, `tests/player-ui.test.mjs`, `tests/sw.test.mjs`, `tests/pwa.test.mjs`, `tests/version.test.mjs`, `tests/diagnostic-log.test.mjs`, `tests/diagnostic-panel.test.mjs`, `tests/disk-trace.test.mjs`.
