# Architecture - Émulateur rétro (étape 1a)

Auteur : tech-lead. Date : 2026-11-09. Périmètre étape 1 : Amiga + Neo Geo. Les autres machines sont préparées dans `systems.json` mais livrées ensuite.

Légende de fiabilité utilisée dans tout le document :
- **[VÉRIFIÉ]** : lu dans la doc officielle ou dans le code source EmulatorJS.
- **[À VALIDER]** : connaissance du cœur libretro sous-jacent, non confirmée par EmulatorJS. À trancher par le spike (tâche T0) avec de vrais fichiers.

## 1. Résumé pour le PO (termes simples)

- Le site est un ensemble de pages statiques. Pas de serveur applicatif, pas de build.
- L'accueil et la grille de jeux forment une seule page (changement d'écran sans rechargement). Le jeu tourne dans une **page séparée** (`player.html`). Quitter le jeu = revenir à la page d'accueil, ce qui libère proprement la mémoire et le son. C'est plus fiable qu'une iframe.
- Une liste unique (`systems.json`) décrit les machines. Rien n'est écrit en dur ailleurs.
- Un script Node (`generate-games.mjs`) lit le dossier `roms/` et produit la liste des jeux (`games.json`).
- **Bonne nouvelle** : les cœurs Amiga (puae) et Neo Geo/arcade (fbneo) n'ont **pas** besoin de SharedArrayBuffer ni des en-têtes COOP/COEP. GitHub Pages ne pose donc aucun problème technique pour l'application elle-même.
- **Point d'attention** : sur GitHub Pages il n'y aura aucune ROM (dépôt public sans ROMs). Pour jouer, il faut un serveur local (Mac/PC), et sur Android il y a une limite PWA (voir section 9 et arbitrages).

## 2. Tableau des machines (vérifié contre la doc officielle)

`EJS_core` = valeur donnée à EmulatorJS. Pour les cœurs, le tableau d'alias est dans `data/src/consts.js` (dépôt GitHub) et dans le bundle stable `emulator.min.js` du CDN.

| Dossier roms | Nom affiché | EJS_core à utiliser | Cœur réel | Extensions (voir note) | BIOS | Sources |
|---|---|---|---|---|---|---|
| amiga | Amiga | `amiga` | puae (seul cœur) | adf, adz, dms, ipf, hdf, hdz, lha, zip, m3u [À VALIDER, la doc EmulatorJS ne liste aucune extension ; multi-disquettes TOSEC regroupées par le générateur, voir 3.1] | Kickstart, noms imposés par EmulatorJS (table section 3.1) [VÉRIFIÉ] | [1] [2] [3] |
| neogeo | Neo Geo | `arcade` (alias de `fbneo`) | fbneo | zip uniquement (romset FBNeo) [VÉRIFIÉ T0 : viewpoin.zip] | `neogeo.zip` (fichier laissé zippé, posé à la racine par `EJS_externalFiles`, voir 3.2) [VÉRIFIÉ T0] | [4] [3] [5] |
| arcade | Arcade | `arcade` | fbneo (1er de `arcade` dans `getCores()` 4.2.3 ; fbalpha2012_cps1/cps2 en option) | zip (romset FBNeo, nom du romset conservé) [VÉRIFIÉ : core.json fbneo `zip`,`7z`] | `neogeo.zip` facultatif, gardé zippé, `preload` non utilisé (c'est le BIOS `default`) [VÉRIFIÉ T0] | [4] [3] [11] |
| mastersystem | Master System | `segaMS` | smsplus (1er de la liste) | sms, zip [VÉRIFIÉ : core.json smsplus, `valid_extensions` du source `sms\|bin\|rom\|col\|gg\|sg`] | aucun requis ; `bios.sms` lu seulement si l'option `smsplus_sms_bios` est active (non fournie par nous) [VÉRIFIÉ source] | [3] [6] [11] |
| megadrive | Mega Drive | `segaMD` | genesis_plus_gx (1er) | md, bin, gen, smd, zip [VÉRIFIÉ : core.json] | `bios_MD.bin` (TMSS 2 Ko), lu SEULEMENT si l'option `genesis_plus_gx_bios` est activée (défaut `disabled`) : déclaré mais non posé [VÉRIFIÉ source] | [7] [3] [11] |
| gamegear | Game Gear | `segaGG` | genesis_plus_gx (seul) | gg, zip [VÉRIFIÉ : core.json] | aucun (`bios.gg` facultatif de GPGX, non déclaré) [VÉRIFIÉ source] | [3] [11] |
| megacd | Mega-CD / Sega CD | `segaCD` | genesis_plus_gx (1er ; picodrive en 2e) | cue (+ ses bin/audio, voir 3.3), iso, chd, zip [VÉRIFIÉ : core.json ; zip de cue+bin : chemin du code EmulatorJS, À CONFIRMER] | `bios_CD_E.bin`, `bios_CD_U.bin`, `bios_CD_J.bin` à la racine du système de fichiers du cœur, le cœur prend celui de la région du disque ; erreur « Unable to open CD BIOS » sinon [VÉRIFIÉ source GPGX] | [8] [3] [11] |
| 32x | 32X | `sega32x` | picodrive (seul) | 32x, bin, zip [VÉRIFIÉ : core.json picodrive] | aucun posé (le source picodrive ne cherche de BIOS que pour le CD) [VÉRIFIÉ source, À CONFIRMER à l'usage] | [9] [3] [11] |
| nes | NES | `nes` | fceumm (1er ; nestopia en option) | nes, fds, unf, unif, zip [VÉRIFIÉ : core.json] | `disksys.rom` (Famicom Disk System) requis SEULEMENT pour `.fds` (« FDS BIOS image (disksys.rom) missing ») [VÉRIFIÉ source fceumm] | [3] [11] |
| snes | Super Nintendo | `snes` | snes9x (seul) | sfc, smc, swc, fig, zip [VÉRIFIÉ : core.json] | aucun (STBIOS.bin et BS-X.bin seulement pour Sufami Turbo et BS-X, hors périmètre) [VÉRIFIÉ source] | [3] [11] |
| gameboy | Game Boy | `gb` | gambatte (seul) | gb, zip [VÉRIFIÉ : core.json `gb,gbc,dmg`] | `gb_bios.bin` (256 octets) facultatif, lu si `gambatte_gb_bootloader` (défaut `enabled`) : posé s'il existe (`preload`) [VÉRIFIÉ source] | [10] [3] [11] |
| gameboycolor | Game Boy Color | `gb` (pas d'alias `gbc`) | gambatte | gbc, zip [VÉRIFIÉ : core.json] | `gbc_bios.bin` (2304 octets) facultatif, posé s'il existe (`preload`) [VÉRIFIÉ source] | [10] [3] [11] |

Notes importantes :
1. **Neo Geo vs Arcade** : EmulatorJS n'a pas d'alias `neogeo`. Les deux dossiers passent par fbneo. La différence est uniquement dans notre menu (deux tuiles) et dans les BIOS déclarés. Source : table `cores` de consts.js, clé `arcade`. [VÉRIFIÉ]
2. **Zip non extraits pour fbneo** : le **jeu** (zip du romset) est écrit tel quel pour les cœurs `arcade` et `mame` (constaté en T0). En revanche, dans l'EmulatorJS **stable** (pas de `dontExtractIfCore`, contrairement à ce qu'on avait lu dans la branche main), le **BIOS** passé à `EJS_biosUrl` est toujours extrait : fbneo ne trouve alors pas `neogeo.zip` (voir 3.2). Conséquence directe : le **nom du fichier zip doit être le nom du romset FBNeo** (ex. `mslug.zip`, pas `Metal Slug.zip`). [VÉRIFIÉ pour le comportement, À VALIDER pour la version des romsets : les romsets doivent correspondre à la version de fbneo du CDN stable]
3. **Game Boy Color** : gambatte lit les deux formats avec le cœur `gb`. Deux dossiers distincts côté menu, même EJS_core.
4. **Master System / Game Gear** : alias `segaMS` et `segaGG` (pas `mastersystem`). [VÉRIFIÉ dans consts.js]
5. La doc officielle des pages système indique elle-même ne pas connaître les limites d'extensions (ex. page Sega CD : "I do not know the file extension limits"). Nos listes d'extensions sont donc à confirmer par T0 (étape 1) puis par machine à l'étape suivante.

### 2.1 Sources

- [1] https://emulatorjs.org/docs/systems/commodore-amiga
- [2] https://emulatorjs.org/docs4devs/cores
- [3] https://github.com/EmulatorJS/EmulatorJS/blob/main/data/src/consts.js (alias de cœurs, `requiresThreads`)
- [4] https://emulatorjs.org/docs/systems/arcade
- [5] https://github.com/EmulatorJS/EmulatorJS/blob/main/data/src/emulator.js (`dontExtractIfCore`, téléchargement du BIOS)
- [6] https://emulatorjs.org/docs/systems/sega-master-system
- [7] https://emulatorjs.org/docs/systems/sega-mega-drive
- [8] https://emulatorjs.org/docs/systems/sega-cd
- [9] https://emulatorjs.org/docs/systems/sega-32x
- [10] https://emulatorjs.org/docs/systems/nintendo-game-boy
- [11] T15 : `core.json` de chaque cœur, lu dans `https://cdn.emulatorjs.org/4.2.3/data/cores/<cœur>-wasm.data` (archive 7z) ; sources des cœurs sur github.com/EmulatorJS/{Genesis-Plus-GX, smsplus-gx, picodrive, libretro-fceumm, snes9x, gambatte-libretro} (branche master) ; `getCores()` et `downloadRom()` de `data/src/emulator.js` 4.2.3.
- Options : https://emulatorjs.org/docs/options
- CDN : https://emulatorjs.org/docs/cdn (base `https://cdn.emulatorjs.org/<stable|latest|nightly>/data/`)
- Loader : https://github.com/EmulatorJS/EmulatorJS/blob/main/data/loader.js
- Constat sur le CDN réel : `https://cdn.emulatorjs.org/stable/data/loader.js` répond 200, `access-control-allow-origin: *` et `cross-origin-resource-policy: cross-origin`. Cœurs `puae-wasm.data` (4 Mo) et `fbneo-wasm.data` (8 Mo) présents. Version stable actuelle : 4.2.3.

## 3. BIOS et cas particuliers

### 3.1 Amiga (puae)

- **Kickstart** : EmulatorJS n'accepte que des noms précis [VÉRIFIÉ, page Amiga] :

| Nom attendu dans `bios/` | Contenu (Amiga Forever) |
|---|---|
| kick33180.A500 | Kickstart 1.2 |
| kick34005.A500 | Kickstart 1.3 |
| kick37175.A500 | Kickstart 2.04 |
| kick37350.A600 | Kickstart 2.05 |
| kick40063.A600 | Kickstart 3.1 (A600) |
| kick39106.A1200 | Kickstart 3.0 (A1200) |
| kick40068.A1200 | Kickstart 3.1 (A1200) |
| kick39106.A4000 / kick40068.A4000 | A4000 |
| kick40060.CD32 (+ .ext) | CD32 |

  Le fichier de l'utilisateur doit donc être **renommé** avec le nom attendu. Le README du projet l'expliquera.
- **Un seul fichier via `EJS_biosUrl`** (la doc le décrit comme "URL to bios file", une chaîne). Le code stocke le BIOS dans le système de fichiers virtuel sous son nom d'origine (`/<nom>`) [VÉRIFIÉ]. Pour plusieurs fichiers, EmulatorJS offre `EJS_externalFiles` (objet chemin vers URL, une clé finissant par `/` extrait une archive dans ce dossier) [VÉRIFIÉ dans GameManager.js et loader.js]. 
- **Décision v1** : un Kickstart par défaut par machine (`kick40068.A1200`, Kickstart 3.1, le plus compatible) déclaré dans `systems.json`, avec **surcharge possible par jeu** (`bios` dans `games.json`, utile pour les vieux jeux qui exigent le 1.3). Sélection du modèle [VÉRIFIÉ T0, vrai Kickstart 3.1 A1200 sha1 e215...f1] : puae ne choisit pas le modèle d'après le BIOS présent. Pour un ADF sans étiquette de modèle dans son nom, il prend A500 (`kick34005.A500` introuvable, écran gris sans image). D'où `coreOptions: {"puae_model": "A1200"}` dans `systems.json` : puae charge alors `kick40068.A1200` (`EJS_biosUrl`, écrit à la racine sous son nom exact, trouvé tel quel) et Leander démarre. Les jeux qui exigent le Kickstart 1.3 (A500) restent à traiter (surcharge par jeu des options : non faite, à voir avec un jeu concerné).
- **Formats** : `.adf` [VÉRIFIÉ T0 : ADF de 901120 octets, démarre]. adz, dms, ipf, hdf, hdz, lha, zip, m3u [À VALIDER, aucun fichier réel]. Risque connu : le support IPF dépend de la bibliothèque capsimg, absente de certains builds libretro. [À VALIDER] avec un IPF réel.
- **Nom du fichier dans le système de fichiers du cœur** : EmulatorJS garde le dernier segment de l'URL tel quel, donc **encodé** (`Leander%20(1991)...%5Bcr%20Flashtro%5D.adf`). puae l'accepte (disque inséré en DF0:). L'URL de requête est correcte (`%20`, `%5B`, `%C3%A9` vérifiés).
- **Multi-disques** (T10) : un jeu à plusieurs disquettes est UNE entrée de games.json avec `disks` (voir 6.2) ; le lanceur (`launcher.js`) fabrique côté navigateur un **`.m3u` virtuel** (objet `File` passé en `EJS_gameUrl`, EmulatorJS garde son nom) et pose les ADF via `EJS_externalFiles` à la racine du système de fichiers du cœur sous des noms ASCII sûrs (`disk1.adf`, `disk2.adf`...). Le nom réel (espaces, parenthèses, crochets) n'a ainsi aucune importance : le problème de l'encodage du nom (`%20`) ne se pose pas. Le m3u n'a pas de ligne de commentaire (EmulatorJS lit ses lignes une à une pour nommer les disques) et chaque ligne est `diskN.adf|Disk N` (puae accepte le `|libellé`, le menu affiche « Disk 1/2/3 ») [VÉRIFIÉ T10, Chromium automatisé avec Leander : « M3U parsed, 3 file(s) found », disquettes insérées dans DF0 puis DF1 et DF2 (puae_floppy_multidrive actif par défaut), `getDiskCount() = 3`, menu de disques d'EmulatorJS visible, écran « Psygnosis presents » avec la disquette 1]. Changement de disquette : menu d'EmulatorJS (icône disquette de la barre du bas) puis `setCurrentDisk` ; puae journalise « Disk (2) inserted in drive DF0: 'disk2.adf' » [VÉRIFIÉ T10]. **Trois défauts d'EmulatorJS stable contournés dans `launcher.js` (guardDiskMenuStartup)** : (1) `startGame()` construit le menu des disques avant `allSettings` : « Failed to start game » sans contournement ; (2) le menu « sélectionne » le disque déjà inséré au démarrage, ce qui fait planter le cœur (`unreachable`) : ignoré ; (3) chaque vrai changement lève `unreachable` au premier appel et réussit au second (constaté sur 6 changements) : le lanceur rappelle une fois. Raccourci (T12) : `player/disk-shortcut.js` (Select+RB, F9) appelle `switchToDisk` de `launcher.js`, qui passe par `handleSpecialOptions('disk', n)`, la même fonction que le menu, donc par le même rappel unique ; le disque courant est lu dans le cœur (`getDiskState` : `gameManager.getCurrentDisk()` / `getDiskCount()`), jamais dupliqué. Limite : le menu d'EmulatorJS garde sa sélection affichée et peut montrer l'ancien disque. **[À CONFIRMER à la main, non testé]** : jouer réellement plusieurs minutes, réponse du jeu à « insérez la disquette 2 », comportement de Leander après un changement forcé (le test automatisé a vu un écran noir puis le titre Leander, et une instruction illégale du CPU émulé juste après un changement fait pendant l'écran de présentation : un changement fait au mauvais moment fait planter le jeu émulé, c'est normal sur une vraie Amiga aussi). `.m3u` écrit à la main dans roms/ : toujours supporté (règle 4 section 7) mais **non testé** dans cet état ; son contenu est alors passé tel quel à EmulatorJS (les chemins d'un `.m3u` réel et leurs noms encodés n'ont pas été vérifiés).

### 3.2 Neo Geo et Arcade (fbneo)

- **Constaté en T0 (CDN stable, romset viewpoin, vrai neogeo.zip)** : `EJS_biosUrl = 'bios/neogeo.zip'` ne marche PAS. EmulatorJS extrait l'archive (34 fichiers en vrac à la racine) et fbneo affiche « ROM sp-s3.sp1 is missing » (le répertoire système de fbneo est `/`, il cherche `/neogeo.zip` entier). `EJS_dontExtractBIOS = true` plante (`ErrnoError` : il écrit `bios/neogeo.zip` dans un dossier `bios/` inexistant). `EJS_externalFiles = {'/neogeo.zip': url}` échoue aussi : l'`ArrayBuffer` téléchargé n'est pas accepté par l'écriture. **Solution retenue** : `launcher.js` télécharge `bios/neogeo.zip` lui-même et passe un `Uint8Array` : `EJS_externalFiles = {'/neogeo.zip': <Uint8Array>}` (champ `keepZipped: true` de l'entrée `bios` dans `systems.json`, champ `rawFiles` du plan). Le jeu démarre alors (logo Neo Geo puis jeu, image qui change).
- Jeu : le zip du romset passé tel quel dans `EJS_gameUrl`. Nom de fichier = nom du romset (`mslug.zip`).
- Titre affiché : le nom de fichier d'un romset arcade n'est pas lisible (`mslug`, `kof98`). Prévoir un fichier de surcharge de titres `data/titles.json` (clé = nom de fichier sans extension) lu par le générateur, avec nettoyage automatique pour les autres machines. Sans cela, l'écran Neo Geo affichera des codes.
- Neo Geo CD n'est pas supporté ici (hors périmètre).

### 3.3 Les 10 autres machines (T15)

Statut : tout est **[VÉRIFIÉ]** dans le code (EmulatorJS 4.2.3, `core.json` des cœurs, sources des cœurs), **rien n'a été joué** avec de vrais jeux : à confirmer par Hicham (**[À CONFIRMER par Hicham]**) machine par machine.

- **Cœurs et threads** : les alias de la table section 2 sont ceux de `getCores()` (emulator.js 4.2.3 l.2-44). `requiresThreads` ne contient que `ppsspp` et `dosbox_pure` (l.46-48) : aucun de nos cœurs ne demande de threads ni de SharedArrayBuffer, GitHub Pages reste possible. Les fichiers `core.json` de smsplus, genesis_plus_gx, picodrive, fceumm, snes9x, gambatte et fbneo ont tous `"options": {}` : **ni `useKeyboard` ni `retroarchOpts`**. Donc « Direct Keyboard Input » reste `disabled` par défaut (emulator.js l.4986), RetroArch ignore le clavier du document (`keyboard_enabled != 1`) et `disableRetroArchHotkeys` est **inutile pour ces 10 machines** (et pour fbneo). Remarque : le `core.json` de puae (Amiga) n'a lui non plus que `{"supportsMouse": true}`, donc sans `useKeyboard` : l'hypothèse « clavier direct actif sur Amiga » de T14 / `docs/diagnostic-neogeo-lent.md` est probablement fausse (le réglage peut toutefois être mis à `enabled` par la personne, dans le menu ou le localStorage). À examiner par le tech-lead, hors périmètre T15.
- **Archives zip** : `downloadRom()` extrait le zip, choisit le fichier dont l'extension est dans `core.json`, puis (cue/ccd/m3u présents) le `.cue`. Pour `arcade`/`mame` le zip est écrit tel quel (T0). D'où `zip` accepté partout.
- **Mega-CD (genesis_plus_gx)** : EmulatorJS ne télécharge QU'UN fichier de jeu (`EJS_gameUrl`) ; un `.cue` seul ne suffit pas, il faut ses `.bin`. Solution T15 : une tuile par `.cue`, `games.json` porte `extraFiles: [{file, as}]` (fichiers cités par les lignes `FILE`, dans l'ordre), le lanceur passe le `.cue` en `EJS_gameUrl` et pose chaque fichier à la racine sous le nom écrit dans le `.cue` (`EJS_externalFiles`, octets, comme les disquettes de T10 : `loadExternalFiles` s'exécute avant le jeu et le `.cue` est écrit à la racine, donc les chemins relatifs du `.cue` sont résolus). Le générateur résout les noms sans tenir compte de la casse et dans le sous-dossier du `.cue` ; `..` et chemins absolus refusés. `bin` et `m3u` sont retirés des extensions : un `.bin` seul est une ROM de cartouche pour GPGX (il ne démarre pas comme CD) et un `.m3u` de `.cue` n'amènerait pas les `.cue`/`.bin` qu'il cite. `iso` et `chd` (un seul fichier) passent par `EJS_gameUrl` normalement (`isoFile`). **Risque** : un `.bin` fait 300 à 700 Mo, il est lu en entier dans un `Uint8Array` puis recopié dans le système de fichiers du cœur (mémoire doublée) : possible échec sur de gros disques ; le `.chd` (compressé) est le format conseillé. [À CONFIRMER par Hicham]
- **BIOS Mega-CD** : `genesis_plus_gx` cherche `bios_CD_E.bin`, `bios_CD_U.bin`, `bios_CD_J.bin` dans le répertoire système (repli : dossier du jeu = `/`) selon la région du disque, et signale une erreur s'il manque (« Unable to open CD BIOS »). `EJS_biosUrl` n'accepte qu'un fichier : les trois sont `preload` (champ ajouté à `bios` de `systems.json`, voir 6.1), posés tels quels à la racine par `EJS_externalFiles` s'ils existent (HEAD) ; aucun n'est « requis » individuellement (il faut celui de la région).
- **Autres BIOS** : Game Boy / Color (`gb_bios.bin`, `gbc_bios.bin`) lus par gambatte si `gambatte_gb_bootloader` est `enabled` (défaut) : `preload`. NES `disksys.rom` : requis par fceumm pour les `.fds` seulement : `preload` facultatif. Mega Drive `bios_MD.bin` et Master System `bios.sms` ne servent qu'avec une option de cœur désactivée par défaut : non posés (déclaré seulement pour `bios_MD.bin`, à titre de documentation).
- **Arcade** : même cœur que Neo Geo. Les romsets doivent correspondre à la version de FBNeo du CDN ; un romset « clone » dont le parent est un autre zip (ou qui demande un BIOS comme `pgm.zip`, `neogeo.zip`) échoue sans ce parent : le support parent (`EJS_gameParentUrl`) n'est pas fait (hors T15). `data/titles.json` contient déjà les titres usuels.
- **Résolution de l'extension de `.bin` de Mega Drive / 32X** : toute extension de ces machines est une ROM de cartouche (pas de `.cue`).

## 4. SharedArrayBuffer, COOP/COEP, GitHub Pages

- `EJS_threads` ne sert qu'aux cœurs listés dans `requiresThreads`. Dans le bundle stable : `["ppsspp","dosbox_pure"]` ; dans la branche main : `+ azahar`. **puae et fbneo n'en font pas partie.** Aucun de nos cœurs (puae, fbneo, smsplus, genesis_plus_gx, picodrive, fceumm, snes9x, gambatte) n'a besoin de threads. [VÉRIFIÉ dans consts.js et emulator.min.js stable]
- Donc : `EJS_threads` reste à `false` (défaut), **pas d'en-têtes COOP/COEP**, pas de `coi-serviceworker`.
- GitHub Pages ne permet pas d'ajouter des en-têtes HTTP. Ce n'est pas bloquant ici. Si un jour un cœur à threads est ajouté (PSP, DOS), la solution documentée dans l'écosystème est le shim `coi-serviceworker` (fait semblant d'envoyer COOP/COEP). À noter : le CDN EmulatorJS envoie déjà `Cross-Origin-Resource-Policy: cross-origin`, donc un futur COEP ne casserait pas le chargement des cœurs.
- Autres contraintes GitHub Pages à respecter : tous les chemins **relatifs** (le site vit sous `/<dépôt>/`), routage par **hash** (`#/neogeo`) car pas de réécriture d'URL, HTTPS fourni (donc service worker/PWA OK).
- Version du CDN : **épinglée à `4.2.3`** depuis T10 (les contournements multi-disquettes sont propres à cette version ; `stable` bouge avec le temps). Une seule constante dans `js/config.js` (`EJS_CDN_VERSION`) pour la changer ou l'épingler. Vérifier en T0 si `https://cdn.emulatorjs.org/4.2.3/data/` répond (épinglage), sinon rester sur `stable`.

## 5. Arborescence

```
emulateur/
  index.html                 page unique : accueil + grilles (SPA par hash)
  player.html                page de jeu (EmulatorJS)
  manifest.webmanifest       PWA
  sw.js                      service worker (coquille de l'app seulement)
  systems.json               SEULE source de vérité des machines (commité)
  games.json                 GÉNÉRÉ, dans .gitignore
  data/
    titles.json              surcharges de titres (arcade/neogeo), commité
  css/
    base.css  home.css  grid.css  player.css      (variables = docs/ux.md section 5)
  js/
    config.js                constantes (version CDN, chemins roms/bios)
    data.js                  charge/valide systems.json + games.json
    router.js                routes hash, aucune logique d'écran
    input/
      actions.js             clavier + manette vers actions abstraites
      focus-nav.js           navigation spatiale du focus
    ui/
      dom.js                 petits helpers de création d'éléments
      machine-grid.js        écran accueil
      game-grid.js           écran grille de jeux
      dialog.js              boîte de confirmation (réutilisée accueil + player)
    player/
      launcher.js            construit la config EmulatorJS (systems + game)
      exit-guard.js          détection de sortie (manette, clavier, retour)
      player-main.js         point d'entrée de player.html
    app.js                   point d'entrée de index.html
  assets/
    logos/                   un logo par machine (SVG)
    icons/                   icônes PWA 192 et 512
  scripts/
    generate-games.mjs       scanner roms/ vers games.json
    serve.mjs                serveur local sans dépendance
  roms/   (gitignore)        roms/<machine>/*
  bios/   (gitignore)        kick*.A* , neogeo.zip, bios_*.bin
  docs/   architecture.md  ux.md
  .gitignore                 roms/ bios/ games.json node_modules/
  README.md
```

Règle de découpage : un module = une responsabilité. Les écrans n'importent que `data.js`, `router.js`, `input/*`, `ui/dom.js`. Seul `launcher.js` connaît EmulatorJS.

## 6. Schémas de données

### 6.1 systems.json (source de vérité, commité)

Champs : `id` (= nom du sous-dossier de `roms/`, casse ignorée à la lecture : `roms/Amiga/` est trouvé pour `amiga`, le chemin écrit dans `games.json` est le chemin réel), `name`, `order`, `emulatorjsCore`, `extensions` (minuscules, sans point), `bios` (liste), `logo`, `accent` (variable CSS de fallback), `wave` (1 = livré à l'étape 1, 2 = plus tard ; l'accueil n'affiche en actif que les machines avec au moins un jeu, donc `wave` sert surtout de documentation).

Chaque entrée `bios` : `file` (chemin sous `bios/`), `required` (booléen), `role` (`default` = passé à `EJS_biosUrl` si présent, `optional`), `note`, `keepZipped` (optionnel, booléen : BIOS à poser tel quel, non extrait, à la racine du système de fichiers du cœur ; Neo Geo), `preload` (optionnel, booléen, T15 : fichier posé tel quel à la racine sous son nom exact s'il existe, EN PLUS de `EJS_biosUrl` ; sert aux cœurs qui lisent plusieurs BIOS : Mega-CD x3, Game Boy, NES `disksys.rom`).

Champ optionnel de machine `disableRetroArchHotkeys` (booléen, Amiga) : met à `"nul"` tous les raccourcis de RetroArch (T14, `js/player/retroarch-cfg.js`) ; des lignes sont AJOUTÉES au `retroarch.cfg` d'EmulatorJS pour TOUTES les machines (surcharge de `EJS_GameManager.prototype.getRetroArchCfg`, journal d'erreurs pour détecter un échec de démarrage, `js/player/ejs-start-watch.js`) ; rien d'EmulatorJS n'est recopié.

Champ optionnel de machine `coreOptions` (objet nom d'option du cœur vers valeur) : devient `EJS_defaultOptions` (et coupe `EJS_disableLocalStorage`, sans quoi EmulatorJS stable ignore ces options au premier lancement). Amiga : `{"puae_model": "A1200"}`, constaté en T0 : sans cela puae prend le modèle A500 et cherche `kick34005.A500` (« Kickstart ROM not found »), il ne regarde pas notre `kick40068.A1200`. Avec A1200, il charge bien `kick40068.A1200` (CPU 68020, chipset AGA). Amiga ajoute `"puae_floppy_multidrive": "disabled"` (T14) : le défaut du cœur (`enabled`) met les disquettes 2, 3... dans DF1, DF2..., alors que les cracks mono-lecteur (Leander) demandent le disque 2 dans DF0 ; il faut relancer le jeu pour que le réglage compte. Changement de disquette (`guardDiskMenuStartup`, T14) : le filtre « même disque » ne vaut qu'au démarrage (jusqu'à 2 s après `EJS_onGameStart`), ensuite re-choisir le disque courant éjecte et réinsère ; si le second appel échoue, le disque d'origine est réinséré (au mieux) puis l'erreur remonte, le jeu reste ouvert.

```json
{
  "version": 1,
  "systems": [
    {
      "id": "amiga",
      "name": "Amiga",
      "order": 10,
      "emulatorjsCore": "amiga",
      "extensions": ["adf", "adz", "dms", "ipf", "hdf", "hdz", "lha", "zip", "m3u"],
      "bios": [
        { "file": "kick40068.A1200", "required": true, "role": "default",
          "note": "Kickstart 3.1 A1200, renommer le fichier avec ce nom exact" }
      ],
      "logo": "assets/logos/amiga.svg",
      "accent": "--m-amiga",
      "wave": 1
    },
    {
      "id": "neogeo",
      "name": "Neo Geo",
      "order": 20,
      "emulatorjsCore": "arcade",
      "extensions": ["zip"],
      "bios": [
        { "file": "neogeo.zip", "required": true, "role": "default",
          "note": "Laisser zippé" }
      ],
      "logo": "assets/logos/neogeo.svg",
      "accent": "--m-neogeo",
      "wave": 1
    }
  ]
}
```

Les 10 autres entrées (arcade, mastersystem, megadrive, gamegear, megacd, 32x, nes, snes, gameboy, gameboycolor) suivent le tableau section 2, avec `wave: 2`. Les BIOS Mega-CD sont trois entrées `optional` + `preload` (T15, voir 3.3) : le cœur choisit celui de la région du disque.

### 6.2 games.json (généré, jamais édité à la main)

```json
{
  "version": 1,
  "generatedAt": "2026-11-09T21:00:00.000Z",
  "games": [
    {
      "id": "neogeo/mslug",
      "system": "neogeo",
      "title": "Metal Slug",
      "file": "roms/neogeo/mslug.zip",
      "cover": "roms/neogeo/mslug.png"
    },
    {
      "id": "amiga/lemmings",
      "system": "amiga",
      "title": "Lemmings",
      "file": "roms/amiga/Lemmings.adf",
      "cover": null,
      "bios": "kick34005.A500"
    }
  ]
}
```

- `id` = `<machine>/<nom de fichier sans extension, en minuscules, espaces remplacés par _>`. Stable, utilisé dans l'URL du player et pour le focus de retour.
- `extraFiles` (optionnel, T15, Mega-CD) : liste de `{file, as}` : fichiers cités par les lignes `FILE` du `.cue` (`file` = chemin réel sous roms/, `as` = nom écrit dans le `.cue`, utilisé comme nom dans le système de fichiers du cœur). Absent pour un jeu sans `.cue`. Validé par `validateGames`.
- `disks` (optionnel, ajouté en T10, `version` reste 1 car le champ est facultatif et un front ancien ignore ce champ et lance `file`) : liste ordonnée (au moins 2) des chemins relatifs des disquettes d'un jeu multi-disquettes ; `disks[0]` = `file` (disquette 1, ou la première présente). Absent pour un jeu simple. Exemple : `"id": "amiga/leander_(1991)(psygnosis)", "title": "Leander", "file": "roms/Amiga/Leander (1991)(Psygnosis)(Disk 1 of 3)[cr Flashtro].adf", "disks": [".../(Disk 1 of 3)...adf", ".../(Disk 2 of 3)...adf", ".../(Disk 3 of 3)...adf"]`. Validé côté front par `validateGames` (data.js) : un jeu dont `disks` est invalide est écarté.
- `cover` : image de même nom (png, jpg, jpeg, webp) dans le même dossier, sinon `null`.
- `bios` (optionnel) : surcharge du BIOS par défaut de la machine, présente seulement si un fichier `<nom>.bios` existe à côté du jeu (une ligne : le nom du BIOS). Évite de compliquer le format pour tous.
- Les chemins sont relatifs (compatibles GitHub Pages et sous-dossier).
- `file`, `cover` et `id` ne sont pas encodés : le front doit appliquer `encodeURIComponent` à CHAQUE segment des chemins (`assetUrl` de `js/data.js`, `/` conservés : `encodeURI` laisserait `#` et `?` intacts, T11/A1) et `encodeURIComponent` sur `id` dans `player.html?game=` et `#/...?focus=`.

## 7. scripts/generate-games.mjs

Node.js 18+ sans dépendance (`node:fs/promises`, `node:path`, `node:url`).

1. Lire `systems.json` (même fichier que le front : c'est ce qui garantit la source unique).
2. Pour chaque machine, lister `roms/<id>/` (récursif d'un niveau de sous-dossier toléré), le nom du dossier étant retrouvé sans tenir compte de la casse (`pickSystemDir` ; casse exacte préférée ; le dossier n'est jamais renommé). Dossier absent = machine ignorée sans erreur.
3. Retenir les fichiers dont l'extension (minuscule) est dans `extensions` de la machine.
4. Règle `.m3u` Amiga : les fichiers cités dans un `.m3u` sont exclus de la liste, le `.m3u` devient le jeu.
4c. Règle `.cue` (T15) : si `cue` fait partie des extensions de la machine, les noms des lignes `FILE` de chaque `.cue` (`parseCue`) sont les fichiers du jeu : ils ne sont pas listés à part (ni d'avertissement « extension non prise en charge » pour eux), `extraFiles` les liste dans l'ordre du `.cue`. Fichier cité introuvable : jeu gardé + avertissement (le lanceur répond « Jeu introuvable » au lancement). Un `.cue` n'est jamais regroupé comme disquette (`Disk N`).
4b. Règle multi-disquettes (T10) : les fichiers (même dossier, même extension) dont le nom contient `(Disk N of M)`, `(Disk N)` ou `Disk N of M` (insensible à la casse) forment UN jeu. Nom de base = nom sans cette étiquette ni les `[drapeaux]` ; l'id est `<machine>/<nom de base>` (ex. `amiga/leander_(1991)(psygnosis)`, stable quelle que soit la disquette manquante ou présente), le titre est tiré du nom de base (surcharge titles.json par ce nom de base), `file` = disquette 1 (ou la plus petite présente), `disks` = liste triée par numéro (10 après 2). Jaquette et `.bios` : ceux de la disquette 1 d'abord, sinon ceux du nom de base. Groupe incomplet (numéro manquant entre 1 et le total annoncé, ou au plus grand numéro présent) : avertissement `jeu X incomplet, disquette(s) manquante(s) : 2 sur 3`, jeu gardé avec les disquettes présentes ; une seule disquette présente = jeu simple (sans `disks`) + avertissement. Deux fichiers du même numéro : le premier par nom est gardé, avertissement. Un `.m3u` prime : ses disques sont exclus avant tout regroupement. `(Disk 1)` seule sans total : jeu simple, pas d'avertissement.
5. Titre : surcharge `data/titles.json` si présente, sinon nom du fichier nettoyé (suppression de l'extension, des étiquettes entre parenthèses ou crochets comme `(Europe)` `[!]`, `_` en espace ; les noms TOSEC/No-Intro donnent le titre seul : `Leander (1991)(Psygnosis)(Disk 1 of 3)[cr Flashtro].adf` donne `Leander`). Tri par titre (`localeCompare`, fr, numérique).
6. Jaquette : même nom + `.png|.jpg|.jpeg|.webp`.
7. Écrire `games.json` de façon atomique (fichier temporaire puis renommage).
8. Sortie console : nombre de jeux par machine, avertissements (BIOS `required` absent dans `bios/`, extension inconnue ignorée, doublon d'`id`). Code de sortie 0 sauf erreur de lecture de `systems.json`.
9. Option `--check` : n'écrit rien, affiche seulement le diagnostic.

Commande : `node scripts/generate-games.mjs`. À relancer après chaque ajout de ROM. Exposer aussi `npm run` n'est pas nécessaire (pas de package.json obligatoire).

## 8. Application web

### 8.1 Navigation et écrans (index.html)

- Routes hash (voir réponse à ux, section 11) : `#/` accueil, `#/<machine>` grille. Le jeu est une **page**, pas une route hash.
- `app.js` charge `systems.json` + `games.json` (échec ou vide : écran d'aide "Aucun jeu trouvé, lancez generate-games", sans bloquer l'accueil), puis délègue à `machine-grid.js` ou `game-grid.js` selon la route.
- `games.json` absent sur GitHub Pages (gitignoré) : message dédié, pas d'erreur console bloquante.

### 8.2 Couche d'entrée unique (DRY)

`input/actions.js` transforme toutes les sources en 6 actions abstraites : `up, down, left, right, confirm, back`.
- Clavier : flèches, Entrée/Espace = confirm, Échap/Retour arrière = back.
- Manette (Gamepad API, polling `requestAnimationFrame`, mapping standard) : croix directionnelle et stick gauche (avec seuil et répétition), bouton A (0) = confirm, B (1) = back. Anti-rebond et répétition à vitesse réglable, une seule implémentation.
- Souris et tactile : on laisse les `click` natifs sur des éléments `<button>` ou `<a>`. Pas de couche supplémentaire.

`input/focus-nav.js` : navigation spatiale. Les éléments navigables portent `data-nav`. Pour une action directionnelle, on choisit l'élément focusable le plus proche dans la direction (géométrie via `getBoundingClientRect`). Même code pour la grille des machines, la grille des jeux et la boîte de dialogue (le dialogue piège le focus).
Les écrans ne gèrent jamais le clavier ou la manette eux-mêmes : ils déclarent des éléments `data-nav` et réagissent à `confirm`/`back`.

### 8.3 Lancement d'EmulatorJS (player.html) : page dédiée, pas d'iframe

Choix : **page dédiée** `player.html?system=<id>&game=<id>`.

Pourquoi pas une iframe :
- Gamepad API et clavier : une iframe a le focus, la page parente risque de ne rien recevoir (selon le navigateur) ; dans une page dédiée, notre garde de sortie et EmulatorJS partagent le même `window`, on lit simplement `navigator.getGamepads()` en lecture seule à côté d'EmulatorJS.
- Nettoyage : EmulatorJS n'a pas de vraie fonction de destruction (WASM, AudioContext, boucle de rendu). Un déchargement de page est le seul nettoyage garanti, sans fuite mémoire ni son résiduel. Navigation vers `index.html#/<machine>?focus=<id>`.
- Plein écran et geste Android : mieux maîtrisés sans cadre intermédiaire.

Séquence dans `player-main.js` :
1. Lire `system` et `game` dans l'URL, charger `systems.json` et `games.json`, retrouver l'entrée (sinon écran d'erreur avec bouton retour).
2. Afficher un écran "Jouer" (bouton focalisé, activable à la manette via la couche d'entrée). Ce clic est le geste utilisateur qui autorise le **plein écran** et le **son** (sans lui les navigateurs bloquent les deux).
3. `launcher.js` pose les variables globales **avant** de charger `loader.js` (le loader les lit à son chargement) :
   `EJS_player = '#game'`, `EJS_core = system.emulatorjsCore`, `EJS_gameUrl = game.file`, `EJS_biosUrl = bios choisi (surcharge du jeu, sinon BIOS role default de la machine)`, `EJS_pathtodata = CDN + '/data/'`, `EJS_gameName = game.title`, `EJS_startOnLoaded = true`, `EJS_askBeforeExit = false`, `EJS_threads` non défini. Pour le zip arcade, le jeu est passé tel quel ; le BIOS `keepZipped` (neogeo.zip) ne passe PAS par `EJS_biosUrl` mais par `EJS_externalFiles` (octets téléchargés par `launcher.js`, voir 3.2) ; `coreOptions` de la machine devient `EJS_defaultOptions` (+ `EJS_disableLocalStorage`).
   Jeu multi-disquettes (`game.disks`) : pas d'`EJS_gameUrl` dans le plan ; `launcher.js` ajoute `virtualGame` (m3u) et `rawFiles` (disquettes), `loadEmulator` pose `EJS_gameUrl = new File([m3u], nom.m3u)` et `EJS_externalFiles` (voir 3.1), et installe les contournements d'EmulatorJS stable.
   Puis injection dynamique de `<script src="<CDN>/data/loader.js">`.
4. Si le BIOS `required` est absent (test `HEAD`), message clair avant de lancer : "BIOS manquant : kick40068.A1200 dans bios/".
5. `exit-guard.js` s'active dès l'écran "Jouer" :
   - Manette : Select (8) + Start (9) maintenus 1 s, lecture seule du polling. Événement `onExitRequested` avec progression (pour l'anneau UX).
   - Clavier : `F10`, ou `Échap` maintenu 1 s (écoute en phase de capture sur `window` ; `keydown.repeat` ignoré, durée mesurée). F10 n'est pas une touche par défaut d'EmulatorJS [VÉRIFIÉ en T0 : touches du joueur 1 = x s v Entrée flèches z a q e Tab r h f g t l j k i 1 2 3 ; ni F10 ni Échap].
   - Tactile et souris : bouton "Menu" de la page, superposé au-dessus du lecteur (z-index supérieur, hors de la zone des boutons virtuels EmulatorJS ; position définie avec ux).
   - Retour Android/navigateur : à l'arrivée, `history.pushState` d'une entrée sentinelle ; `popstate` ouvre la confirmation et remet la sentinelle.
   Toute demande de sortie : mettre en pause (`window.EJS_emulator.pause()` si disponible), ouvrir `dialog.js` (Quitter / Continuer). Continuer = reprise. Quitter = `location.replace('index.html#/<machine>?focus=<gameId>')`.
6. Au retour, `game-grid.js` lit `focus` et donne le focus à la tuile du jeu quitté, avec défilement (demande ux).

Plein écran : appel `requestFullscreen` dans le gestionnaire du clic "Jouer". Meilleur effort : refusé = on joue en fenêtre, le bouton Menu reste visible.

### 8.4 PWA

- `manifest.webmanifest` : `display: fullscreen` avec repli `standalone`, `start_url: "./"`, icônes 192/512, thème sombre. Chemins relatifs.
- `sw.js` : met en cache **la coquille de l'app seulement** (html, css, js, systems.json, logos). Ne met **jamais** en cache `roms/`, `bios/` ni `games.json` (stratégie réseau d'abord pour games.json). Le CDN EmulatorJS n'est pas pris en charge par notre SW : EmulatorJS garde lui-même les cœurs en cache navigateur (IndexedDB), donc un cœur déjà chargé peut rejouer sans réseau.
- Un service worker exige HTTPS ou `localhost` (voir limites section 9).

## 9. Serveur local et limites de plateforme

`scripts/serve.mjs` (Node, sans dépendance) : sert le dossier courant, port 8080 par défaut (`PORT` modifiable), MIME corrects (`.wasm`, `.json`, `.webmanifest`, `.adf` et inconnus en `application/octet-stream`), **requêtes Range** (utile pour les gros fichiers), `Cache-Control: no-cache` en développement, écoute sur toutes les interfaces pour l'accès depuis un téléphone, affiche l'URL locale et l'URL réseau (`http://192.168.x.x:8080`). Repli sans Node : `python3 -m http.server 8080`.

Limites à connaître :
- **Mac/PC** : `http://localhost:8080` est un contexte sécurisé, le service worker et l'installation PWA fonctionnent.
- **Android sur le réseau local** : `http://192.168.x.x` n'est **pas** un contexte sécurisé, donc **pas de service worker ni d'installation PWA complète** (raccourci "Ajouter à l'écran d'accueil" seulement). Le jeu fonctionne. Pistes si besoin : (a) tunnel HTTPS, (b) option Chrome "Treat insecure origins as secure", (c) Android avec un serveur local directement sur l'appareil.
- **GitHub Pages** : app installable en PWA (HTTPS) mais **sans ROMs** (par conception). Piste proposée pour plus tard : bouton "Ouvrir un fichier de jeu" (sélecteur de fichier, `URL.createObjectURL` passé à `EJS_gameUrl`) pour jouer depuis Pages sans rien publier.

## 10. Risques

1. **Compatibilité des romsets** (fbneo, Neo Geo) : un zip incorrect ou d'une autre version de romset ne démarre pas, sans message utile. Atténuation : README précis, rappel de l'exigence dans l'écran d'erreur.
2. **Kickstart Amiga** : nom exact imposé, modèle choisi par puae à valider (T0). Sans BIOS valide, EmulatorJS peut démarrer en AROS de repli ou échouer selon le cœur.
3. **IPF** peut ne pas être lisible (capsimg). Vérifié en T0 ; sinon conseiller ADF/ADZ/DMS.
4. **Dépendance au CDN** : pas de jeu si EmulatorJS est inaccessible la première fois. Version épinglée à 4.2.3 (T10) ; la relever demande de retester les contournements (README).
5. **Plein écran et son** refusés sans geste utilisateur : traité par l'écran "Jouer".
6. **Mapping clavier/manette** : conflit possible entre l'écoute de sortie et celle d'EmulatorJS ; neutralisé par le maintien de 1 s et la lecture seule.
7. **Logos de marques** : les logos officiels sont des marques déposées ; pour un dépôt public prévoir des logos maison ou des textes stylisés (arbitrage PO, section 12).
8. **Android PWA hors HTTPS** : voir section 9.

## 11. Réponses au designer ux

1. Parent et Gamepad/clavier : réglé, pas d'iframe, le player est une page où notre garde de sortie et EmulatorJS cohabitent.
2. Sorties : Select+Start 1 s, F10, Échap maintenu 1 s, bouton Menu, retour Android = même confirmation. Faisable.
3. Focus au retour : faisable via le paramètre `focus` (id du jeu).
4. Route : jeu = page dédiée `player.html?system=…&game=…`. Menu = `#/` et `#/<machine>`. Pas de route `#/<machine>/<jeu>`.
5. Formats par machine : tableau section 2, extensions à valider en T0.

## 12. Points à arbitrer (PO)

1. Android : accepter l'absence de PWA installable en réseau local (hors HTTPS) ? Ou investir dans un tunnel HTTPS / bouton "Ouvrir un fichier" ?
2. Logos des machines : logos officiels (risque marque) ou visuels maison ?
3. Titres des jeux arcade/Neo Geo : accepter un fichier `data/titles.json` à maintenir (nom de romset vers titre lisible) ?
4. Plein écran : accepter l'étape supplémentaire "Jouer" avant le jeu (nécessaire au son et au plein écran) ?
5. `games.json` non commité (donc Pages affichera un message "aucun jeu") : OK ?

## 13. Découpage en tâches (étape 1 : amiga + neogeo)

Les fichiers sont disjoints pour permettre le travail en parallèle quand l'ordre le permet. Chaque tâche est livrable et testable seule.

| # | Tâche | Fichiers | Dépend de | Critère de fin |
|---|---|---|---|---|
| T0 | **Spike technique** : `player.html` minimal jetable avec ROM et BIOS réels : (a) Amiga avec `kick40068.A1200` + un ADF, test IPF, test multi-disques m3u, (b) Neo Geo avec `neogeo.zip` + un romset. Noter : chemin des BIOS, extensions acceptées, F10 libre. Compléter les [À VALIDER] de ce document | `spike/` (jetable) puis mise à jour de ce document | rien | Section 2 et 3 sans [À VALIDER] pour amiga et neogeo |

**État T0 (fait sans `spike/`, directement sur `player.html` avec les vrais fichiers)** : Neo Geo (viewpoin + neogeo.zip) et Amiga (Leander ADF + Kickstart 3.1 A1200) validés de bout en bout (BIOS trouvé, jeu qui démarre, pause et reprise, F10, Échap, sortie avec focus). Corrections : BIOS Neo Geo posé via `EJS_externalFiles` (`keepZipped`), modèle puae A1200 via `coreOptions`. **Reste ouvert** : IPF, multi-disques (m3u, `Disk N of M`, menu de changement de disque), Échap maintenu en plein écran sur un vrai Chrome (non vérifiable par automatisation : les événements clavier injectés ne passent pas par le navigateur), Kickstart 1.3 par jeu.
| T1 | Squelette : arborescence, `.gitignore`, `systems.json` (12 machines), `scripts/serve.mjs`, `README.md` (installation, nommage des BIOS) | racine, `scripts/serve.mjs`, `systems.json` | rien | `node scripts/serve.mjs` sert le site, systems.json valide |
| T2 | `generate-games.mjs` + `data/titles.json` + tests `node:test` sur des faux fichiers (sans ROM réelle) | `scripts/`, `data/` | T1 | games.json conforme au schéma 6.2 sur dossiers de test |
| T3 | `config.js`, `data.js`, `router.js`, `ui/dom.js` | `js/` | T1 | modules testables, gestion `games.json` absent |
| T4 | Couche d'entrée : `input/actions.js`, `input/focus-nav.js` | `js/input/` | T3 | navigation clavier et manette sur une page de test |
| T5 | Accueil : `machine-grid.js`, `index.html`, `app.js`, `css` selon docs/ux.md | | T3, T4 | tuiles machines, état "0 jeu", focus visible |
| T6 | Grille de jeux : `game-grid.js`, `dialog.js`, jaquettes, focus de retour | | T5 | grille, jaquette ou visuel de repli, `focus` respecté |
| T7 | Lancement : `launcher.js`, `exit-guard.js`, `player-main.js`, `player.html`, `player.css` | `js/player/` | T0, T4, T6 | Amiga et Neo Geo jouables, sortie par les 4 moyens, retour avec focus |
| T8 | PWA : `manifest`, `sw.js`, icônes, enregistrement | | T5 | installable sur localhost, ne met jamais ROMs/BIOS en cache |
| T9 | Recette `testeur` : desktop (Chrome, Firefox, Safari), Android (Chrome), manette ; tests GitHub Pages (chemins relatifs, sans ROMs) | | T7, T8 | rapport de test, correctifs |

Revue du tech-lead avant toute tâche marquée terminée (en particulier : un seul endroit pour l'entrée clavier/manette, aucune liste de machines hors `systems.json`, chemins relatifs).

Ordre conseillé : T0 en premier (lève les [À VALIDER]), T1, puis T2 et T3 en parallèle, T4, T5 et T6, T7, T8, T9. T0 peut démarrer immédiatement avec T1.
