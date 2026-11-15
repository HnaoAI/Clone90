# T40 : pochettes automatiques (téléphone et Mac)

**Branche** : `ticket/T40-pochettes` - **Version** : 0.40.0
**Demandé par** : Hicham (2026-11-14), plan validé par lui : « télécharger automatiquement la pochette de chaque jeu, la garder localement, pour le Mac et pour le téléphone (« Mes fichiers ») ».

## Constat de départ
Le Mac a déjà ses pochettes depuis T28 (bouton « Télécharger les pochettes » du panneau « Dossiers des jeux », ou `node scripts/covers.mjs`) : images rangées à côté des jeux, dans le dossier des ROMs. Le manque principal était le téléphone : un jeu importé dans « Mes fichiers » n'avait jamais de pochette. Pour le Mac, Hicham a choisi le 2026-11-15 : « Passe en automatique sur mac ».

## Réalisation
- `js/cover-match.js` (nouveau, pur) : la recherche de pochette de T28 (`githubUrl`, `normalizeTitle`, `chooseCover`, `coverTargetPath`, `isPng`, `fetchRepoListing`, `freshListing`, `MAX_COVER_BYTES`), déplacée de `scripts/covers.mjs` pour être partagée par le Mac et le navigateur. `covers.mjs` la réexporte (aucun comportement changé).
- `js/local-covers.js` (nouveau) : `findLocalCovers` cherche la pochette de chaque jeu de « Mes fichiers » qui n'en a pas, la télécharge depuis le navigateur (GitHub autorise ces lectures, CORS : le Mac n'est pas nécessaire en relais), vérifie le PNG (2 Mo au plus) et la range dans la bibliothèque à `roms/<machine>/<nom du jeu>.png`. La liste des jeux la reconnaît comme une jaquette (même règle que le générateur) et `sw.js` la sert comme les jeux. Liste des images par machine gardée une semaine dans une base IndexedDB à part (`clone90-covers`). Lectures sans cookie ni adresse du site (`credentials: omit`, `referrerPolicy: no-referrer`), redirections refusées. Jamais d'écrasement, jamais d'exception : une pochette introuvable, ambiguë ou refusée, ou GitHub injoignable, ne fait pas échouer l'import.
- Quand : après chaque ajout de jeux dans « Mes fichiers » (« Ajouter des jeux » d'une machine, « Choisir le dossier des jeux », « Depuis une page web » vers ce navigateur), et sur le nouveau bouton **Chercher les pochettes manquantes** (jeux importés avant T40). Avancement dans le bandeau (« Recherche des pochettes : 2 sur 5… »), puis résumé d'une ligne sous l'import (« Pochettes : 3 ajoutées, 1 introuvable »).
- Écran « Mes fichiers » : rubrique « Pochettes » avec la phrase sur la connexion (github.com, images seulement, GitHub voit l'adresse IP et les noms des jeux cherchés).
- **Mac, sans clic** (`js/auto-covers.js`) : à l'ouverture de Clone90 (une fois par onglet, après la vérification des mises à jour, jamais pendant une mise à jour), après un choix de dossier et après un téléchargement « Depuis une page web », s'il reste des jeux du disque sans pochette, le téléchargement de T28 est lancé et suivi. Message seulement si des pochettes ont été ajoutées. Le bouton reste. Texte du panneau mis à jour, et donc le test T28 qui exigeait « uniquement quand vous cliquez sur ce bouton » (`tests/folders-panel.test.mjs`) : il vérifie maintenant le nouveau texte (décision de Hicham, pas un affaiblissement).
- Écran des jeux : inchangé (T6) ; la pochette s'affiche si elle existe, sinon les initiales et le nom.

## Critères d'acceptation
1. Un jeu importé dans « Mes fichiers » reçoit sa pochette, gardée dans le navigateur à côté du jeu.
2. Un jeu sans pochette dans la base (ou ambigu, ou image refusée, ou sans réseau) ne fait pas échouer l'import ; sa tuile garde son nom.
3. Seules des images sont téléchargées, seulement depuis github.com (libretro-thumbnails) ; aucune clé d'API.
4. Une image déjà présente n'est jamais remplacée ; une relance ne retélécharge rien.
5. Le Mac et le téléphone utilisent la même recherche.
6. Sur le Mac, les pochettes manquantes sont cherchées sans clic à l'ouverture et après un ajout de jeux par Clone90 ; aucune connexion s'il ne manque rien.

## Tests
`tests/local-covers.test.mjs` (24), `tests/auto-covers.test.mjs` (7) ; `tests/covers.test.mjs` et `tests/covers-api.test.mjs` inchangés et verts. Recette `tests/recette/pochettes.mjs` (Chromium, ordinateur et Pixel 7, faux GitHub intercepté) : 28/28 (dont Mac automatique, API locale simulée).

## Limites
- Non essayé sur un vrai téléphone ni avec le vrai GitHub depuis un navigateur (le conteneur de développement ne joint pas api.github.com). En-têtes CORS de raw.githubusercontent.com vérifiés (`access-control-allow-origin: *`).
- « Mes fichiers » n'existe qu'en HTTPS ou sur localhost (T27) : sur un téléphone relié au Mac en Wi-Fi (http), ce sont les pochettes du Mac qui s'affichent.
- Sans compte, GitHub limite à 60 lectures de liste par heure et par adresse IP (2 par machine, puis cache d'une semaine).

## Vérification manuelle (Hicham)
Sur le Mac : ajoute un jeu sans image dans le dossier des ROMs, ferme et rouvre Clone90 : quelques secondes après, « Pochettes téléchargées : 1 » et la tuile a sa pochette. Rouvre encore : aucun message.
Sur le téléphone, Clone90 en HTTPS (GitHub Pages) : « Mes fichiers », ajoute un jeu connu (par exemple un `.adf` nommé `Gods.adf`) : le résumé dit « Pochettes : 1 ajoutée », la tuile du jeu montre la pochette, et une ligne `Gods.png` apparaît dans « Sur cet appareil ». Puis « Chercher les pochettes manquantes » : « toutes déjà présentes ».
