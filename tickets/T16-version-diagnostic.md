# T16 : Numéro de version et panneau de diagnostic

**Dépend de** : T8, T10, T12, T14
**Branche** : `ticket/T16-version-diagnostic`
**Demandé par** : le PO (délégation de Hicham), urgent. Contexte : sur Leander (Amiga, 3 disquettes), Hicham reste bloqué sur « insérez la disquette 2 » malgré T14, et ne peut pas ouvrir la console d'Opera. Il faut voir ce qui se passe chez lui.

## Besoin
1. Un numéro de version visible, pour savoir quelle livraison tourne (et que le cache n'a pas servi une ancienne).
2. Un panneau de diagnostic dans le jeu, activé par `debug=1` dans l'adresse, qui montre chaque tentative de changement de disquette et ce que le cœur en dit.

## Réalisation
- `js/version.js` : `APP_VERSION` (`0.<dernier ticket>.<n>`), `APP_DATE`, `formatVersionLabel()` (« Clone90 v0.16.0 - 11/11/2026 », avec un simple tiret). Affiché en bas de l'accueil (`renderHome`) et dans le panneau.
- Service worker : `pwa.js` l'enregistre sous `sw.js?v=<APP_VERSION>` ; `sw.js` (script classique, qui ne peut pas importer un module) lit ce paramètre pour nommer son cache `clone90-shell-v<version>`. Aucune valeur dupliquée ; effet de bord utile : relever la version fait détecter un nouveau service worker et renouvelle le cache.
- `js/player/diagnostic-log.js` (pur) : `isDebugRequested`, journal borné (200 évènements, 40 lignes du cœur), `describeDiskTrace`, `toText`.
- `js/player/diagnostic-panel.js` : pastille repliable en haut à droite (ouverte : sous le bouton Menu), fiche (version, machine, jeu, nombre de disquettes et courante lus dans le cœur par `getDiskState`), évènements horodatés, dernières lignes du cœur, bouton « Copier le journal ». `mountDiagnostic` renvoie null sans `debug=1`.
- Journal des tentatives : alimenté depuis `handleSpecialOptions` patché dans `launcher.js` (chemin unique, menu EmulatorJS, F9 et Select+RB). Évènements : demande (source, valeur, disque courant), ignoré au démarrage, 1er appel (ok ou erreur), 2e appel, rétablissement, état du cœur 0,5 s, 2 s et 5 s après. `disk-shortcut.js` transmet sa source (`F9`, `Select+RB`) à `switchToDisk`.
- Lignes du cœur : `loadEmulator` accepte `onCoreLine` (écoute print/printErr existante, `ejs-start-watch.js`).
- Niveau de log : `retroarch-cfg.js`, `debug` met `frontend_log_level` et `libretro_log_level` à 1 (info) pour voir « Disk (2) inserted in drive DF0 » ; sinon 3 (erreurs) comme avant.
- Ajout du PO : `<link rel="icon">` dans `index.html` et `player.html` ; `/favicon.ico` répond 404 au lieu de 403 (`scripts/serve.mjs`, le reste de la liste blanche reste en 403).
- Non fait : `EJS_language = 'en-US'` (le 404 de `localization/fr.json` est sans effet ; non vérifié dans le source 4.2.3).

## Critères d'acceptation
1. La version est dans un seul module ; l'accueil l'affiche ; le cache du service worker en dérive et ne peut pas diverger (test).
2. Sans `debug=1` : aucun panneau, aucun journal, niveau de log du cœur inchangé.
3. Avec `debug=1` : panneau repliable, lisible à 360 px, qui ne recouvre pas le bouton Menu et ne prend pas le focus du jeu.
4. Le journal couvre : ok, unreachable puis ok, double échec puis rétablissement, état du cœur 0,5/2/5 s, source de la demande.
5. « Copier le journal » copie le texte complet. Aucune donnée n'est envoyée sur le réseau.

## Vérification manuelle (Hicham)
Ouvrir le jeu avec `&debug=1`, ouvrir la pastille « Diag », changer de disquette (menu Disks, F9 ou Select+RB), puis « Copier le journal » et le coller dans le chat.
