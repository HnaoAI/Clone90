# T33 : Téléphone en paysage (bouton Jouer toujours visible, commandes hors de l'image)

**Branche** : `ticket/T33-paysage-mobile` - **Version** : 0.33.0
**Demandé par** : Hicham (2026-11-13) : « il faut revoir la place des boutons en mode paysage, je ne peux pas lancer de jeu car le bouton disparaît. Fais des tests avec l'UX sur le mode paysage du téléphone. »

## Constat (Chromium, profil Pixel 7, vrai EmulatorJS 4.2.3)
- Écran Jouer : la pile verticale (jaquette, titre, machine, PRÊT ?, Jouer) fait ~600 px. Page ouverte en portrait puis téléphone tourné : le bouton Jouer est à 513-577 px pour un écran de 360 px, donc hors de l'écran, et rien n'invite à faire défiler. Le haut de la jaquette est coupé (centrage d'une grille qui déborde). Un toucher là où était le bouton ne lance rien. Ouvert directement en paysage, le focus faisait défiler la page jusqu'au bouton, ce qui masquait le défaut.
- En jeu, sur écran 16:9 étroit (640x360, 720x360) : l'image 4:3 ne laisse que 80 à 120 px de chaque côté ; bouton Menu, joystick ou croix, Start / Fast et A/B/X/Y recouvraient l'image. Pixel 7 (863x360) : bandes de 190 px, rien ne recouvrait.

## Avis ux (retenu)
- Écran Jouer en paysage bas : 2 colonnes, jaquette à gauche réglée sur la hauteur visible, titre, machine, PRÊT ? et Jouer à droite, centrage « safe », rien sous le bouton Menu. Les messages d'erreur gardent leur pile.
- En jeu : 160 px réservés de chaque côté (150 px jugés trop justes pour A/B/X/Y), l'image n'est réduite que si ses bandes noires naturelles sont plus étroites.
- Select / Start / Slow / Fast : cibles plus hautes. 48 px demandés ; 40 px retenus, seule hauteur où 2 rangées tiennent sous le joystick (100 px libres) sans le toucher.

## Réalisation (`css/player.css` seulement)
- `@media (orientation: landscape) and (max-height: 500px)` : écran Jouer en grille 2 colonnes, jaquette `min(100dvh - 40px, 260px) * 0,75` de large, marge gauche de 140 px (bouton Menu), titre sur 2 lignes au plus.
- Bloc paysage de téléphone (T31) : `.ejs_canvas_parent` large de `100% - 320px`, centré ; boutons du centre de 40 px de haut.
- `js/version.js` : 0.33.0.

## Critères d'acceptation
1. Après une rotation portrait vers paysage (et en ouvrant directement en paysage), le bouton Jouer et la jaquette sont entiers dans l'écran, sans défilement, hors du bouton Menu ; toucher Jouer lance le jeu.
2. En jeu, en paysage : bouton Menu, ☰, joystick ou croix et tous les boutons virtuels sont dans l'écran, hors de l'image du jeu, sans se chevaucher.
3. Start reste actif.
4. Sur Pixel 7 (863x360), la taille de l'image du jeu ne change pas.

## Tests
- `tests/player-layout.test.mjs` (règles CSS).
- `tests/recette/paysage.mjs` (navigateur, vrais touchers CDP, schéma par défaut et schéma NES, 863x360, 720x360, 640x360, 800x300) : 264 vérifications, toutes passent ; avant correction 56 échecs (Jouer hors écran et toucher sans effet après rotation dans les 8 cas, jaquette coupée dans les 16 cas, 20 recouvrements de l'image en jeu ; 4 « chevauchements » A/B/X/Y étaient de faux positifs, corrigés dans le test : disques comparés par leurs centres).
- Non-régression : `tests/recette/manette-tactile.mjs`, `tests/recette/mobile-menu.mjs`.

## Limites
- Écran 16:9 étroit (640x360) : l'image du jeu est plus petite (environ 320 px de large au lieu de 480) : c'est le prix pour ne rien cacher.
- En dessous de ~290 px de haut en jeu, le joystick touche le bouton Menu (positions d'EmulatorJS).
- Boutons du centre à 40 px de haut, pas 48.
- Non essayé sur un vrai téléphone.

## Vérification manuelle (Hicham)
Sur le téléphone : ouvrir un jeu en portrait, tourner en paysage sur l'écran Jouer : la jaquette est à gauche, le bouton Jouer à droite, entier ; le toucher lance le jeu. En jeu, en paysage, aucun bouton ne passe sur l'image ; Start marche.
