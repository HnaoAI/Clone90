# T38 : scanner le dossier des jeux, machine par machine

**Branche** : `ticket/T38-scan-roms` - **Version** : 0.38.0
**Demandé par** : Hicham (2026-11-14), plan validé le 2026-11-14 : ajouter un scan du dossier roms/ pour chaque machine, pour lister automatiquement les jeux et pouvoir y jouer. Le scan passe par « Mes fichiers ».

## Réalisation
- « Mes fichiers » (`#/fichiers`) : nouvelle rubrique en tête, « Importer tout un dossier », bouton **Choisir le dossier des jeux** (sélecteur de dossier du navigateur, `webkitdirectory`). Sans ce sélecteur, une phrase renvoie à l'ajout machine par machine.
- `js/folder-scan.js` (pur) : dans le chemin de chaque fichier, le premier dossier qui porte l'id d'une machine (sans tenir compte de la casse) ou `bios` décide du rangement. On peut donc choisir roms/, son parent (roms/ + bios/) ou le dossier d'une machine.
  - Jeux : `roms/<machine>/<fichier>`. Un niveau de sous-dossier est lu (comme le générateur du Mac) et rangé à plat, car la bibliothèque locale ne garde que des fichiers directement dans le dossier de la machine (règle de T27).
  - Formats gardés : extensions de la machine (systems.json), jaquettes, .m3u, .bios, pistes d'un .cue (.bin, .wav…) pour une machine qui lit les .cue. Le reste est ignoré et compté.
  - BIOS : bios/ et tout BIOS déclaré trouvé avec les jeux (neogeo.zip dans roms/neogeo/) vont dans `bios/` sous le nom exact. **neogeo.zip n'est jamais un jeu.**
  - Fichiers cachés (.DS_Store, ._ de macOS, __MACOSX) ignorés sans être comptés. Fichier déjà présent (même chemin, même taille) : pas recopié.
- Résumé gardé à l'écran sous le bouton : « Dossier importé : Amiga 3 fichiers, Neo Geo 1 fichier ; 2 BIOS ; 1 déjà présent ; 2 fichiers ignorés… ».
- `js/games-builder.js` (partagé avec le Mac) : un BIOS déclaré pour une machine, rangé dans son dossier de jeux, n'est plus listé comme jeu ; le générateur l'indique (« rangez-le dans bios/ »).
- Rien n'est envoyé (règle 5), rien n'est mis en cache (règle 6, chemins roms/ et bios/ inchangés). Mac (games.json) inchangé, sauf la règle du BIOS ci-dessus.

## Critères d'acceptation
1. Chaque sous-dossier de machine est rangé sous `roms/<machine>/`, quel que soit le dossier choisi (roms/, son parent, une machine) et la casse.
2. neogeo.zip reste dans bios/ et n'apparaît pas comme jeu (scan, bibliothèque, générateur du Mac).
3. bios/ importé avec le nom exact attendu ; nom inattendu gardé et signalé.
4. Formats non pris en charge et dossiers inconnus ignorés ; fichiers cachés ignorés.
5. Jaquettes, .m3u, .bios, pistes de .cue gardés ; un jeu Mega-CD en sous-dossier reste jouable.
6. Un nouveau scan ne recopie pas les fichiers déjà présents.
7. Jeux Amiga à plusieurs disquettes regroupés comme sur le Mac.
8. Message de fin clair, gardé à l'écran (rien trouvé, navigateur sans dossiers, copie interrompue).
9. Bouton navigable (clavier, manette), désactivé pendant la copie, remplacé par une phrase si le navigateur ne sait pas choisir un dossier.

## Tests
`tests/folder-scan.test.mjs` (20 tests). Recette `tests/recette/scan-dossier.mjs` (Chromium, ordinateur et Pixel 7, vrai sélecteur de dossier, IndexedDB, service worker) : 18/18.

## Limites
- Sélecteur de dossier : Chrome, Edge, Firefox et Safari sur ordinateur. Sur téléphone Android, Chrome le propose selon la version : sinon le message renvoie à l'ajout machine par machine. Non essayé sur un vrai téléphone.
- Deux fichiers de même nom dans deux sous-dossiers d'une même machine : seul le premier est gardé (pistes « Track 01.bin » de deux jeux CD différents).
- Les fichiers sont copiés dans le navigateur : la place du téléphone limite les gros dossiers.

## Vérification manuelle (Hicham)
Sur le Mac dans Chrome (ou sur le téléphone), Clone90, Mes fichiers, Choisir le dossier des jeux, choisis ton dossier roms (ou celui qui contient roms et bios). Lis le résumé, reviens aux machines : chaque machine montre ses jeux, Neo Geo sans « neogeo ». Lance un jeu.
