# T45 : numéro de version sous « Clone90 » sur le téléphone

**Branche** : `ticket/T45-version-en-haut` - **Version** : 0.45.0
**Demandé par** : Hicham (2026-11-15) : « Je ne vois plus le numéro de version », puis « Sur le téléphone, mets en haut juste en dessous du nom Clone90 ».

## Constat de départ
Le numéro (T16) est le dernier élément de l'accueil. Depuis le style Y2K (T41), les machines sont de grandes bulles et la barre du bas est fixe : sur le téléphone il faut faire défiler toute la liste des machines pour le voir, et seulement sur l'accueil. Il n'avait pas disparu du code, il était hors de vue.

## Réalisation
- `index.html` : `p.site-version` vide sous le titre, dans `.site-brand`.
- `js/version.js` : `formatShortVersionLabel` (« v0.45.0 - 15/11/2026 ») ; `formatVersionLabel` le réutilise.
- `js/app.js` : remplit la ligne au démarrage, avant le chargement des données (visible même si games.json manque ou est abîmé).
- `css/base.css` : ligne cachée au-dessus de 600 px, affichée sur le téléphone, texte `--ink` sur le chrome de l'en-tête.
- Le numéro en bas de l'accueil reste en place (ordinateur et téléphone).

## Critères d'acceptation
1. Sur le téléphone, le numéro et la date sont visibles en haut, juste sous « Clone90 », sur tous les écrans de index.html.
2. Il est lisible (contraste AA) et ne déborde pas de l'en-tête.
3. Sur ordinateur, l'en-tête ne change pas ; le numéro reste en bas de l'accueil.
4. `js/version.js` reste la seule source du numéro.

## Vérification
- `node --test tests/header-version.test.mjs tests/version.test.mjs tests/machine-grid.test.mjs tests/design.test.mjs`
- `node tests/recette/style-y2k.mjs [dossier de captures]` : vérifications T45-* (Pixel 7 et ordinateur).
- À la main : ouvrir Clone90 sur le téléphone, le numéro est sous « Clone90 » sans faire défiler.
