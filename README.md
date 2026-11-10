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
- Liens symboliques : `roms/` et `bios/` peuvent être des liens vers un autre disque (ex. `roms` vers `/Volumes/Disque/roms`). Un lien placé DANS ces dossiers (fichier ou sous-dossier) qui pointe hors de leur emplacement réel est refusé (403), comme tout lien du reste du projet qui sort de la racine du projet.
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

Les jeux Amiga (`.adf`, `.adz`, `.dms`, `.ipf`, `.hdf`, `.hdz`, `.lha`, `.zip`, `.m3u`) vont dans `roms/amiga/` (la casse du dossier n'a pas d'importance : `roms/Amiga/` est trouvé aussi). Testé avec un vrai Kickstart 3.1 A1200 renommé `kick40068.A1200` et un `.adf` : le jeu démarre, l'émulation est réglée sur le modèle A1200. Le format IPF n'est pas encore validé. Jeux à plusieurs disquettes : voir « Amiga multi-disquettes » plus bas.

### BIOS Neo Geo

Placez `neogeo.zip` dans `bios/`, **sans le décompresser** (testé avec un vrai `neogeo.zip` et le romset `viewpoin.zip`). Les jeux sont des romsets FBNeo au format `.zip` dans `roms/neogeo/`, et **le nom du fichier doit être celui du romset** (`mslug.zip`, pas `Metal Slug.zip`). Les romsets doivent correspondre à la version de FBNeo utilisée par EmulatorJS.

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
- Amiga multi-disquettes (T10) : déposez toutes les disquettes dans le même dossier (`roms/amiga/`) avec des noms qui ne diffèrent que par le numéro, au format TOSEC/No-Intro : `Leander (1991)(Psygnosis)(Disk 1 of 3)[cr Flashtro].adf`, `(Disk 2 of 3)`, `(Disk 3 of 3)` (aussi `(Disk 1)` ou `Disk 1 of 3`). Après `node scripts/generate-games.mjs`, elles forment UNE tuile (« Leander ») qui se lance avec toutes les disquettes ; le générateur avertit si une disquette manque. Sinon, un `.m3u` écrit à la main reste possible (seul le `.m3u` apparaît alors comme jeu ; non testé avec de vrais fichiers).
- Changer de disquette en jeu (Amiga) : à la souris ou au tactile, faire apparaître la barre d'EmulatorJS (bas de l'écran), cliquer l'icône disquette (« Disks »), choisir Disk 1, 2 ou 3. Le jeu étant sur la disquette 1 au départ, changez quand il demande d'insérer la disquette suivante. La barre d'EmulatorJS n'est pas pilotable à la manette en v1 (limite connue), et il n'y a pas de raccourci clavier pour cela. **Non vérifié à la main : voir le ticket T10.**
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
- Validé avec de vrais fichiers (ticket T0, Chromium) : Neo Geo (Viewpoint) et Amiga (Leander), BIOS trouvés, pause et reprise, F10, Échap maintenu. Multi-disquettes (T10) : chargement des 3 disquettes de Leander et menu de changement vus en navigateur automatisé, mais pas encore vérifiés à la main en jouant. Pas encore validé : format IPF, Échap maintenu en plein écran sur un vrai Chrome (sinon utiliser F10 ou le bouton Menu).

## Installation PWA et hors ligne (T8)

- Le service worker (`sw.js`) ne met en cache que la coquille de l'application (pages, CSS, JS, icônes). Jamais `roms/`, `bios/`, `games.json` ni le CDN EmulatorJS.
- Hors ligne, on ouvre l'application, mais la liste des jeux (`games.json`) et les jeux demandent le serveur local. La reprise hors ligne d'un cœur EmulatorJS déjà chargé dépend du cache propre d'EmulatorJS : non vérifié (à tester en T9).
- Installation : localhost ou HTTPS seulement (pas en HTTP sur le réseau local).

## Notes techniques

- `package.json` minimal (`"type": "module"`, aucune dépendance) : il permet à Node 18 et plus d'importer les modules `js/*.js` (par exemple `js/sort.js`, partagé avec `scripts/generate-games.mjs`).

## Crédits

- Police **Press Start 2P** (Copyright 2012 The Press Start 2P Project Authors, licence SIL Open Font License 1.1) : fichiers `PressStart2P-Regular.ttf` et `OFL.txt` pris dans le dépôt google/fonts (https://github.com/google/fonts/tree/main/ofl/pressstart2p), copiés dans `assets/fonts/`. Téléchargement accepté par Hicham le 2026-11-09.
- Logos des machines : dessins maison générés par `scripts/generate-logos.mjs`, sans reprise des logos officiels.

## Relever la version d'EmulatorJS

La version est épinglée dans une seule constante, `EJS_CDN_VERSION` de `js/config.js` (4.2.3 depuis T10). Pour la relever :
1. Changer la constante, puis lancer un jeu Amiga multi-disquettes (ex. Leander) et un jeu Neo Geo en vrai.
2. Retester les trois contournements de `guardDiskMenuStartup` dans `js/player/launcher.js` : (a) le jeu démarre sans « Failed to start game », (b) pas de plantage au démarrage, (c) un changement de disquette par le menu « Disks » fonctionne du premier coup.
3. Retirer un contournement devenu inutile (et son test dans `tests/launcher.test.mjs`) ; ne garder que ceux dont le défaut existe encore.
4. Mettre à jour `docs/architecture.md` (3.1 et section 4).
