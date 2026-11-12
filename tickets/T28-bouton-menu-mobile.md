# T28 : Bouton Menu qui recouvre le jeu sur Android

**Branche** : `ticket/T28-bouton-menu-mobile`
**Demandé par** : Hicham (2026-11-12) : « le bouton menu est mal placé, il est en haut à droite de l'écran sur une partie de l'écran de jeu. Fais un test sur un simulateur android. »

## Constat (Chromium, profil Pixel 7, vrai EmulatorJS 4.2.3, ROM NES homebrew)
- Portrait : EmulatorJS colle l'image du jeu en haut de l'écran. Notre bouton « Menu » (haut gauche) et le ☰ d'EmulatorJS (haut droite, 24 px) étaient posés sur l'image.
- Paysage : l'image est centrée, les deux boutons sont dans les bandes noires ; mais le ☰ ne faisait que 24 px.

## Réalisation
- `css/player.css` : en portrait et sur écran presque carré (`max-aspect-ratio: 3/2`, tablette), une barre de 80 px (+ safe-area) est réservée en haut ; `#game` commence dessous (hauteur réduite d'autant, sinon les contrôles virtuels sortent de l'écran).
- Le ☰ d'EmulatorJS est rangé dans cette barre, à droite, cible de 48 px. En paysage de téléphone, rien ne change pour l'image.
- `css/base.css` : `--player-bar: 0px` par défaut. `js/version.js` : 0.28.0.

## Critères d'acceptation
1. Sur téléphone en portrait, ni le bouton Menu ni le ☰ ne recouvrent l'image du jeu.
2. En paysage, idem, et l'image garde toute la hauteur.
3. Les deux boutons font au moins 48 x 48 px et restent actifs.

## Tests
`tests/player-layout.test.mjs` (règles CSS) et `tests/recette/mobile-menu.mjs` (navigateur, mesure des pixels de l'image du jeu) : échoue avant, passe après.

## Limites
- En mode `debug=1`, la pastille Diag repliée se pose sur le ☰ (mode de diagnostic seulement).
- Non essayé sur un vrai téléphone.

## Vérification manuelle (Hicham)
Sur le téléphone, lancer un jeu en portrait puis en paysage : le bouton Menu et le ☰ ne cachent plus l'image.
