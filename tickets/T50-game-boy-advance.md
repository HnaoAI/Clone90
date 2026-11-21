# T50 : Game Boy Advance

**Branche** : `ticket/T50-gba` - **Version** : 0.50.0
**Demandé par** : Hicham (2026-11-21) : « on peut ajouter la game boy advance ? », puis « ajoute La Game Boy Advance ».

## Vérifié dans EmulatorJS 4.2.3 (2026-11-21, paquets npm `@emulatorjs/emulatorjs` et `@emulatorjs/core-mgba` 4.2.3)
- `getCores()` : alias `gba` -> cœur `mgba` (seul). Licence du cœur : MPL-2.0 (chargé depuis le CDN, rien d'ajouté au dépôt).
- `core.json` : extensions `gb, gbc, gba`. Le cœur cherche `gba_bios.bin` (et `gbc_bios.bin`, `sgb_bios.bin`) dans son dossier système.
- Manette tactile : EmulatorJS a un schéma `gba` (getControlScheme) avec croix, A, B, **L, R**, Start, Select, et les boutons de vitesse.
- Fichier du cœur pour le jeu hors ligne : `cores/mgba-legacy-wasm.data` (1,05 Mo), `mgba-wasm.data` (1,06 Mo) si le rapport demandait WebGL 2.

## Choix
- Machine `gba`, dossier `roms/gba/`, formats `.gba` et `.zip`. Les `.gb` et `.gbc` restent à la Game Boy Color (inchangée).
- `gba_bios.bin` facultatif, posé s'il existe (`preload`, comme `gbc_bios.bin`) : sans lui, mGBA démarre le jeu directement.
- Pochettes : `Nintendo_-_Game_Boy_Advance` (libretro-thumbnails) ; vrai logo : dossier `gba` du thème es-theme-carbon (commit figé, vérifié en lecture).
- Logo maison et couleur `--m-gba` (#4b3a9e). Entrée placée en fin de systems.json, `order` 125 (affichée juste après la Game Boy Color) : les logos maison des autres machines ne changent pas (leur forme dépend du rang dans le fichier).
- Rien à changer dans le scan de dossier (T38), la synchro (T43), l'envoi au Mac (T44), « Depuis une page web » (T34) ni le jeu hors ligne (T46) : tout est lu dans systems.json. Des tests le vérifient.

## Critères d'acceptation
1. T50 la Game Boy Advance est une machine : id gba, alias gba (cœur mgba), wave 2, rangée juste après la Game Boy Color.
2. T50 `.gba` et zip seulement ; `.gb` et `.gbc` restent à la Game Boy Color.
3. T50 BIOS `gba_bios.bin` facultatif, posé s'il existe, jamais requis ; sans lui le jeu démarre.
4. T50 pochettes, dossier du thème, logo maison et couleur propres (contraste 4.5:1).
5. T50 jeu hors ligne : le cœur mgba est dans la liste.
6. T50 scan de dossier, synchro, envoi au Mac et « Depuis une page web » reconnaissent `roms/gba/` et `gba_bios.bin`.
7. T50 téléphone : manette tactile avec L, R, A, B, Start, Select, dans l'écran et hors de l'image du jeu (recette `tests/recette/gba.mjs`).
8. Version 0.50.0.

## Vérification manuelle (Hicham)
1. Mac : créer `roms/gba/`, y mettre un jeu `.gba` que vous possédez ; relancer Clone90 : la tuile Game Boy Advance montre le jeu, il démarre. Facultatif : `bios/gba_bios.bin` pour le logo de démarrage.
2. Mac : « Dossiers des jeux » > « Télécharger les logos des machines » : la Game Boy Advance a son vrai logo.
3. Téléphone : synchroniser avec le Mac, ouvrir le jeu : boutons L et R en haut, A/B à droite, Start/Select au centre, en portrait et en paysage.
4. Téléphone : « Préparer le jeu hors ligne », puis mode avion : le jeu GBA démarre.
