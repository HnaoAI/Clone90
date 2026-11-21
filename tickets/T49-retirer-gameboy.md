# T49 : retirer la Game Boy d'origine

Demande de Hicham (2026-11-21) : « tu peux enlever la gameboy », précisé « la Game Boy d'origine ». Plan validé (« Oui, lance »).

## Périmètre
- Retirer la machine `gameboy` de `systems.json` (accueil, « Mes fichiers », « Depuis une page web », synchro), son logo maison et sa couleur `--m-gameboy`.
- Garder la Game Boy Color entière : même alias de cœur `gb` (gambatte), donc gambatte reste dans la liste du jeu hors ligne (`js/player/ejs-files.js` inchangé).
- Aucun fichier de la personne effacé : `roms/gameboy/` sur le Mac et les jeux Game Boy du téléphone deviennent invisibles.

## Critères d'acceptation
1. T49 la Game Boy d'origine n'est plus une machine (ni id gameboy, ni nom « Game Boy », ni extension .gb, ni gb_bios.bin).
2. T49 la Game Boy Color reste entière : cœur gb (gambatte), .gbc et zip, BIOS gbc_bios.bin facultatif posé.
3. T49 jeu hors ligne : gambatte reste dans la liste des cœurs (utilisé par la Game Boy Color).
4. T49 un jeu Game Boy d'une ancienne bibliothèque est écarté sans erreur (machine retirée), les autres restent.
5. T49 plan : un fichier venu du Mac d'une machine retirée (Game Boy) n'est jamais effacé du téléphone.
6. T49 synchro : syncFromMac garde les jeux d'une machine retirée venus du Mac.
7. Un dossier « game-boy » d'une page web n'envoie plus ses jeux chez la Game Boy Color ; `gb_bios.bin` n'est plus un BIOS déclaré.

## Conséquence connue
Les logos maison sont dessinés avec une forme décorative choisie par le rang de la machine : celles de Game Boy Color, PC Engine et PC Engine CD changent (logos régénérés par `node scripts/generate-logos.mjs`).

## Vérification manuelle
- Mac : l'accueil n'affiche plus la Game Boy ; la Game Boy Color s'ouvre toujours ; `roms/gameboy/` est toujours sur le disque.
- Téléphone : après synchro, les jeux Game Boy venus du Mac ne sont pas effacés (invisibles).
- Pour rejouer un jeu `.gb` : le renommer en `.gbc` et le mettre dans `roms/gameboycolor/`.
