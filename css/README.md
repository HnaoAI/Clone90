# css/

Feuilles de style du design « Cartouche bleue » (T24). Toute couleur est une variable de `base.css` (bloc `:root`), et nulle part ailleurs.

- `base.css` : palette, cadres pixel, fond rayé, en-tête, boutons, focus et curseur clignotant, toast, boîte de dialogue, `prefers-reduced-motion`.
- `home.css` : accueil (tuiles de machines, jauge de jeux, machines à 0 jeu).
- `grid.css` : grille de jeux (tuiles 3:4, plaque de titre, état vide, bouton retour).
- `player.css` : page de jeu (écran Jouer, « PRÊT ? », bouton Menu et anneau, rappel de sortie, panneau de diagnostic).

Tests : `tests/design.test.mjs`. Maquette de référence : `docs/ux.md` (section 5).
