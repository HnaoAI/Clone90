# T37 : réglette pour régler la taille de l'image du jeu (ordinateur)

**Branche** : `ticket/T37-taille-ecran` - **Version** : 0.37.0
**Demandé par** : Hicham (2026-11-13) : « Peut-on avoir une réglette avec un curseur sur le côté sur écran d'ordinateur pour régler la taille de l'écran ? J'aimerais rétrécir l'image à ma convenance. » Plan validé le 2026-11-13 (`plans/T37-reglette-taille-ecran.md` des fichiers du projet), précisions : une taille par machine, 40 % minimum.

## Critères d'acceptation
1. Réglette verticale sur le bord droit de l'écran de jeu, à mi-hauteur, taille affichée (« 75 % »).
2. De 40 % à 100 % par pas de 5 ; l'image reste entière, garde ses proportions et reste centrée, tour noir.
3. Une taille gardée par machine, retrouvée au jeu suivant ; stockage refusé ou abîmé : 100 %, sans erreur.
4. Double-clic sur la réglette : 100 %.
5. Après un réglage à la souris, le focus revient au jeu (les flèches ne bougent pas la réglette).
6. Discrète pendant le jeu, cachée après 3 s sans mouvement de souris, comme le bouton Menu.
7. Téléphone et tablette (tactile) : pas de réglette, affichage inchangé.

## Vérification manuelle (Hicham)
Sur le Mac, lance un jeu, bouge la souris : la réglette apparaît à droite. Descends-la : l'image rétrécit au centre. Quitte, relance un jeu de la même machine : même taille. Un jeu d'une autre machine : 100 %. Double-clic sur la réglette : 100 %.
