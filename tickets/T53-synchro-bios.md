# T53 : synchroniser les BIOS et créer les dossiers des machines

Demande de Hicham (2026-11-22) : « pour la synchro il faut créer les dossier rom et synchroniser aussi les bios », puis « inclus les » (BIOS dans les deux sens). Remplace « tout sauf le BIOS » de T44.

## Critères d'acceptation

1. Au démarrage de Clone90 sur le Mac (et après un changement de dossier), chaque machine de systems.json a son dossier `roms/<id>` (minuscules, sans espace) ; les dossiers manquants sont créés vides, rien n'est déplacé, renommé ni supprimé ; un dossier d'une autre casse (`Amiga`) compte ; le dossier des BIOS est créé s'il manque.
2. Mac -> téléphone : les BIOS du Mac arrivent dans `bios/` du téléphone sous leur nom déclaré (même écrits avec une autre casse, ou rangés avec les jeux comme `roms/neogeo/neogeo.zip`) ; les samples `bios/samples/` aussi.
3. Téléphone -> Mac : « Envoyer mes jeux au Mac » envoie aussi les BIOS (après les jeux, avant les pochettes), dans le dossier des BIOS du Mac ; jamais d'écrasement (même à la casse près), 1 Go, délai de 60 s (T52), case « Accepter les jeux du téléphone » obligatoire. Un BIOS rangé avec les jeux n'est pas envoyé comme un jeu (T52).
4. Un BIOS mis par la personne sur le téléphone n'est jamais remplacé ni effacé. Les logos ne sont jamais envoyés au Mac.

## Vérification manuelle

- Mac : relancer Clone90 ; le dossier des jeux contient un dossier par machine (`pcengine`, `gba`…).
- Android : « Synchroniser maintenant » ; « Mes fichiers » montre `syscard3.pce` présent ; lancer Ys (PC Engine CD) sur le téléphone.
- Android : mettre un BIOS sur le téléphone, « Envoyer mes jeux au Mac » ; il arrive dans le dossier bios du Mac.
