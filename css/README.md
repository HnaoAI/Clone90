# css/

Feuilles de style du style Y2K (T41, après « Cartouche bleue » T24). Toute couleur est une variable de `base.css` (bloc `:root`), et nulle part ailleurs.

- `base.css` : palette, formes « gel », fond dégradé, en-tête chromé, boutons, focus et curseur clignotant, toast, boîte de dialogue, `prefers-reduced-motion`.
- `dock.css` : barre de navigation du bas (T41).
- `home.css` : accueil (bulles des machines, voyants de jeux, machines à 0 jeu).
- `grid.css` : grille de jeux (tuiles 3:4, plaque de titre, état vide, bouton retour).
- `library.css` : écran « Mes fichiers » (T27).
- `player.css` : page de jeu (écran Jouer, « PRÊT ? », bouton Menu et anneau, rappel de sortie, panneau de diagnostic).

Tests : `tests/design.test.mjs`. Maquette de référence : `docs/ux.md` (section 5).
