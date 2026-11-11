# T21 : Amiga sur EmulatorJS 4.2.1 (changement de disquette)

**Dépend de** : T20b
**Branche** : `ticket/T21-amiga-ejs-421` - **Version** : 0.21.0

## Cause trouvée (essais du PO, Chromium sans fenêtre, Gods 2 disquettes, fichiers réels de Hicham)
- **EmulatorJS 4.2.3** : chaque éjection de disquette lève « RuntimeError: unreachable » dans le wasm de puae. Pile : `set_current_disk` (export), `disk_control_set_eject_state` (RetroArch), `retro_disk_set_eject_state` (cœur), puis une fonction du cœur qui trappe. L'éjection n'est jamais terminée : le jeu reste sur « PLEASE INSERT DISK 2 » malgré « Disk (2) inserted in drive DF0 » dans le journal. L'émulation continue (compteur d'images vérifié).
- **EmulatorJS 4.2.1** (même code Clone90, seule la constante de version changée dans une copie) : aucune erreur, « 1er appel : ok », disquettes 1 et 2 insérées à chaque appel, Gods passe la demande de disquette 2 et enchaîne sur l'intro (disque 2).
- **nightly** : exclu, 0 disquette détectée (API différente).

## Réalisation
- `systems.json` : champ facultatif `ejsVersion` (format `x.y.z`), `"4.2.1"` pour l'Amiga seule. Défaut = `EJS_CDN_VERSION` (`js/config.js`, reste `4.2.3`).
- `js/config.js` : `ejsDataUrl(version?)` est la SEULE fonction qui construit l'URL du CDN (refuse `stable`, `nightly`, vide, chemins) ; `EJS_CDN_URL` en dérive.
- `js/data.js` : `validateSystems` refuse une `ejsVersion` mal formée.
- `js/player/launcher.js` : `buildLaunchPlan` prend `ejsDataUrl(system.ejsVersion)` (le paramètre `cdnUrl` explicite reste pour les tests) ; `EJS_pathtodata` et `loaderUrl` en découlent.
- Contournements non modifiés (voir ci-dessous) ; commentaire de `createDiskMenuGuard` mis à jour.
- README (« Versions d'EmulatorJS », « Relever la version ») et `docs/architecture.md` (section 4, 6.1) : pourquoi l'Amiga est sur 4.2.1 et comment revenir à une seule version.
- Tests : `tests/launcher.test.mjs` (URL par machine, plan Amiga/Gods en 4.2.1, plan Neo Geo/Viewpoint en 4.2.3, version invalide), `tests/systems.test.mjs` (format, Amiga seule, URL du vrai fichier), `tests/data.test.mjs` (validation).

## Vérifié dans le source d'EmulatorJS 4.2.1
Fichiers lus : `https://cdn.emulatorjs.org/4.2.1/data/` `loader.js`, `src/emulator.js`, `src/GameManager.js` (comparés à ceux de 4.2.3).
- **getRetroArchCfg (T14)** : VÉRIFIÉ. `EJS_GameManager` est posé sur `window` (GameManager.js dernière ligne), `getRetroArchCfg()` est une méthode de classe appelée par le constructeur (l.36), avant tout `new` : notre surcharge du prototype reste valable. Le fichier est écrit sous `/home/web_user/retroarch/userdata/retroarch.cfg` (4.2.3 : `.config/retroarch/`) : sans effet pour nous, qui ne touchons que le texte renvoyé. Le texte d'origine ne contient aucune de nos clés.
- **allSettings (T10/T14)** : VÉRIFIÉ, sans objet. `allSettings` n'existe pas dans emulator.js 4.2.1 (seulement en 4.2.3 : l.4336, 4538, 4660). Notre `emulator.allSettings ??= {}` est inoffensif.
- **handleSpecialOptions (T10/T14)** : VÉRIFIÉ. Méthode d'instance, branche `option === "disk"` appelle `this.gameManager.setCurrentDisk(value)`. `menuOptionChanged` l'appelle (l.3927). Notre enveloppe (filtre de démarrage, rappel unique) s'applique telle quelle ; le rappel n'est jamais déclenché en 4.2.1 d'après les essais du PO (« 1er appel : ok »). La sélection du disque par défaut au démarrage (`addToMenu`, l.4030) existe aussi en 4.2.1 : le filtre de démarrage reste donc utile.
- **getCurrentDisk / getDiskCount / setCurrentDisk (T12/T16)** : VÉRIFIÉ. `GameManager.js` l.380-387, via `cwrap` `get_current_disk`, `get_disk_count`, `set_current_disk`. `getDiskState` et `switchToDisk` inchangés.
- **EJS_externalFiles** : VÉRIFIÉ. loader.js l.117 ; `loadExternalFiles` (GameManager.js l.77) appelle `downloadFile`, qui accepte `Uint8Array`, `ArrayBuffer` et `Blob` (`toData`, emulator.js l.162) ; `writeFile(path, res.data)` écrit tel quel (BIOS Neo Geo gardé zippé, disquettes `disk1.adf`).
- **EJS_defaultOptions et EJS_disableLocalStorage** : VÉRIFIÉ. loader.js l.103 et 119 ; `preGetSetting` (emulator.js l.3804) lit `defaultOptions` quand le stockage local est coupé ; `changeDiskOption` / `changeSettingOption` les appliquent (l.4110 et 4508).
- **EJS_onGameStart** : VÉRIFIÉ. loader.js l.145 : `on("start", ...)` ; `callEvent("start")` en fin de `startGame` (l.1004).
- **print / printErr via EJS_Runtime (T14 ejs-start-watch)** : VÉRIFIÉ. `initModule` (l.903) appelle `window.EJS_Runtime({... print, printErr ...})` ; notre accesseur sur `window.EJS_Runtime` enveloppe donc les deux. Les fonctions d'origine ne journalisent que si `debug`.
- **Fichier de jeu virtuel (m3u en `File`)** : VÉRIFIÉ pour le chemin de `downloadFile`/`toData` (Blob, donc File) et `gameUrl instanceof File` (l.857).
- **Rapport du cœur** `cores/reports/puae.json` : identique en 4.2.1 et 4.2.3.

## Non vérifié
- Le comportement exécuté de 4.2.1 pour les raccourcis RetroArch coupés (`input_<nom> = "nul"`) et pour l'IPF : lus nulle part dans le source (binaire du cœur). Essais du PO : Gods passe, rien d'autre.
- Rien n'a été lancé dans un navigateur par le développeur (consigne).

## Vérification manuelle
Lancer Gods en vrai : changement de disquette par F9, Select+RB et menu « Disks » ; le journal de diagnostic (`?debug=1`) ne doit montrer aucun « unreachable » et le jeu doit passer la demande de disquette 2. Lancer un jeu Neo Geo : la page charge 4.2.3 (onglet Réseau : `cdn.emulatorjs.org/4.2.3/`). Service worker : version 0.21.0.

## Notes de revue (tech-lead, OK sans correction)
- localStorage et IndexedDB sont partagés entre 4.2.1 (Amiga) et 4.2.3 (autres machines) : même origine, même base.
- Les rapports du cœur puae sont identiques entre les deux versions : la différence est probablement dans le JavaScript d'EmulatorJS ; ne pas généraliser aux autres machines sans essai.
