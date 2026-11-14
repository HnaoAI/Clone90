# T39 : supprimer le fichier d'un jeu depuis son menu

**Branche** : `ticket/T39-supprimer-rom` - **Version** : 0.39.0
**Demandé par** : Hicham (2026-11-14) : « ajouter la possibilité de supprimer le fichier rom à partir du menu des jeux » ; précisions :
« Efface le fichier quel que soit le type de machine. Il y a une confirmation qui prévient de la suppression définitive », « Aussi sur mac ou pc ».

## Réalisation
- Écran Jouer (le menu d'un jeu, avant de lancer) : petit bouton **Supprimer le fichier**, sous Jouer, navigable (souris, tactile, clavier, manette).
- Confirmation obligatoire : « Supprimer <titre> ? », texte qui dit que c'est **définitif** (et, sur le disque, que le fichier ne passe pas par la corbeille), nombre de fichiers s'il y en a plusieurs ; focus sur **Annuler** ; Annuler, Échap, retour ou clic hors de la boîte = rien n'est supprimé.
- Fichiers effacés (`gameFilePaths`, `js/local-game-delete.js`) : le fichier du jeu, ses disquettes, les pistes d'un .cue, les disques d'un .m3u, sa jaquette. Jamais bios/, jamais un autre dossier que celui de la machine du jeu.
- Toutes les machines (systems.json, aucune liste).
- Jeu importé dans « Mes fichiers » (téléphone, navigateur) : retiré de la bibliothèque du navigateur.
- Jeu du disque (Mac ou PC) : le serveur local l'efface du dossier des jeux (roms/ du projet ou dossier choisi), puis régénère games.json. API `GET /api/games`, `POST /api/games/delete` (`scripts/game-delete.mjs`) :
  - le navigateur n'envoie que l'id du jeu, jamais de chemin ; les fichiers viennent de games.json ;
  - seulement des fichiers (jamais un dossier), dont le chemin réel est dans le dossier d'une machine sous le dossier des jeux (un lien qui sort est refusé) ;
  - mêmes contrôles que le reste de l'API (Host, Origin, X-Clone90, JSON, 1 Ko), même verrou (jamais pendant un téléchargement) ;
  - seulement si le serveur n'écoute que sur cet ordinateur (lanceur du Mac ; sur PC `node scripts/serve.mjs --host 127.0.0.1`). Serveur ouvert au réseau local : pas de bouton pour les jeux du disque (un autre appareil du Wi-Fi ne peut rien effacer).
- Après la suppression : retour à la grille de la machine, le jeu n'y est plus.
- Correctif trouvé à la recette : dans les boîtes, la place du curseur ▶ est toujours réservée (`css/base.css`) ; sur téléphone, la rangée Annuler/Supprimer se recomposait sous le doigt et le toucher sur Supprimer était perdu.

## Critères d'acceptation
1. Bouton « Supprimer le fichier » sur l'écran Jouer d'un jeu importé, et d'un jeu du disque quand le serveur est limité à cet ordinateur.
2. Confirmation avec le nom du jeu, qui prévient que la suppression est définitive.
3. Refus = aucune suppression (Annuler, Échap).
4. Confirmé = tous les fichiers du jeu effacés (disquettes, pistes, jaquette), rien d'autre (autres jeux, BIOS, dossier de la machine).
5. Jeu du disque : seulement des fichiers du dossier des jeux, jamais un dossier, jamais un chemin envoyé par le navigateur.
6. Retour à la grille, sans le jeu.

## Tests
`tests/local-game-delete.test.mjs` (12), `tests/game-delete.test.mjs` (11), `tests/player-ui.test.mjs` (+2). Recette `tests/recette/supprimer-jeu.mjs` (Chromium : ordinateur, Pixel 7 debout et couché, serveur « Mac ou PC ») : 39/39.

## Limites
- Non essayé sur un vrai Mac, un vrai PC ni un vrai téléphone. Sous Windows, chemin réel et effacement passent par Node (non essayé).
- Un jeu du disque n'a pas de bouton si le serveur est ouvert au réseau local (`node scripts/serve.mjs` sans `--host 127.0.0.1`).
- Sur le disque, le fichier est effacé directement (pas de corbeille) : c'est dit dans la confirmation.

## Vérification manuelle (Hicham)
Sur le Mac (application Clone90) : ouvre un jeu dont tu as une copie, Supprimer le fichier, lis la confirmation, Annuler (le jeu reste), puis Supprimer : retour à la liste sans le jeu, fichier absent du dossier roms. Sur le téléphone : même chose avec un jeu de « Mes fichiers ».
