# T42 : logos des machines sur le téléphone

**Branche** : `ticket/T42-logos-telephone` - **Version** : 0.42.0
**Demandé par** : Hicham (2026-11-15) : « Ajoute les logos des machines dans l'app mobile, comme sur Mac. » Choix sur carte : « Oui, comme les pochettes » (le téléphone télécharge lui-même les logos).

## Constat de départ
Sur le Mac, l'accueil montre les vrais logos des machines (thème libre es-theme-carbon de RetroPie, T29), téléchargés dans le dossier des ROMs et jamais publiés. Le téléphone qui joue avec « Mes fichiers » (GitHub Pages, sans le Mac) n'y a pas accès : il affiche les logos maison.

## Réalisation
- `js/logo-source.js` (nouveau, pur) : adresse du thème (`logoUrl`, commit figé), chemin (`logoTargetPath`, `LOGOS_DIR`), contrôle du SVG (`checkSvg`), `MAX_LOGO_BYTES`, déplacés de `scripts/machine-logos.mjs` pour être partagés par le Mac et le navigateur. `machine-logos.mjs` les réexporte (aucun comportement changé).
- `js/local-logos.js` (nouveau) : `findLocalLogos` télécharge le logo de chaque machine qui a un `logoTheme` et ne l'a pas encore, le vérifie (`checkSvg`, 256 Ko au plus) et le range dans la bibliothèque du navigateur au même chemin que sur le Mac (`roms/clone90-logos/<id>.svg`) ; `sw.js` le sert comme un jeu importé. Lecture sans cookie ni adresse du site (`browserFetchBytes` de T40). Jamais d'écrasement, jamais d'exception. `loadLocalLogos` lit les logos présents.
- `js/data.js` : `loadData` reçoit les logos du navigateur et les donne aux machines (`downloadedLogo`) qui n'en ont pas déjà par `games.json` (le Mac garde la priorité) ; même contrôle du chemin que pour `games.json`.
- Quand : avec la recherche des pochettes de T40 (après un ajout de jeux dans « Mes fichiers », et sur « Chercher les pochettes manquantes »). Une fois par machine : ensuite, aucune connexion. Pas de message : les logos apparaissent sur l'accueil.
- « Mes fichiers » : la phrase sur la connexion mentionne les logos ; les logos ne sont pas listés parmi les fichiers de la personne.
- Accueil : inchangé (style Y2K de T41) : le vrai logo est posé dans la bulle blanche, avec le logo maison puis le nom en repli.

## Critères d'acceptation
1. Sur le téléphone, après un ajout de jeux ou « Chercher les pochettes manquantes », chaque machine de l'accueil montre son vrai logo, comme sur le Mac.
2. Seules des lectures d'images sur raw.githubusercontent.com (thème es-theme-carbon, commit figé), aucun nom de jeu envoyé ; même source et même contrôle que le Mac.
3. Un logo présent n'est jamais retéléchargé ni remplacé.
4. Sans réseau ou avec un fichier refusé : l'import réussit, l'accueil garde le logo maison.
5. Sur le Mac, le logo du Mac garde la priorité.

## Tests
`tests/local-logos.test.mjs` (13). Recette `tests/recette/logos-telephone.mjs` (Chromium, Pixel 7 et ordinateur, faux GitHub intercepté). Recette T40 `tests/recette/pochettes.mjs` adaptée : son faux GitHub sert aussi les logos, et ses contrôles admettent ces lectures.

## Limites
- Non essayé sur un vrai téléphone. En-tête CORS de raw.githubusercontent.com pour le thème vérifié le 2026-11-15 (`access-control-allow-origin: *`, `image/svg+xml`).
- Un téléphone qui a déjà ses jeux doit appuyer une fois sur « Chercher les pochettes manquantes » (ou ajouter un jeu) pour recevoir les logos.

## Vérification manuelle (Hicham)
Sur le téléphone, Clone90 en HTTPS (GitHub Pages) : « Mes fichiers », « Chercher les pochettes manquantes », puis « Machines » : chaque machine a le même logo que sur le Mac. Rouvre l'application sans réseau : les logos restent.
