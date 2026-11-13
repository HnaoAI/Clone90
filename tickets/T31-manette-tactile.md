# T31 : Manette tactile sur téléphone (joystick gris clair, boutons hors de l'image en paysage)

**Branche** : `ticket/T31-manette-tactile` - **Version** : 0.31.0
**Demandé par** : Hicham (2026-11-13) : « changer la couleur du joystick sur l'émulateur du téléphone, remplace le rouge par du gris clair. Quand je mets le jeu en mode paysage, les 4 boutons Select, Start, Slow et Fast s'impriment sur l'espace dédié au jeu. Décale-les sous le joystick. »

## Constat (Chromium, profil Pixel 7, vrai EmulatorJS 4.2.3)
- Le joystick rouge est la zone nipplejs du schéma de manette par défaut d'EmulatorJS (Amiga, arcade, Neo Geo, Mega Drive...). Les machines à croix (NES, Game Boy...) n'en ont pas.
- En paysage, l'image du jeu est centrée sur toute la hauteur ; les boutons du centre (Select, Start, Slow, Fast) étaient posés sur elle, en bas au milieu.

## Réalisation (`css/player.css` seulement)
- Joystick : `background: lightgray !important` sur les disques de nipplejs (couleur écrite en style en ligne), opacités relevées (sinon gris foncé sur fond noir).
- Paysage de téléphone (`orientation: landscape` et `min-aspect-ratio: 3/2`, complément du bloc portrait de T28) : groupe des boutons du centre en grille 2 colonnes, à gauche, largeur du joystick, sous lui. Ordre : Select, Start, puis Slow, Fast. Portrait inchangé.
- `js/version.js` : 0.31.0.

## Critères d'acceptation
1. Le joystick tactile est gris clair (plus rouge), en portrait et en paysage.
2. En paysage, Select, Start, Slow et Fast ne recouvrent plus l'image du jeu : ils sont sous le joystick, dans l'écran, sans se chevaucher.
3. En portrait, ils restent hors de l'image (inchangé).
4. Les boutons déplacés restent actifs.

## Tests
- `tests/player-layout.test.mjs` (règles CSS).
- `tests/recette/manette-tactile.mjs` (navigateur, Pixel 7 portrait et paysage, schéma par défaut et schéma NES) : 38 vérifications, échoue avant (joystick rouge, 8 recouvrements en paysage), passe après. Outils partagés avec T28 dans `tests/recette/mobile-menu-lib.mjs`.

## Limites
- Plus de 4 boutons au centre (aucune machine de Clone90 aujourd'hui) : une 3e rangée toucherait le joystick.
- Mode gaucher d'EmulatorJS (joystick à droite) : les boutons restent à gauche.
- La barre d'outils d'EmulatorJS, quand on touche l'écran, passe quelques secondes par-dessus la rangée Slow / Fast (comme avant, où elle passait sur l'image).
- Non essayé sur un vrai téléphone.

## Vérification manuelle (Hicham)
Sur le téléphone, lancer un jeu Amiga ou Neo Geo : joystick gris clair. Passer en paysage : Select, Start, Slow et Fast sont sous le joystick, plus sur l'image.
