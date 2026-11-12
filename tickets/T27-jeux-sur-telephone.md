# T27 : Jouer sur téléphone sans le Mac

**Branche** : `ticket/T27-jeux-sur-telephone`
**Demandé par** : Hicham (2026-11-12) : « je veux pouvoir jouer aux jeux sur mon téléphone sans passer par mon Mac ».

## Réalisation
- Écran **Mes fichiers** (`#/fichiers`, bouton de l'accueil, bouton « Ajouter » de chaque grille) : choisir ses jeux par machine et ses BIOS sur l'appareil, voir ce qui est gardé (taille, BIOS présents ou manquants), supprimer.
- Fichiers copiés dans le navigateur (IndexedDB `clone90-local`, `js/local-library.js`), rangés sous les chemins du Mac : `roms/<machine>/<nom>`, `bios/<nom>` (nom de BIOS ramené au nom exact déclaré dans `systems.json`, sans tenir compte de la casse).
- `sw.js` : GET/HEAD vers `roms/` ou `bios/` = fichier local s'il existe, sinon réseau tel quel (Mac inchangé). Jamais de Cache Storage pour ces réponses (`Cache-Control: no-store`). Le lanceur et EmulatorJS voient les mêmes URL que sur le Mac.
- Liste des jeux construite dans le navigateur avec les règles du générateur : fonctions pures déplacées dans `js/games-builder.js` (+ `js/posix-path.js`), réexportées par `scripts/generate-games.mjs`. `loadData` ajoute les jeux locaux (`local: true`), games.json garde la priorité à id égal.
- Jeu local sans service worker actif : message « Rechargez la page pour jouer ». Messages BIOS manquant / jeu local manquant : renvoient à « Mes fichiers ».
- Rien dans le dépôt ni sur GitHub Pages (règle 1), rien envoyé (règle 5), aucun cache de ROM ni BIOS (règle 6). `js/version.js` : 0.27.0.

## Critères d'acceptation
1. Sur GitHub Pages, on ajoute un jeu et un BIOS depuis le téléphone, le jeu apparaît dans sa machine et se lance.
2. Les fichiers ne quittent jamais l'appareil et ne sont jamais mis en cache par le service worker.
3. Jeux Amiga à plusieurs disquettes regroupés comme sur le Mac.
4. Sur le Mac (serveur local, games.json), rien ne change.
5. Suppression d'un fichier depuis « Mes fichiers ».

## Tests
`tests/local-library.test.mjs`, `tests/posix-path.test.mjs`. Vérifié en Chromium automatisé (profil Pixel 7, serveur local, EmulatorJS 4.2.3 servi depuis le paquet npm car le CDN est bloqué dans l'environnement de test) : import d'une ROM NES homebrew et d'un faux Kickstart, tuile NES « 1 jeu », jeu démarré (`EJS_emulator.started`), fichier lu par le cœur, HEAD du BIOS 200, aucun fichier roms/ ni bios/ dans Cache Storage.

## Limites
- Samples fbneo (`bios/samples/`) non importables depuis l'écran (rare).
- Les fichiers vivent dans Chrome : effacer les données du site les efface. Gros disques Mega-CD : limités par la place du téléphone.
- Non essayé sur un vrai téléphone ni avec de vrais jeux Amiga/Neo Geo.

## Vérification manuelle (Hicham)
Sur le téléphone, Chrome, https://hnaoai.github.io/Clone90/ : Mes fichiers, Amiga, choisir les ADF ; Choisir des BIOS, `kick40068.A1200` ; revenir, Amiga, le jeu, Jouer.
