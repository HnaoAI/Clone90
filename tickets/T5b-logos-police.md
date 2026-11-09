# T5b : Logos maison et police pixel

**Dépend de** : T5, T8
**Branche** : `ticket/T5b-logos-police`
**Statut** : validé par le PO (délégation de Hicham) ; accord de Hicham pour la police Press Start 2P (licence OFL)

## Besoin

Les tuiles de l'accueil affichent le visuel de repli (nom en monospace) faute de logos, et `systems.json` pointe vers des
`assets/logos/<id>.svg` qui n'existent pas (404 console). La police pixel prévue par docs/ux.md n'est pas embarquée.

## Périmètre

1. Un SVG par machine déclarée dans `systems.json` (champ `logo`), fait maison : nom en lettres pixel simples sur la couleur
   d'accent de la machine, plus une petite forme géométrique. Aucun logo officiel ni marque stylisée reproduite.
   Généré par `scripts/generate-logos.mjs` (Node sans dépendance ; machines et noms lus dans `systems.json`, couleurs dans
   `css/base.css` via le champ `accent`).
2. Police Press Start 2P (TTF et licence OFL) dans `assets/fonts/`, `@font-face` dans `css/base.css` (`font-display: swap`, repli monospace).
3. Liste blanche de `scripts/serve.mjs` et coquille du service worker (`sw.js`) couvrent `assets/fonts/` et `assets/logos/`.
4. Contrôle en Chromium à 360 px : « Game Boy Color » et « Master System » tiennent dans leur tuile ; plus de 404 console.

## Critères d'acceptation

- Un SVG valide par machine, sans doublon, couleur de fond lue depuis la source unique, contraste texte/fond >= 4.5:1.
- Les SVG commités sont à jour par rapport au script (test).
- Tests verts (`node --test "tests/*.test.mjs"`), service worker : `CACHE_VERSION` relevée.
