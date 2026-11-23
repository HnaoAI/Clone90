# T56 : titre sans logo, dossier créé dès qu'une machine est ajoutée

**Branche** : `ticket/56-logo-titre-dossiers` - **Version** : 0.56.0
**Demandé par** : Hicham (2026-11-23) : « Enlève le logo près du nom "clone 90" en haut et quand j'ajoute une machine il faut que le dossier où mettre les roms soit créé automatiquement dans le dossier roms. », puis « et sur le téléphone aussi ». Plan validé le 2026-11-23 (« Oui, lance »).

Aujourd'hui (T53), le Mac crée les dossiers `roms/<machine>` manquants au démarrage de Clone90 et après une mise à jour automatique (relance). Une machine ajoutée pendant que Clone90 tourne (mise à jour faite à la main, bundle, `git pull`) n'a son dossier qu'au prochain démarrage.

**Lecture retenue de « sur le téléphone aussi »** : le navigateur du téléphone ne peut pas créer de dossier sur le téléphone (Android ne le permet pas aux sites, `webkitdirectory` est en lecture seule). Côté téléphone, une machine ajoutée apparaît déjà dans Clone90 sans rien faire. Ce qui change : quand le téléphone se synchronise avec le Mac (liste des fichiers) ou lui envoie des jeux, le Mac revérifie et crée les dossiers des machines qui manquent.

## Critères d'acceptation
1. Le petit logo vert et blanc à gauche du titre « Clone90 » est retiré de l'en-tête, sur téléphone et ordinateur (même en-tête). Le titre (« 90 » en vert) et la version restent.
2. Sur le Mac, quand `systems.json` change pendant que Clone90 tourne (nouvelle machine), le dossier `roms/<id>` de la nouvelle machine est créé sans relancer Clone90, en quelques secondes. Plusieurs écritures rapprochées ne lancent qu'une vérification.
3. Le Mac revérifie aussi les dossiers juste avant chaque nouvelle liste des jeux (games.json régénéré : jeux ajoutés par une page web, envoyés par le téléphone, supprimés, changement de dossier).
4. Téléphone : quand le téléphone demande la liste des fichiers du Mac (synchronisation), le Mac revérifie d'abord les dossiers ; une erreur de cette vérification n'empêche jamais la synchronisation.
5. Mêmes garanties que T53 : on crée seulement des dossiers vides, nom = id de systems.json, rien n'est déplacé, renommé ni supprimé, un dossier d'une autre casse (`Amiga`) compte. Un `systems.json` illisible pendant son écriture ne casse rien (avertissement, nouvel essai au changement suivant).

## Vérification manuelle (Hicham)
1. Sur le Mac et sur le téléphone : en haut, il ne reste que « Clone90 » et la version, sans logo à gauche.
2. Sur le Mac, quand une nouvelle machine arrivera dans Clone90 (mise à jour), son dossier apparaîtra dans le dossier roms sans relancer Clone90.
