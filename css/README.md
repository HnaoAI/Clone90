# css/

Feuilles de style du style « Swared » (T54, après Y2K T41 et « Cartouche bleue » T24). Toute couleur est une variable de `base.css` (bloc `:root`), et nulle part ailleurs.

- `base.css` : palette, polices (Nunito, Press Start 2P), fond anthracite, en-tête, boutons, focus, toast, boîte de dialogue, `prefers-reduced-motion`.
- `dock.css` : barre de navigation du bas (T41), grise et flottante depuis T54.
- `home.css` : accueil (nombre total de jeux, cartes des machines, flèche, machines à 0 jeu).
- `grid.css` : en-tête des écrans secondaires (retour rond, titre centré), grille de jeux (cartes, pochettes 3:4), état vide.
- `library.css` : écran « Mes fichiers » (T27).
- `player.css` : page de jeu (écran Jouer, « PRÊT ? », bouton Menu et anneau, rappel de sortie, panneau de diagnostic).

Tests : `tests/design.test.mjs`. Maquette de référence : `docs/ux.md` (section 5).
