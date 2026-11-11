# Clone90

Site web pour jouer aux jeux rétro des années 90 avec [EmulatorJS](https://emulatorjs.org), sur PC, Mac et Android.

> En cours de développement. Aucun jeu n'est fourni : déposez vos propres ROMs dans `roms/<machine>/` et vos BIOS dans `bios/`.

- Architecture : [docs/architecture.md](docs/architecture.md)
- Interface : [docs/ux.md](docs/ux.md)
- Guide pas à pas (lancer en local, jouer sur Android, publier sur GitHub Pages) : [docs/guide.md](docs/guide.md)
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

## Lancer sans Terminal (Mac)

Double-cliquez sur **`Lancer Clone90.command`** (à la racine du dossier). Il met à jour la liste des jeux, démarre Clone90 et ouvre la page dans votre navigateur. Pour arrêter, fermez la fenêtre (ou `Ctrl + C`).

- **La première fois**, macOS peut bloquer un script téléchargé : clic droit (ou `Ctrl` + clic) sur le fichier, **Ouvrir**, puis **Ouvrir** dans la fenêtre qui s'affiche. Ensuite le double-clic suffit.
- Vous pouvez glisser le fichier dans le Dock, ou en faire un alias sur le Bureau.
- Il faut Node.js (<https://nodejs.org>) ; sinon le lanceur vous le dit.
- Cela ne concerne que le Mac. Sous Windows et Linux, utilisez les commandes de la section « Lancer en local ».

## Où mettre les ROMs et les BIOS

Ces dossiers sont ignorés par git : rien de ce que vous y mettez n'est publié. Créez-les s'ils n'existent pas.

```
roms/<machine>/<fichier du jeu>
bios/<fichier BIOS>
```

`<machine>` est l'identifiant de `systems.json` : `amiga`, `neogeo`, `arcade`, `mastersystem`, `megadrive`, `gamegear`, `megacd`, `32x`, `nes`, `snes`, `gameboy`, `gameboycolor`. Les extensions acceptées par machine sont dans `systems.json`.

Toutes les machines ci-dessous sont affichées sur l'accueil ; celles sans jeu sont grisées. L'Amiga et la Neo Geo sont testées avec de vrais fichiers ; les 10 autres (T15) sont vérifiées dans le code d'EmulatorJS 4.2.3 mais **pas encore essayées avec de vrais jeux** (section « Autres machines »).

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

Les jeux Amiga (`.adf`, `.adz`, `.dms`, `.ipf`, `.hdf`, `.hdz`, `.lha`, `.zip`, `.m3u`) vont dans `roms/amiga/` (la casse du dossier n'a pas d'importance : `roms/Amiga/` est trouvé aussi). Testé avec un vrai Kickstart 3.1 A1200 renommé `kick40068.A1200` et un `.adf` : le jeu démarre, l'émulation est réglée sur le modèle A1200. **Le format IPF n'est probablement pas pris en charge** (d'après l'analyse du cœur, non confirmé en navigateur) : le cœur Amiga d'EmulatorJS 4.2.3 ne contient pas la bibliothèque qui le lit (voir « Format IPF » plus bas). Utilisez des ADF. Jeux à plusieurs disquettes : voir « Amiga multi-disquettes » plus bas.

### BIOS Neo Geo

Placez `neogeo.zip` dans `bios/`, **sans le décompresser** (testé avec un vrai `neogeo.zip` et le romset `viewpoin.zip`). Les jeux sont des romsets FBNeo au format `.zip` dans `roms/neogeo/`, et **le nom du fichier doit être celui du romset** (`mslug.zip`, pas `Metal Slug.zip`). Les romsets doivent correspondre à la version de FBNeo utilisée par EmulatorJS.

### Autres machines (T15 : pas encore essayées avec de vrais jeux)

Dans chaque dossier, un jeu peut aussi être un `.zip` contenant le fichier du jeu. Les BIOS vont dans `bios/`, **avec le nom exact** indiqué. Les BIOS marqués « posé » sont fournis au cœur s'ils existent, sinon ignorés sans erreur.

| Dossier `roms/` | Extensions | Cœur | BIOS dans `bios/` |
|---|---|---|---|
| `arcade` | `.zip` (romset FBNeo, nom du romset conservé) | FBNeo | `neogeo.zip` (facultatif, zippé, posé : jeux de la famille Neo Geo) |
| `mastersystem` | `.sms` | SMS Plus | aucun |
| `megadrive` | `.md`, `.bin`, `.gen`, `.smd` | Genesis Plus GX | `bios_MD.bin` : inutilisé par défaut |
| `gamegear` | `.gg` | Genesis Plus GX | aucun |
| `megacd` | `.cue` + ses `.bin`, `.iso`, `.chd` | Genesis Plus GX | `bios_CD_E.bin` (Europe), `bios_CD_U.bin` (USA), `bios_CD_J.bin` (Japon), posés : **il en faut au moins un, celui de la région du disque** |
| `32x` | `.32x`, `.bin` | PicoDrive | aucun |
| `nes` | `.nes`, `.unf`, `.unif`, `.fds` | FCEUmm | `disksys.rom` (posé) : seulement pour les `.fds` |
| `snes` | `.sfc`, `.smc`, `.swc`, `.fig` | Snes9x | aucun |
| `gameboy` | `.gb` | Gambatte | `gb_bios.bin` (facultatif, posé) |
| `gameboycolor` | `.gbc` | Gambatte | `gbc_bios.bin` (facultatif, posé) |

Mega-CD : mettez le `.cue` et ses `.bin` (et pistes audio) dans le même dossier, **sans les renommer** (le `.cue` contient leurs noms). Le générateur n'en fait qu'UNE tuile (le `.cue`). Un `.bin` sans `.cue` est ignoré avec un avertissement. Les images CD sont lourdes (300 à 700 Mo) et sont chargées entièrement en mémoire par le navigateur : préférez le format `.chd` ou `.iso` (un seul fichier). **`cue+bin` n'est pas testé avec de vrais fichiers** et peut échouer sans message utile si le disque dépasse la mémoire du navigateur. Les `.m3u` (multi-disques) ne sont pas pris en charge.

## Générer la liste des jeux

Après chaque ajout ou retrait de ROM, relancez :

```
node scripts/generate-games.mjs
```

Le script lit `systems.json`, scanne `roms/<machine>/` (un niveau de sous-dossier toléré) et écrit `games.json` (ignoré par git). Il affiche le nombre de jeux par machine et des avertissements (BIOS requis absent, extension non prise en charge, doublon).

- `--check` : affiche le diagnostic sans écrire `games.json`.
- Titre : nom du fichier nettoyé (`Lemmings (Europe).adf` donne `Lemmings`), ou, pour les romsets arcade et Neo Geo, la correspondance de `data/titles.json` (`"mslug": "Metal Slug"`). Ajoutez-y vos romsets.
- Jaquette (facultative) : une image `.png`, `.jpg`, `.jpeg` ou `.webp` de même nom que le jeu, dans le même dossier.
- Amiga multi-disquettes (T10) : déposez toutes les disquettes dans le même dossier (`roms/amiga/`) avec des noms qui ne diffèrent que par le numéro, au format TOSEC/No-Intro : `Leander (1991)(Psygnosis)(Disk 1 of 3)[cr Flashtro].adf`, `(Disk 2 of 3)`, `(Disk 3 of 3)` (aussi `(Disk 1)` ou `Disk 1 of 3`). Les noms simples sont regroupés aussi (T18) : `Jeu_Disk1`, `Jeu Disk 1`, `Jeu-Disk-1`, `Jeu_Disque1`, `Jeu Disc1`, `Jeu_D1` (même dossier, même extension, même nom une fois le numéro retiré, numéros 1, 2, 3... sans trou ; un seul fichier reste un jeu simple, et `Disk Wars` n'est pas une disquette). Le titre est le nom sans le numéro, ou à défaut le nom du dossier (`Leander (1991)(Psygnosis)[0496]/Disk1.adf` donne « Leander »). Après `node scripts/generate-games.mjs`, elles forment UNE tuile (« Leander ») qui se lance avec toutes les disquettes ; le générateur avertit si une disquette manque. Sinon, un `.m3u` écrit à la main reste possible (seul le `.m3u` apparaît alors comme jeu ; non testé avec de vrais fichiers).
- Changer de disquette en jeu (Amiga) : voir la section « Changer de disquette en jeu » plus bas.
- Mega-CD (T15) : un `.cue` et les fichiers de ses lignes `FILE` forment UNE tuile ; ces fichiers ne sont pas listés à part (même principe que le `.m3u`).
- BIOS spécifique à un jeu : un fichier `<nom du jeu>.bios` contenant le nom du BIOS (une ligne).
- Les fichiers cachés (commençant par `.`) sont ignorés.

## Format IPF (T18)

Le cœur Amiga (puae) d'EmulatorJS 4.2.3 liste `.ipf` comme extension, mais **ne peut vraisemblablement pas lire les IPF** (analyse du binaire et du source, non confirmée en navigateur) : il cherche la bibliothèque `capsimg.so` par chargement dynamique, or son build WebAssembly le désactive (message « dynamic linking not enabled ») et la CDN ne fournit pas ce fichier. Les IPF restent listés par `generate-games.mjs`, qui avertit « au format IPF ... utilisez des ADF ». **Préférez des ADF** (outil de conservation de votre choix, ou téléchargez la version ADF de vos propres jeux). Si le moteur refuse un jeu IPF, l'écran « Ce jeu n'a pas pu démarrer » l'explique ; le cœur peut aussi démarrer sans erreur et laisser un lecteur vide (écran « insérez une disquette »).

## Changer de disquette en jeu

Pour un jeu Amiga à plusieurs disquettes (ex. Leander), passez à la disquette suivante pendant la partie :

- Manette : maintenez **Select** puis appuyez sur **RB** (bouton 5 en mapping standard). Un appui = une disquette, en cycle (3 puis 1).
- Clavier : **F9**.
- Un petit message « Disquette 2 / 3 » s'affiche 2 secondes en bas de l'écran. Sur un jeu à une seule disquette, rien ne se passe.
- Start seul et Select + Start (sortie du jeu) ne changent jamais de disquette.
- Le jeu étant sur la disquette 1 au départ, changez quand il demande d'insérer la suivante.
- Alternative : la barre d'EmulatorJS (bas de l'écran, icône « Disks »), à la souris ou au tactile. Après un changement par raccourci, ce menu peut afficher l'ancien disque ; le message « Disquette N / M » est le bon.
- **Non vérifié à la main** : voir le ticket T12.

## Numéro de version et diagnostic (T16)

- Le numéro (« Clone90 v0.16.0 - 11/11/2026 ») est affiché en bas de l'accueil. Il vient de `js/version.js`, seule source ; le service worker en tire le nom de son cache.
- **À chaque livraison**, relever `APP_VERSION` (format `0.<numéro du dernier ticket>.<n>`, par exemple `0.17.0` au ticket 17, `0.16.1` pour une correction du 16) et `APP_DATE` dans `js/version.js`. Rien d'autre à changer : `tests/version.test.mjs` échoue si le numéro de ticket est en retard.
- **Mode diagnostic** : ajouter `&debug=1` à l'adresse de `player.html`, par exemple `http://localhost:8080/player.html?system=amiga&game=amiga%2Fleander_(1991)(psygnosis)&debug=1`. Une pastille « Diag » apparaît en haut à droite : l'ouvrir montre la version, la machine, le jeu, les disquettes et le journal des changements de disquette. « Copier le journal » le met dans le presse-papiers. Rien n'est envoyé sur le réseau, et sans `debug=1` rien ne change.

## Tests

```
node --test "tests/*.test.mjs"
```

Le guide de publication sur GitHub Pages est dans [docs/guide.md](docs/guide.md).

## Jouer : limites connues (T7)

- Quitter un jeu ramène à la grille de la machine avec le jeu quitté sélectionné. Le bouton Retour du navigateur, depuis cette grille, peut ramener à l'écran Jouer du même jeu.
- Sortie du jeu : Select + Start maintenus 1 s (manette), F10 ou Échap maintenu 1 s (clavier), bouton Menu (souris, tactile), geste Retour d'Android. Tous ouvrent une confirmation.
- Validé avec de vrais fichiers (ticket T0, Chromium) : Neo Geo (Viewpoint) et Amiga (Leander), BIOS trouvés, pause et reprise, F10, Échap maintenu. Multi-disquettes (T10) : chargement des 3 disquettes de Leander et menu de changement vus en navigateur automatisé, mais pas encore vérifiés à la main en jouant. Pas encore validé : Échap maintenu en plein écran sur un vrai Chrome (sinon utiliser F10 ou le bouton Menu).

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
