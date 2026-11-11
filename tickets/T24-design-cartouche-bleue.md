# T24 : design « Cartouche bleue »

**Dépend de** : T22
**Branche** : `ticket/T24-design-cartouche-bleue` - **Version** : 0.24.0

## Origine
Design validé par Hicham (« je valide », 2026-11-11), y compris le clignotement doux du curseur et de « PRÊT ? » (1 Hz, coupé par `prefers-reduced-motion`). Conception d'ux : maquette `maquette.html` et `proposition.md` (dossier de session, non versionné). Style original : aucun nom, personnage, sprite, logo, police, son ni écran d'un jeu existant.

## Réalisation
- **Palette** : `css/base.css` (bloc `:root`) est l'unique source des couleurs. Variables de la proposition ; les teintes de biseau, de hachure et de voile utilisées par la maquette en dur y sont devenues des variables (`--accent-hi/-lo`, `--danger-hi/-lo`, `--disabled-hi/-lo`, `--stripe-a/-b`, `--scrim`, `--scrim-strong`, `--bg-deep`, `--band-deep`). Cadres pixel = variables `--frame*` (box-shadow). Anciennes variables `--surface`, `--surface-2`, `--border`, `--disabled`, `--radius` supprimées. Couleurs machine `--m-*` inchangées.
- **CSS** : `base.css` (fond rayé, en-tête avec jauge de 4 barres, boutons, toast, boîte avec barre de titre rayée, focus, curseur, `@keyframes blink`), `home.css` (tuile, jauge, vide, focus), `grid.css` (jaquette cadrée, plaque de titre, état vide), `player.css` (écran Jouer, `PRÊT ?`, Menu, anneau, rappel de sortie, diagnostic). Nouveau `css/README.md`.
- **Curseur ▶** : pseudo-élément `::before` (aucun balisage JS, `content` avec alternative vide donc non lu, FE0E pour la forme texte), visible sur l'élément focalisé seulement (mêmes sélecteurs que l'anneau : `:focus-visible` et `.input-gamepad`). Clignote 1 s par `steps(1)`. Écart voulu avec la proposition (spans `aria-hidden`) : moins de JS, aucun test existant touché.
- **Focus** : anneau cyan 4 px décalé de `--focus-offset` (8 px, 4 px sous 600 px), cadre et plaque de nom jaunes, échelle 1.05. `scroll-margin` porté à 32 px.
- **JS (balisage seulement)** : `js/ui/machine-grid.js` (`gaugeSegments`, `GAUGE_SEGMENTS`, jauge `aria-hidden` dans le logo), `js/ui/dialog.js` (corps dans `.dialog-body`), `js/player/player-ui.js` (`READY_LABEL`, mention « PRÊT ? » `aria-hidden` avant le bouton Jouer, flèche ◀ du Menu, `rx` de l'anneau supprimé), `js/ui/game-grid.js` (flèche ◀ du retour, `--disabled-bg`), `js/ui/logo.js` (`--panel-2`). `index.html` : jauge décorative d'en-tête. Logique, navigation et ordre du focus inchangés (le bouton Jouer reste le dernier élément de l'écran Jouer).
- **Pages et manifeste** : `theme-color`, `theme_color` et `background_color` à `#0a1233`.
- **Logos et icônes** : nouveau `scripts/css-colors.mjs` (lecture des variables, contraste). `generate-logos.mjs` : texte `#ffffff` (= `--text`), contrôle 4.5:1 conservé, SVG régénérés. `generate-icons.mjs` lit `--bg` et `--accent` dans `base.css`, PNG régénérés.
- **Docs** : `docs/ux.md` (principe 1 : clignotement autorisé pour le curseur et « PRÊT ? » seulement ; 4.3 focus ; 5.1 à 5.5 ; CA-V1, V4, V7), README (section Apparence), README de `scripts/`, `js/`, `tests/`, `docs/architecture.md`.
- **Version** 0.24.0.

## Critères d'acceptation et tests
- Palette et valeurs de la maquette, contrastes texte 4.5:1 (y compris chaque `--m-*`, les fonds profonds et `--danger-text`) et non textuels 3:1, contrastes de la proposition retrouvés : `tests/design.test.mjs`.
- Une seule source des couleurs : aucune couleur littérale hors `:root`, toute variable utilisée est déclarée, logos/manifeste/pages/icônes alignés sur `base.css` : `tests/design.test.mjs`.
- `prefers-reduced-motion` : règle globale sur `*, *::before, *::after`, toute animation trouvée dans `css/` (curseur en `base.css`, « PRÊT ? » en `player.css`) a un `@keyframes` connu, période 1 s : `tests/design.test.mjs`.
- Focus 4 px, cibles 48 px, coins carrés et sans `clip-path`, grilles à 2 colonnes souples à 360 px : `tests/design.test.mjs`.
- Jauge (`gaugeSegments`, rendu) : `tests/machine-grid.test.mjs`. « PRÊT ? » : `tests/player-ui.test.mjs`.

## Tests existants adaptés (intention inchangée)
- `tests/pwa.test.mjs` : couleurs du manifeste attendues `#0f1117` devenues `#0a1233` (nouveau fond). Le test continue de vérifier que thème et fond du manifeste sont fixés.
- `tests/machine-grid.test.mjs` : repli neutre de `accentVar` `var(--surface-2)` devenu `var(--panel-2)` (variable renommée). Le test vérifie toujours qu'une valeur CSS hostile retombe sur le repli neutre.
- `tests/diagnostic-panel.test.mjs` « mise en page » : décalages `8px/64px/100vw - 16px` devenus `16px/88px/100vw - 32px`. Raison : le bouton Menu, son cadre noir et son anneau de maintien occupent maintenant 16 à 80 px en haut à gauche, le panneau ouvert doit rester dessous et le panneau replié à l'écart du bord (cadre et anneau de 12 px). Même intention : sous le Menu, en haut à droite replié, 360 px sans débordement.
- `tests/version.test.mjs` : inchangé, passe avec 0.24.0.

## Non vérifié (aucun navigateur lancé)
Tout le rendu : les 4 écrans à 1280 px et 360 px, l'anneau de focus et le curseur qui ne sortent pas de l'écran sur les colonnes de bord (marge 16 px, décalage 4 px), le biseau de la jaquette au-dessus de l'image (`::after`), le rendu de ▶ et ◀ (forme texte), le fond rayé, la barre de titre de la boîte, l'anneau de maintien autour du Menu, le zoom 200 %, Lighthouse. Le service worker met en cache les CSS par numéro de version (0.24.0).

## Vérification manuelle (Hicham)
Ouvrir l'accueil, une grille, l'écran Jouer et la confirmation de sortie à la souris, au clavier et à la manette, puis à 360 px (ou téléphone) : comparer à la maquette. Activer « réduire les animations » dans le système : le curseur ▶ et « PRÊT ? » doivent rester fixes.

## Notes de revue
(à compléter : ux pour la fidélité à la maquette, tech-lead)
