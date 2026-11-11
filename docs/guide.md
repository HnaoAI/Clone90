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

Double-cliquez sur **`Lancer Clone90.command`** (à la racine du dossier). Il met à jour la liste des jeux, démarre Clone90 et ouvre la page dans votre navigateur. Pour arrêter, fermez la fenêtre (ou `Ctrl + C`).

- **La première fois**, macOS peut bloquer un script téléchargé : clic droit (ou `Ctrl` + clic) sur le fichier, **Ouvrir**, puis **Ouvrir** dans la fenêtre qui s'affiche. Ensuite le double-clic suffit.
- Vous pouvez glisser le fichier dans le Dock, ou en faire un alias sur le Bureau.
- Il faut Node.js (<https://nodejs.org>) ; sinon le lanceur vous le dit.
- Le lanceur n'écoute que sur ce Mac (`--host 127.0.0.1`) : vos jeux ne sont pas visibles depuis le réseau. Pour jouer depuis le téléphone, lancez à la main `node scripts/serve.mjs` (sans `--host`), sur un réseau de confiance.
- Cela ne concerne que le Mac. Sous Windows et Linux, utilisez les commandes ci-dessus.

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
- Le message explique la suite : pour jouer, il faut lancer Clone90 chez vous (partie 1).
- À chaque mise à jour de `main`, le site se met à jour tout seul en quelques minutes.

### Installer comme application (PWA)

Depuis l'adresse Pages (en `https`), l'installation est possible :

- **Android (Chrome)** : ouvrez l'adresse, menu **⋮**, **Installer l'application** (ou **Ajouter à l'écran d'accueil**).
- **Mac (Chrome)** : icône d'installation à droite de la barre d'adresse, ou menu **⋮**, **Diffuser, enregistrer et partager**, **Installer Clone90**. Avec Opera, l'installation d'un site comme application n'est pas garantie : préférez Chrome pour cela.

L'application installée s'ouvre en plein écran et fonctionne même sans internet pour les écrans du site. Elle ne contient aucun jeu.

### Jouer quand même avec des jeux

Le site en ligne ne peut pas servir vos jeux. Pour jouer, lancez Clone90 en local (partie 1) : c'est le même site, mais avec vos `roms/`, `bios/` et `games.json`.
