# T18 : disquettes à noms simples (Disk1...) et prise en charge de l'IPF

**Dépend de** : T2, T10
**Branche** : `ticket/T18-disques-ipf`

## Besoin
Hicham a mis `Leander_Disk1.ipf`, `Leander_Disk2.ipf`, `Leander_Disk3.ipf` dans `roms/Amiga/Leander (1991)(Psygnosis)[0496]/`. Le générateur en faisait 3 jeux. De plus on ignorait si l'IPF est lisible.

## Fait
- Générateur : regroupe aussi `Disk1`, `Disk_1`, `Disk-1`, `Disk 1`, `_Disk1`, `Disque1`, `Disc1` et `Nom_D1` (`parseLooseDiskTag`). Conditions : même dossier, même extension, même nom de base, numéros 1..n sans trou (n >= 2). Sinon jeux simples (avertissement si plusieurs fichiers non consécutifs). `Disk Wars` n'est pas une étiquette (pas de numéro). `LeanderD1` non plus. Titre : nom de base, ou nom du dossier si la base est vide (`Disk1.adf`). Les règles TOSEC, m3u, cue, doublons, casse sont inchangées.
- Avertissement du générateur pour tout jeu `.ipf`.
- Écran « Ce jeu n'a pas pu démarrer » : explication IPF si le jeu est un `.ipf` ou si puae parle de C.A.P.S. / capsimg.
- Champ `diskSets: true` dans systems.json (Amiga seule) : le générateur ne regroupe que pour ces machines, et le lanceur ignore `disks` ailleurs.
- Version 0.18.0.

## Conclusion IPF : non pris en charge d'après l'analyse du cœur 4.2.3 (puae 2.0.2), non confirmé en navigateur
Preuves (téléchargement de `https://cdn.emulatorjs.org/4.2.3/data/cores/puae-wasm.data`, archive 7z contenant `puae_libretro.wasm`) :
1. Le wasm contient `.ipf`, `capsimg.so`, `CAPSInit`, `CAPSLockImage`..., `Failed to load CAPS plug-in.`, `CAPS library '%s' not found!` : le code IPF est compilé en mode « plugin chargé à l'exécution ». Dans libretro-uae (`sources/src/caps/caps.c`), ce mode est le cas `#ifndef HAVE_CAPS_CAPSIMAGE_H` (le Makefile n'active le lien statique que pour `capsimg=1`) : `load_capslib()` appelle `uae_dlopen("<dossier système>/capsimg.so")`, via `dlopen` (`sources/src/caps/uae_dlopen.c`).
2. Le même wasm contient `dynamic linking not enabled` (stub dlopen d'Emscripten sans MAIN_MODULE) et le glue `puae_libretro.js` ne contient aucune trace de `dlopen`/`dynamicLibraries`. dlopen échoue donc toujours.
3. `cores/capsimg.so` et `capsimg.so` répondent 404 sur la CDN 4.2.3 ; `src/emulator.js` ne cite ni capsimg ni ipf.
4. Si le chargement échoue, `caps_init()` écrit « Failed to load CAPS plug-in. » dans le journal, affiche « CAPS library 'capsimg.so' not found! » (message à l'écran) et appelle `gui_message("This disk image needs the C.A.P.S. plugin which is available from http://www.softpres.org/download")` (chaîne présente dans le wasm).
Limite : preuve par lecture du binaire et du source, PAS d'essai en navigateur (interdit). On ne sait pas si l'écran d'échec s'affichera : la détection T14 ne réagit qu'aux lignes `[ERROR] [Content]`, or puae peut démarrer sans erreur de contenu avec un lecteur vide. TODO(T19) : confirmer ce que voit le joueur avec un vrai IPF.

## Vérification manuelle (Hicham)
1. `node scripts/generate-games.mjs` : Leander apparaît en UNE tuile avec 3 disquettes, et un avertissement IPF.
2. Lancer Leander en IPF : attendu, il ne démarre pas (écran « insérez une disquette » ou message d'échec expliquant l'IPF). Dire ce qui s'affiche.
3. Avec des ADF de Leander : une tuile, 3 disquettes (comme T10).
