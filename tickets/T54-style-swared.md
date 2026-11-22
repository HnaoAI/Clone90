# T54 : style « Swared » (anthracite et vert)

**Branche** : `ticket/T54-style-swared` - **Version** : 0.54.0
**Demandé par** : Hicham (2026-11-22) : « refaire le design en copiant celui-ci » (planche « Swared, Wallet / Screens »), « fais-moi voir les maquettes avant de changer le design ». Maquette validée le 2026-11-22 (« ok je valide mais enlève mon prénom ») : `maquette-swared.html` et `captures/Swared/` des fichiers du projet. Choix validés avec elle : les libellés restent sous les icônes de la barre du bas ; aucun prénom dans l'interface.

Remplace le style Y2K (T41) : palette, police, cartes, boutons, barre du bas, boîtes. Mêmes écrans, mêmes textes, mêmes `data-nav-id` : aucune fonction ne change.
Découpage : les rubriques de « Mes fichiers » en lignes qui s'ouvrent une par une (aussi validées avec la maquette) changent le comportement de l'écran : ticket suivant (T55). Ici, « Mes fichiers » prend seulement le nouveau style.

## Critères d'acceptation
1. Palette dans le seul bloc `:root` de `css/base.css` : fond anthracite (plus clair en haut), cartes presque noires, fine bordure claire, une seule couleur d'accent vert vif `#3fd04a` ; aucune couleur littérale ailleurs.
2. Contrastes : texte >= 4.5:1 sur chaque fond (cartes, lignes, barre du bas), texte sombre sur le vert ; anneau de focus et bordure de sélection >= 3:1.
3. Police ronde Nunito (licence OFL, fichiers dans `assets/fonts/`, gardée hors ligne par le service worker) pour l'interface ; Press Start 2P reste pour les visuels de repli (logos, jaquettes) et l'écran de jeu.
4. En-tête : marque « C90 » (deux traits arrondis vert et blanc) et « Clone90 » avec « 90 » en vert ; plus de plaque chromée ni de pastille rose ni de jauge.
5. Accueil : nombre total de jeux en gros chiffre vert centré au-dessus de « Choisis une machine » (absent s'il n'y a aucun jeu) ; machines en cartes noires (logo dans une tuile, nom, nombre de jeux, flèche) ; plus de voyants ; machine à 0 jeu : logo délavé, nom en texte discret, pas de flèche, toujours en fin de liste.
6. Sélection (clavier, manette) : bordure verte, halo, flèche dans un disque vert, nombre de jeux en vert, agrandissement 1.05 ; jamais la couleur seule (forme du disque et agrandissement).
7. Écrans secondaires (grille, Mes fichiers, Page web) : bouton retour rond avec flèche, titre centré, nombre de jeux en vert ; pochettes dans des cartes arrondies, titre vert quand la pochette est sélectionnée.
8. Boutons : principal vert plein (texte sombre), secondaires sombres à fine bordure claire, danger en texte rouge ; cibles d'au moins 48 px (Jouer : 64 px).
9. Barre du bas grise flottante, icônes fines, libellés dessous, onglet actif en vert avec un point dessous ; mêmes onglets, mêmes conditions, absente pendant le jeu.
10. Boîtes (confirmation avant de quitter, dossiers, partage) : carte noire arrondie, titre centré, bouton de confirmation vert ; textes et focus par défaut inchangés.
11. `prefers-reduced-motion` : pas d'agrandissement ni de transition ; seul « PRÊT ? » clignote (le curseur ▶ des tuiles disparaît avec ce style).
12. Icône de l'application et couleur du thème (manifeste, `theme-color`) reprises de la nouvelle palette.

## Vérification manuelle (Hicham)
Sur le téléphone et sur le Mac : fond anthracite, machines en cartes noires avec le nombre total de jeux en vert en haut, barre grise en bas. Avec une manette ou les flèches, la machine choisie a une bordure verte et une flèche dans un rond vert. Ouvre une machine, puis un jeu : bouton « Jouer » vert ; pendant la partie, « Menu » demande toujours « Quitter … ? ». Sur le Mac, « Dossiers » puis « Partager avec le téléphone » : boîtes noires, boutons verts.
