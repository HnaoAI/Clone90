# T22 : sons « samples » pour l'arcade (fbneo)

**Dépend de** : T21
**Branche** : `ticket/T22-samples-arcade` - **Version** : 0.22.0

## Problème
Hicham n'a pas de son sur Zaxxon (`roms/arcade/zaxxon.zip`). Dans FBNeo (`src/burn/drv/sega/d_zaxxon.cpp`), Zaxxon déclare `zaxxonSampleInfo` / `zaxxonSampleName` et tout son son passe par `BurnSamplePlay`. Le cœur libretro cherche ces samples dans `<system_dir>/fbneo/samples/<nom du romset>.zip`.

## Vérifié dans le source
- **FBNeo libretro** (`src/burner/libretro/libretro.cpp`, branche master) : `g_system_dir` vient de `RETRO_ENVIRONMENT_GET_SYSTEM_DIRECTORY` (l.2127), sinon le dossier de la ROM (l.2132) ; `szAppSamplesPath = "<g_system_dir>/fbneo/samples/"` (l.2143) ; le cœur appelle `path_mkdir(szAppSamplesPath)` (l.2173).
- **EmulatorJS 4.2.3** (`GameManager.js`) : `getRetroArchCfg()` (l.139-156) n'écrit AUCUN `system_directory` (seulement `savefile_directory = "/data/saves"` et `screenshot_directory = "/"`). Le dossier système n'est donc pas fixé par la configuration. Le jeu arcade est écrit en chemin relatif (`emulator.js` l.789-790, `FS.writeFile("zaxxon.zip")`), à la racine. Le constat de T0 (`/neogeo.zip` trouvé) montre que le dossier système effectif est `/`. Origine exacte : valeur par défaut de RetroArch (dossier du contenu), pas la configuration. Conséquence : `/fbneo/samples/<romset>.zip`.
- **EJS_externalFiles** (`GameManager.js` l.88-120) : `writeFile(path, res.data)` (l.114). `writeFile` (l.122-132) crée chaque dossier parent (`mkdir` sans erreur s'il existe). `/fbneo/samples/zaxxon.zip` est donc créé avec ses dossiers. Le téléchargement doit être un `Uint8Array` (comme pour `neogeo.zip`, T0).

## Réalisation
- `systems.json` : champ facultatif `samples: {dir, fsDir}` sur `neogeo` et `arcade` (`dir` sous `bios/`, `fsDir` dans le cœur). Seule source de vérité, aucun chemin en dur ailleurs.
- `js/data.js` : `validateSystems` valide `samples`.
- `js/player/launcher.js` : `resolveSamples(system, game)` (nom du romset = fichier du jeu sans extension, nom inhabituel : pas de samples) ; `buildLaunchPlan` ajoute le fichier à `rawFiles` et à `files` (`kind: 'samples'`, facultatif). `checkPlanFiles` retire le pack absent (contrôle HEAD, pas de 404 bloquant).
- Serveur local et service worker : rien à changer (`bios/` déjà en liste blanche, `bios/` déjà jamais en cache), tests ajoutés. Générateur : ne lit que `roms/`, test ajouté.
- README (Arcade) et `docs/architecture.md` (3.4).
- Tests : `tests/samples.test.mjs`.

## HYPOTHÈSES à confirmer en jeu
1. Le dossier système effectif du cœur est bien `/` (déduit de T0, pas de `system_directory` dans le cfg), donc le pack posé en `/fbneo/samples/zaxxon.zip` est trouvé.
2. Le pack de samples de Zaxxon correspond à ce que FBNeo attend (nom `zaxxon.zip`, fichiers `.wav` aux noms de `zaxxonSampleInfo`).
3. Les clones (ex. `zaxxonb`) réutilisent les samples du parent : le pack porte alors le nom que FBNeo demande, pas forcément celui de la ROM.

## Vérification manuelle
Poser `bios/samples/zaxxon.zip` (pack de samples), lancer Zaxxon : le son doit être audible. Sans le fichier : le jeu se lance comme avant, sans erreur. Journal de diagnostic (`?debug=1`) : la ligne « Setting system dir to ... » du cœur confirme l'hypothèse 1.

## Test existant adapté
`tests/launcher.test.mjs`, « arcade (systems.json réel) : neogeo.zip présent... » : son HEAD répondait vrai pour tout, donc les samples entraient dans `rawFiles`. Le HEAD ignore maintenant `bios/samples/` ; l'intention du test (neogeo.zip seul) est inchangée, les samples ont leur test (`tests/samples.test.mjs`).

## Notes de revue (tech-lead, OK sans correction)
Adaptation du test acceptée. Pour plus tard : les clones (ex. `zaxxonb`) demandent le pack de leur parent, prévoir alors un champ facultatif par jeu.
