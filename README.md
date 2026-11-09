# Clone90

Site web pour jouer aux jeux rétro des années 90 avec [EmulatorJS](https://emulatorjs.org), sur PC, Mac et Android.

> En cours de développement. Aucun jeu n'est fourni : déposez vos propres ROMs dans `roms/<machine>/` et vos BIOS dans `bios/`.

- Architecture : [docs/architecture.md](docs/architecture.md)
- Interface : [docs/ux.md](docs/ux.md)
- Tickets : [tickets/](tickets/)

## Lancer en local

Prérequis : [Node.js](https://nodejs.org) 18 ou plus récent. Aucune installation de paquet n'est nécessaire.

```
node scripts/serve.mjs
```

Le site est alors sur <http://localhost:8080>. Le serveur affiche aussi l'adresse réseau (`http://192.168.x.x:8080`) pour jouer depuis un téléphone du même réseau.

- Autre port : `node scripts/serve.mjs --port 9000` ou `PORT=9000 node scripts/serve.mjs`.
- Sans Node : `python3 -m http.server 8080` fonctionne aussi (sans requêtes Range).
- Le serveur sert la racine du projet quel que soit le dossier d'où vous le lancez, et uniquement les fichiers publics du site (pas `.git`, `docs/`, `tickets/`, etc.).
- Sur Android en réseau local (HTTP), le jeu fonctionne mais le site ne peut pas être installé comme application (limite du navigateur hors HTTPS).

## Où mettre les ROMs et les BIOS

Ces dossiers sont ignorés par git : rien de ce que vous y mettez n'est publié. Créez-les s'ils n'existent pas.

```
roms/<machine>/<fichier du jeu>
bios/<fichier BIOS>
```

`<machine>` est l'identifiant de `systems.json` : `amiga`, `neogeo`, `arcade`, `mastersystem`, `megadrive`, `gamegear`, `megacd`, `32x`, `nes`, `snes`, `gameboy`, `gameboycolor`. Les extensions acceptées par machine sont dans `systems.json`.

Pour l'instant, seules l'Amiga et la Neo Geo sont prévues (première étape).

### BIOS Amiga

EmulatorJS n'accepte que des **noms de fichier précis**. Renommez votre Kickstart avec le nom exact, sans extension en plus :

| Nom attendu dans `bios/` | Contenu |
|---|---|
| `kick40068.A1200` | Kickstart 3.1 (A1200) : **celui utilisé par défaut** |
| `kick33180.A500` | Kickstart 1.2 |
| `kick34005.A500` | Kickstart 1.3 |
| `kick37175.A500` | Kickstart 2.04 |
| `kick37350.A600` | Kickstart 2.05 |
| `kick40063.A600` | Kickstart 3.1 (A600) |
| `kick39106.A1200` | Kickstart 3.0 (A1200) |
| `kick39106.A4000`, `kick40068.A4000` | A4000 |
| `kick40060.CD32` | CD32 |

Les jeux Amiga (`.adf`, `.adz`, `.dms`, `.ipf`, `.hdf`, `.hdz`, `.lha`, `.zip`, `.m3u`) vont dans `roms/amiga/`. Ces noms et formats seront confirmés par le spike T0 (ROMs réelles).

### BIOS Neo Geo

Placez `neogeo.zip` dans `bios/`, **sans le décompresser**. Les jeux sont des romsets FBNeo au format `.zip` dans `roms/neogeo/`, et **le nom du fichier doit être celui du romset** (`mslug.zip`, pas `Metal Slug.zip`). Les romsets doivent correspondre à la version de FBNeo utilisée par EmulatorJS.

### Autres machines

Aucun BIOS requis. Optionnels : `bios_MD.bin` (Mega Drive), `bios_CD_E.bin`, `bios_CD_U.bin`, `bios_CD_J.bin` (Mega-CD), `gb_bios.bin` (Game Boy), `gbc_bios.bin` (Game Boy Color), `neogeo.zip` (Arcade).

## Générer la liste des jeux

Après chaque ajout ou retrait de ROM, relancez :

```
node scripts/generate-games.mjs
```

Le script lit `systems.json`, scanne `roms/<machine>/` (un niveau de sous-dossier toléré) et écrit `games.json` (ignoré par git). Il affiche le nombre de jeux par machine et des avertissements (BIOS requis absent, extension non prise en charge, doublon).

- `--check` : affiche le diagnostic sans écrire `games.json`.
- Titre : nom du fichier nettoyé (`Lemmings (Europe).adf` donne `Lemmings`), ou, pour les romsets arcade et Neo Geo, la correspondance de `data/titles.json` (`"mslug": "Metal Slug"`). Ajoutez-y vos romsets.
- Jaquette (facultative) : une image `.png`, `.jpg`, `.jpeg` ou `.webp` de même nom que le jeu, dans le même dossier.
- Amiga multi-disquettes : listez les disquettes dans un `.m3u` ; seul le `.m3u` apparaît comme jeu.
- BIOS spécifique à un jeu : un fichier `<nom du jeu>.bios` contenant le nom du BIOS (une ligne).
- Les fichiers cachés (commençant par `.`) sont ignorés.

## Tests

```
node --test "tests/*.test.mjs"
```

Le guide de publication sur GitHub Pages arrivera avec le ticket T8.

## Jouer : limites connues (T7)

- Quitter un jeu ramène à la grille de la machine avec le jeu quitté sélectionné. Le bouton Retour du navigateur, depuis cette grille, peut ramener à l'écran Jouer du même jeu.
- Sortie du jeu : Select + Start maintenus 1 s (manette), F10 ou Échap maintenu 1 s (clavier), bouton Menu (souris, tactile), geste Retour d'Android. Tous ouvrent une confirmation.
- Pas encore validé avec de vraies ROMs et de vrais BIOS (ticket T0) : chemin des BIOS Kickstart et `neogeo.zip`, formats IPF et multi-disquettes, pause et reprise, F10 libre dans EmulatorJS.

## Installation PWA et hors ligne (T8)

- Le service worker (`sw.js`) ne met en cache que la coquille de l'application (pages, CSS, JS, icônes). Jamais `roms/`, `bios/`, `games.json` ni le CDN EmulatorJS.
- Hors ligne, on ouvre l'application, mais la liste des jeux (`games.json`) et les jeux demandent le serveur local. La reprise hors ligne d'un cœur EmulatorJS déjà chargé dépend du cache propre d'EmulatorJS : non vérifié (à tester en T9).
- Installation : localhost ou HTTPS seulement (pas en HTTP sur le réseau local).

## Notes techniques

- `package.json` minimal (`"type": "module"`, aucune dépendance) : il permet à Node 18 et plus d'importer les modules `js/*.js` (par exemple `js/sort.js`, partagé avec `scripts/generate-games.mjs`).

## Crédits

- Police **Press Start 2P** (Copyright 2012 The Press Start 2P Project Authors, licence SIL Open Font License 1.1) : fichiers `PressStart2P-Regular.ttf` et `OFL.txt` pris dans le dépôt google/fonts (https://github.com/google/fonts/tree/main/ofl/pressstart2p), copiés dans `assets/fonts/`. Téléchargement accepté par Hicham le 2026-11-09.
- Logos des machines : dessins maison générés par `scripts/generate-logos.mjs`, sans reprise des logos officiels.
