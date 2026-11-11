# T17 : Guide de lancement local et de publication GitHub Pages

**Dépend de** : T8, T9, T16
**Branche** : `ticket/T17-guide-publication`
**Demandé par** : le PO (délégation de Hicham). Étape 3 de l'ordre de livraison.

## Besoin
Un guide en français simple pour Hicham (Mac, Opera ou Chrome, Android) : lancer Clone90 en local, et publier sur GitHub Pages. La publication elle-même n'est PAS faite ici (aucun réglage GitHub modifié).

## Réalisation
- `docs/guide.md` : partie 1 (Node.js 18+, cloner, ROMs et BIOS, `generate-games.mjs`, `serve.mjs`, téléphone Android sur le même Wi-Fi, mise à jour, dépannage) et partie 2 (ce qui est publié ou jamais, étapes Settings, Pages, Deploy from a branch, main, / (root), adresse, message "aucun jeu", PWA Android et Mac, jouer quand même en local).
- `README.md` : un lien vers le guide (et remplacement de la phrase "arrivera avec le ticket T8").
- `.nojekyll` (fichier vide à la racine) et `tests/pages.test.mjs`.
- `js/version.js` : 0.17.0.

## Vérifications faites dans le code (lecture, tests T9 `tests/recette/pages.mjs`, pas de navigateur lancé ici)
- Node minimal : 18 (README et `package.json` sans champ `engines`). Les scripts n'utilisent que des modules `node:` et `Array.at` (Node 16.6+) ; `node:test` demande 18. Seul `node --test "tests/*.test.mjs"` avec guillemets exige un Node récent (glob géré par Node, 21+) : sans importance pour Hicham, qui ne lance pas les tests.
- Chemins relatifs : `manifest.webmanifest` (`start_url` et `scope` `./`, icônes relatives), `sw.js` (`SHELL_FILES` relatifs, résolus contre `registration.scope`, test "portée GitHub Pages /Clone90/" de `sw.test.mjs`), `pwa.js` (`sw.js?v=` relatif, portée = dossier), routage par hash. La recette T9 (`pages.mjs`, serveur `subpath-server.mjs` sous `/Clone90/`) a déjà vérifié : accueil chargé, aucune requête hors du sous-chemin, seul `games.json` en 404, service worker de portée `/Clone90/`, manifest et icônes en 200, message "Aucun jeu disponible ici" mentionnant GitHub Pages.
- Message "aucun jeu" : `describeGamesStatus('absent')` dans `js/ui/machine-grid.js` (test dans `machine-grid.test.mjs`).
- Rien ne dépend de Jekyll : aucun fichier ou dossier du site ne commence par `_` ; aucun fichier `.md` ne contient de balise Liquid (`{{`, `{%`).

## Décision : `.nojekyll`
Ajouté par sécurité, pour trois raisons : (1) sans lui, GitHub Pages lance Jekyll, qui ignore tout nom commençant par `_` (un futur dossier `_x` disparaîtrait du site sans erreur) ; (2) Jekyll convertirait en HTML la trentaine de `.md` de `docs/` et `tickets/`, et une balise Liquid dans l'un d'eux ferait échouer le déploiement ; (3) déploiement plus rapide. Effets de bord vérifiés : le serveur local refuse déjà tout segment caché (`isPublicPath`), donc `/.nojekyll` répond 403 comme avant ; il n'est ni dans `SHELL_FILES` ni dans le champ de `shouldHandle` du service worker, et `tests/sw.test.mjs` (qui ne parcourt que `js/`, `css/`, `assets/icons/`, `assets/fonts/`) ne le voit pas. Tests ajoutés : `tests/pages.test.mjs`.

## Critères d'acceptation
1. `docs/guide.md` couvre le lancement local et la publication, en français simple, sans tiret cadratin.
2. Le README renvoie au guide sans dupliquer son contenu.
3. `.nojekyll` existe, n'est pas servi en local ni mis en cache.
4. Version 0.17.0 ; tous les tests passent.

## Vérification manuelle (Hicham)
- Relire le guide ; suivre la partie 2 SEULEMENT quand le PO donne le feu vert (réglage du dépôt GitHub : non fait ici).
- Après publication : ouvrir <https://hnaoai.github.io/Clone90/>, voir le message "aucun jeu", et tester l'installation sur Android et Chrome Mac (non testé : l'installation Opera Mac est annoncée comme non garantie).

## Questions pour le PO
- Feu vert pour activer Pages ? Le dépôt étant public, `docs/` et `tickets/` seront lisibles en ligne : acceptable ?
