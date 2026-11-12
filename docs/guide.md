# Guide Clone90 : jouer chez soi et publier sur GitHub Pages

Ce guide est écrit pour Hicham (Mac, navigateur Opera ou Chrome, et un téléphone Android). Chaque commande se tape dans le Terminal, dans le dossier de Clone90.

## 1. Lancer Clone90 sur votre Mac

### Ce qu'il faut avoir

- **Node.js 18 ou plus récent** (le serveur utilise des fonctions qui n'existent pas avant). Pour vérifier : `node -v` doit afficher `v18...` ou un nombre plus grand. Sinon, installez la version "LTS" depuis <https://nodejs.org>. Rien d'autre à installer : pas de `npm install`.
- Le dossier du projet. Premier téléchargement : `git clone https://github.com/HnaoAI/Clone90.git`, puis `cd Clone90`.

### Où mettre les jeux et les BIOS

- Les jeux (ROMs) vont dans `roms/<machine>/` (par exemple `roms/amiga/`, `roms/neogeo/`).
- Les BIOS vont dans `bios/`, avec le nom exact demandé.
- Le détail machine par machine (extensions, noms de BIOS) est dans le tableau du [README](../README.md#où-mettre-les-roms-et-les-bios). Créez les dossiers s'ils n'existent pas.
- Ces dossiers ne sont jamais envoyés sur GitHub : le fichier `.gitignore` les en empêche.

### Choisir le dossier de vos jeux

Vos ROMs (et vos BIOS) peuvent rester sur un autre disque ou dans un autre dossier que le projet. Une fois Clone90 ouvert avec **`Clone90.app`** (ou `Lancer Clone90.command`), cliquez sur le bouton **Dossiers des jeux** (sous les machines, sur l'accueil) : un panneau affiche les dossiers utilisés et propose **Choisir le dossier des ROMs**, **Choisir le dossier des BIOS**, **Utiliser les ROMs du projet** et **Utiliser les BIOS du projet** (retour aux dossiers `roms/` et `bios/` du projet). Une fenêtre du Mac s'ouvre pour choisir le dossier ; les jeux apparaissent aussitôt, sans redémarrer. Annuler la fenêtre ne change rien.

- Le bouton n'existe que sur le Mac, avec le lanceur (Clone90 n'écoute alors que sur ce Mac). Il n'apparaît ni sur GitHub Pages, ni depuis un téléphone, ni si vous lancez `node scripts/serve.mjs` sans `--host 127.0.0.1`.
- **Secours** : double-cliquez sur **`Choisir le dossier des jeux.command`** (à la racine du dossier). Même résultat, mais il faut ensuite relancer Clone90 (voir plus bas). La première fois, comme pour le lanceur : clic droit (ou `Ctrl` + clic) sur le fichier, **Ouvrir**, puis **Ouvrir**.
- Un dossier trop large (disque entier, dossier personnel, dossier système) est refusé avec un message : choisissez le dossier qui contient directement vos jeux.
- Le dossier choisi doit contenir **un sous-dossier par machine**, comme `roms/` : `amiga/`, `neogeo/`, `arcade/`... (identifiants de `systems.json`).
- Le choix est écrit dans `clone90.local.json` (fichier personnel, ignoré par git, jamais servi par le site). Exemple : `{ "romsDir": "/Volumes/Disque/ROMs", "biosDir": "/Volumes/Disque/BIOS" }`. Chaque clé est facultative ; sans elle, c'est `roms/` ou `bios/` du projet. Un chemin faux est signalé en français et Clone90 revient au dossier du projet.
- Pour revenir au dossier du projet : supprimez `clone90.local.json`. On peut aussi simplement garder `roms/` dans le projet.
- Après le choix, `Lancer Clone90.command` (ou `node scripts/generate-games.mjs`) affiche le dossier des jeux utilisé. Rien ne change dans le navigateur ni sur GitHub Pages.
- Avec le bouton « Dossiers des jeux », Clone90 prend le nouveau dossier tout de suite : pas besoin de le relancer. Avec le fichier de secours `Choisir le dossier des jeux.command`, si Clone90 est déjà ouvert, fermez sa fenêtre Terminal puis relancez Lancer Clone90.

### Pochettes des jeux (T28)

Les pochettes (jaquettes) s'affichent sur les tuiles de jeux. Deux façons de les avoir.

**1. Automatique (recommandé).** Dans Clone90 (ouvert avec `Clone90.app` ou `Lancer Clone90.command`), cliquez sur **Dossiers des jeux**, puis sur **Télécharger les pochettes**. Clone90 cherche, pour chaque jeu qui n'a pas encore d'image, la pochette dans la base libre [libretro-thumbnails](https://github.com/libretro-thumbnails) et la copie **dans le dossier de vos ROMs, à côté du jeu**. Une barre et un message de progression s'affichent, puis un résumé en quelques lignes : pochettes téléchargées, déjà présentes, introuvables, « plusieurs correspondances, ignorées » (les compteurs à zéro ne sont pas affichés). Vous pouvez fermer le panneau : le téléchargement continue, et un message prévient à la fin. L'accueil se met à jour tout seul. En ligne de commande : `node scripts/covers.mjs` (ou `node scripts/covers.mjs --dry-run` pour voir ce qui serait téléchargé sans rien écrire ; `--refresh` pour relire les listes de GitHub).

- Une pochette **déjà présente n'est jamais remplacée**. Une pochette qui ne vous plaît pas : déposez la vôtre à la main, ou supprimez le fichier image pour qu'une autre soit cherchée.
- **Région** : Europe d'abord, puis USA, puis World. Quand plusieurs images conviennent aussi bien (par exemple deux versions d'un même jeu d'arcade), Clone90 **ne choisit pas au hasard** : il ne télécharge rien et le dit (« plusieurs correspondances, ignorées »). Déposez alors l'image voulue à la main.
- Arcade et Neo Geo : le titre cherché est celui de `data/titles.json` (nom du romset vers titre). Un romset absent de ce fichier a pour titre son nom de fichier et sera probablement introuvable : ajoutez-le à `data/titles.json`.
- **Connexion à Internet** : Clone90 ne se connecte à github.com (api.github.com et raw.githubusercontent.com) que lorsque vous cliquez sur « Télécharger les pochettes » ou lancez `node scripts/covers.mjs`. Ce sont des **lectures** : GitHub voit votre adresse IP et les noms des jeux cherchés (les images demandées portent leurs titres) ; rien d'autre n'est envoyé (ni vos dossiers, ni vos fichiers). La liste des images de chaque machine est gardée une semaine dans `clone90.covers-cache.json` (fichier personnel, ignoré par git) pour ne pas dépasser la limite de requêtes de GitHub (60 par heure sans compte).
- Les images ne sont qu'un fichier PNG de 2 Mo au plus, vérifié avant d'être écrit. **Elles restent sur ce Mac et ne sont jamais publiées** (`roms/` est ignoré par git, et un dossier de ROMs choisi ailleurs n'est pas dans le projet). Ce sont des images de la base libre libretro-thumbnails, pour un **usage personnel** : leurs droits restent à leurs auteurs.
- Le bouton n'existe que sur le Mac avec le lanceur, comme « Dossiers des jeux » (ni GitHub Pages, ni téléphone).

**2. À la main.** Déposez une image `.png`, `.jpg`, `.jpeg` ou `.webp` **dans le même dossier que le jeu, avec exactement le même nom que le fichier du jeu, sans l'extension du jeu** :

| Jeu | Fichier du jeu | Image à déposer |
|---|---|---|
| Jeu simple | `roms/amiga/Gods.adf` | `roms/amiga/Gods.png` |
| Arcade, Neo Geo | `roms/neogeo/viewpoin.zip` | `roms/neogeo/viewpoin.png` |
| Amiga à plusieurs disquettes | `Monkey Island (Disk 1 of 2).adf`, `(Disk 2 of 2).adf` | `Monkey Island (Disk 1 of 2).png` (nom de la première disquette) ou `Monkey Island.png` (nom commun sans le numéro de disquette) |
| Jeu décrit par un `.m3u` | `Zaxxon.m3u` | `Zaxxon.png` |
| Mega-CD | `Sonic CD.cue` (et ses `.bin`) | `Sonic CD.png` |

La casse des lettres n'a pas d'importance (`gods.PNG` fonctionne). Si plusieurs formats existent pour un même nom, `png` passe avant `jpg`, `jpeg` puis `webp`. Après un ajout à la main, relancez `node scripts/generate-games.mjs` (ou rechargez la liste par un changement de dossier dans « Dossiers des jeux »). Le téléchargement automatique écrit toujours en `.png`.

### Logos des machines (T29)

Par défaut, l'accueil montre des logos faits maison. Vous pouvez les remplacer **sur votre Mac** par les vrais logos des machines : dans Clone90 (ouvert avec `Clone90.app` ou `Lancer Clone90.command`), cliquez sur **Dossiers des jeux**, puis sur **Télécharger les logos des machines**. Résumé à la fin (« Logos téléchargés : 12 ») et l'accueil se met à jour tout seul. En ligne de commande : `node scripts/machine-logos.mjs`.

- Source : le thème libre [es-theme-carbon](https://github.com/RetroPie/es-theme-carbon) de RetroPie (licence CC BY-NC-SA, usage non commercial), un logo SVG par machine, lu à une version figée du thème. Les logos sont des marques de leurs fabricants : **usage personnel** seulement.
- Ils sont copiés **dans le dossier de vos ROMs**, sous `clone90-logos/` (par exemple `clone90-logos/amiga.svg`), donc **jamais publiés** (`roms/` est ignoré par git). Un logo déjà présent n'est jamais remplacé.
- Chaque fichier est vérifié avant d'être écrit (image SVG de 256 Ko au plus, sans script ni lien externe), et le serveur local sert les SVG en interdisant tout script.
- **Connexion à Internet** : seulement au clic sur ce bouton (ou avec la commande), des lectures vers github.com (raw.githubusercontent.com). GitHub voit votre adresse IP ; **aucun nom de jeu** ni aucun fichier n'est envoyé.
- Si un logo manque ou ne s'affiche pas, Clone90 reprend le logo maison. Pour revenir aux logos maison : supprimez le dossier `clone90-logos` de votre dossier des ROMs, puis relancez Clone90.
- Le bouton n'existe que sur le Mac avec le lanceur (ni GitHub Pages, ni téléphone : ceux-ci gardent les logos maison).

### Démarrer

1. Après chaque ajout ou retrait de jeu, dans le Terminal :
   ```
   node scripts/generate-games.mjs
   ```
   Il écrit la liste des jeux (`games.json`) et affiche des avertissements utiles (BIOS manquant, extension inconnue...).
2. Puis :
   ```
   node scripts/serve.mjs
   ```
3. Ouvrez <http://localhost:8080> dans Opera ou Chrome. Laissez le Terminal ouvert pendant que vous jouez. Pour arrêter : `Ctrl + C`.

Le port 8080 est déjà pris ? Ajoutez `--port 9000` à la commande (et ouvrez `http://localhost:9000`).

### Lancer sans Terminal (Mac)

Double-cliquez sur **`Clone90.app`** (à la racine du dossier). Elle met à jour la liste des jeux, démarre Clone90 en arrière-plan et ouvre la page dans votre navigateur, **sans fenêtre Terminal**.

- **La première fois**, macOS bloque une application non signée par un développeur identifié : clic droit (ou `Ctrl` + clic) sur `Clone90.app`, **Ouvrir**, puis **Ouvrir** dans la fenêtre qui s'affiche. Ensuite le double-clic suffit.
- Si macOS dit que l'application est « endommagée » (fichier téléchargé, mis en quarantaine), vous pouvez, si vous le souhaitez, lancer dans le Terminal `xattr -dr com.apple.quarantine <le dossier de Clone90>` (glissez le dossier dans la fenêtre pour écrire son chemin), puis recommencer.
- Glissez `Clone90.app` dans le Dock pour la retrouver. Un clic sur son icône quand elle tourne rouvre la page.
- **Pour arrêter** : clic droit sur l'icône dans le Dock, **Quitter** (ou `Cmd` + `Q`). Seul le serveur lancé par l'application est arrêté.
- Il faut Node.js (<https://nodejs.org>) ; sinon l'application vous le dit. Si Clone90 ne démarre pas, le détail est dans `~/Library/Logs/Clone90.log`.
- L'application n'écoute que sur ce Mac (`--host 127.0.0.1`) : vos jeux ne sont pas visibles depuis le réseau. Pour jouer depuis le téléphone, lancez à la main `node scripts/serve.mjs` (sans `--host`), sur un réseau de confiance seulement (chez vous), jamais sur un Wi-Fi public.
- **Solution de secours** : `Lancer Clone90.command` (même principe, mais dans une fenêtre Terminal qu'il faut laisser ouverte ; la fermer arrête Clone90).
- Pour reconstruire l'application après une modification de `scripts/mac-app/Clone90.applescript` : `bash scripts/build-mac-app.sh`.
- Cela ne concerne que le Mac. Sous Windows et Linux, utilisez les commandes de la commandes ci-dessus.

### Jouer depuis votre téléphone Android

1. Le Mac et le téléphone doivent être sur **le même Wi-Fi**.
2. Au démarrage, le serveur affiche une ligne `Réseau local : http://192.168.x.x:8080`. Tapez cette adresse dans Chrome sur le téléphone.
3. **Limite** : sur le réseau local, l'adresse est en `http` (pas `https`). On peut jouer, mais Android ne propose pas d'installer Clone90 comme une application. C'est une règle du navigateur, pas un défaut du site.
4. Si la page ne s'ouvre pas : vérifiez que le serveur tourne encore, et que le pare-feu du Mac autorise Node (Réglages Système, Réseau, Coupe-feu).

### Mettre à jour Clone90

Dans le dossier du projet, serveur arrêté :

```
git pull
```

Puis relancez `node scripts/serve.mjs`. Vos jeux et BIOS ne sont pas touchés.

### En cas de problème

- **Quelle version tourne ?** Le numéro est en bas de l'accueil (par exemple "Clone90 v0.17.0 - 11/11/2026"). Après une mise à jour, si ce n'est pas le bon, l'ancienne version est restée en mémoire du navigateur.
- **Recharger sans mémoire** : `Cmd + Maj + R` sur l'accueil.
- **Mode diagnostic** : ajoutez `&debug=1` à la fin de l'adresse d'un jeu (celle de `player.html`). Une pastille "Diag" apparaît en haut à droite ; "Copier le journal" le copie pour me le coller. Rien n'est envoyé sur internet.
- **Le jeu est lent ou saccadé** : le mode économie d'énergie (Mac en batterie, ou téléphone) peut ralentir le jeu (sur un Mac à 11 % de batterie, on a constaté environ 30 images par seconde au lieu de 60). Branchez le chargeur et désactivez l'économie d'énergie, puis relancez le jeu.
- **Un jeu à plusieurs disquettes reste bloqué sur la demande de disquette** : vérifiez que toutes les disquettes viennent du même ensemble de fichiers ; voir le mode `&debug=1` ci-dessus.
- **"Aucun jeu trouvé"** : vous avez oublié `node scripts/generate-games.mjs` après avoir déposé les jeux, ou le serveur n'est pas lancé depuis le bon dossier.

## 2. Publier Clone90 sur GitHub Pages

GitHub Pages met le site en ligne gratuitement, à une adresse publique. **Cette étape n'est faite qu'avec votre accord**, et c'est vous qui cliquez dans GitHub (réglage du dépôt).

### Ce qui est publié, et ce qui ne le sera jamais

- Publié : les fichiers du dépôt (pages du site, scripts, logos, icônes, police). Le dépôt étant public, tout le monde peut aussi les lire, y compris `docs/` et `tickets/`.
- **Jamais publié : aucune ROM, aucun BIOS, pas de `games.json`.** Ces fichiers sont dans `.gitignore`, donc git ne les envoie pas. N'utilisez jamais `git add -f` sur `roms/` ou `bios/`.
- Les jeux sont protégés par le droit d'auteur : les mettre en ligne, même par erreur, vous exposerait à une réclamation. En cas de doute, ne poussez rien.

### Les étapes dans GitHub

1. Allez sur <https://github.com/HnaoAI/Clone90> et connectez-vous avec le compte propriétaire.
2. Onglet **Settings** (Réglages) du dépôt.
3. Menu de gauche : **Pages**.
4. Rubrique **Build and deployment**, "Source" : choisissez **Deploy from a branch**.
5. "Branch" : choisissez **main**, et le dossier **/ (root)**. Cliquez sur **Save**.
6. Attendez 1 à 3 minutes. Rechargez la page Settings, Pages : un bandeau "Your site is live at ..." apparaît.

L'adresse sera : **<https://hnaoai.github.io/Clone90/>** (avec le `/` final).

Le dépôt contient un fichier vide `.nojekyll`. Il dit à GitHub de publier les fichiers tels quels, sans passer par Jekyll (un outil qui ignore les fichiers commençant par `_` et transforme les fichiers texte). Ne le supprimez pas.

### Ce que vous verrez

- L'accueil s'affiche avec toutes les machines, et un message **"Aucun jeu disponible ici"** : normal, il n'y a aucun jeu en ligne. Les machines sont grisées.
- Le message explique la suite : ajoutez vos fichiers avec **Mes fichiers** (voir plus bas), ou lancez Clone90 chez vous (partie 1).
- À chaque mise à jour de `main`, le site se met à jour tout seul en quelques minutes.

### Installer comme application (PWA)

Depuis l'adresse Pages (en `https`), l'installation est possible :

- **Android (Chrome)** : ouvrez l'adresse, menu **⋮**, **Installer l'application** (ou **Ajouter à l'écran d'accueil**).
- **Mac (Chrome)** : icône d'installation à droite de la barre d'adresse, ou menu **⋮**, **Diffuser, enregistrer et partager**, **Installer Clone90**. Avec Opera, l'installation d'un site comme application n'est pas garantie : préférez Chrome pour cela.

L'application installée s'ouvre en plein écran et fonctionne même sans internet pour les écrans du site. Elle ne contient aucun jeu.

### Jouer sur le téléphone sans le Mac (T27)

Le site en ligne ne publie aucun jeu, mais il sait lire **vos** fichiers, gardés sur le téléphone :

1. Copiez vos jeux et vos BIOS sur le téléphone (câble USB, Google Drive, e-mail à vous-même...). Ils arrivent par exemple dans **Téléchargements**.
2. Ouvrez https://hnaoai.github.io/Clone90/ dans **Chrome**, puis touchez **Mes fichiers**.
3. **Ajouter des jeux** : touchez la machine (Amiga, Neo Geo...), puis choisissez vos fichiers (plusieurs à la fois si vous voulez). Pour un jeu Amiga sur plusieurs disquettes, choisissez toutes les disquettes ensemble : elles sont regroupées en un seul jeu, comme sur le Mac.
4. **Ajouter des BIOS** : touchez **Choisir des BIOS** et choisissez le fichier (Amiga : `kick40068.A1200` ; Neo Geo : `neogeo.zip`). La liste sous le bouton dit ce qui est présent ou manquant. Le nom doit être exact (les majuscules ne comptent pas).
5. Revenez aux machines : vos jeux apparaissent, touchez-en un, puis **Jouer**.

Bon à savoir :
- Les fichiers sont **copiés dans Chrome, sur ce téléphone seulement**. Rien n'est envoyé sur internet, rien n'est publié. Vous pouvez effacer l'original des Téléchargements.
- Internet reste nécessaire pour charger le moteur d'émulation (EmulatorJS), au moins au premier lancement de chaque machine.
- Effacer les données du site dans Chrome efface aussi vos jeux. **Mes fichiers** permet de supprimer un fichier.
- Si le jeu affiche « Rechargez la page pour jouer », rechargez une fois (le site doit d'abord s'installer dans le navigateur).
- Sur le Mac, rien ne change : vous pouvez continuer avec `roms/`, `bios/` et le lanceur (partie 1). « Mes fichiers » marche aussi sur un ordinateur, dans Chrome.
