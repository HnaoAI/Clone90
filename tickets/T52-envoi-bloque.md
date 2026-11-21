# T52 : envoi vers le Mac « bloqué » sur un jeu

**Branche** : `ticket/T52-envoi-bloque` - **Version** : 0.52.0
**Demandé par** : Hicham (2026-11-21) : « le partage pour envoyer les jeux sur le mac c'est bloqué sur un jeu », « c'est le jeu bstars.zip sur neo geo ». Plan validé (« continue »). Ajout validé : « oui je le veux » (bouton pour afficher le mot de passe).

## Diagnostic (Mac de Hicham, 2026-11-21, 22:30-22:39 UTC, dossier roms/neogeo observé en direct)
- L'envoi n'était pas cassé : il avançait par à-coups. 22:30:34-22:30:50 : 15 jeux reçus ; puis RIEN pendant 7 minutes, bstars.zip étant le suivant ; 22:37:40 : reprise, bstars.zip reçu complet (3 331 946 octets), puis les suivants.
- Cause probable : Chrome Android met l'envoi en pause quand Clone90 passe en arrière-plan (Hicham est allé dans une autre appli pour signaler le problème) ou que l'écran s'éteint. Rien à l'écran ne montrait l'avancement d'un fichier : « Envoi au Mac : 16 sur N (bstars.zip) » restait figé.
- Défauts trouvés : `scripts/sync-server.mjs` gardait le verrou « un seul envoi à la fois » jusqu'au `requestTimeout` d'une heure si le téléphone disparaissait en plein envoi (envois suivants refusés « occupé ») ; aucun délai côté téléphone ; le BIOS déclaré `neogeo.zip`, rangé avec les jeux sur le téléphone, est parti comme un jeu dans `roms/neogeo/` (laissé sur le Mac, jamais effacé).

## Choix
- Téléphone : envoi par XMLHttpRequest (seul moyen de suivre les octets envoyés) ; texte « Envoi au Mac : 15 sur 80 (bstars.zip, 1,2 Mo sur 3,2 Mo)… Gardez Clone90 ouvert et l'écran allumé jusqu'à la fin. »
- Écran gardé allumé pendant l'envoi (Wake Lock), redemandé au retour sur Clone90 ; sans Wake Lock, rien.
- 60 s sans aucune progression, page visible : fichier abandonné (le Mac efface son fichier temporaire), un nouvel essai, puis compté « interrompu » et jeu suivant. Jamais d'abandon tant que Clone90 est caché.
- Mac occupé (429) : attente de 5 s puis nouvel essai, 14 fois au plus, puis jeu suivant.
- Mac : envoi abandonné après 60 s sans donnée : fichier temporaire effacé, verrou libéré.
- BIOS déclaré dans systems.json et rangé avec les jeux de sa machine : ni envoyé, ni accepté par le Mac (message clair).
- Bouton « œil » (Afficher / Masquer le mot de passe), masqué par défaut, sur le téléphone (« Associer ») et sur le Mac (« Partager avec le téléphone »).

## Critères d'acceptation
1. T52 progression par fichier en Mo, avec la consigne de garder Clone90 ouvert.
2. T52 un jeu qui n'avance plus est abandonné, réessayé une fois, puis l'envoi passe au jeu suivant ; message de fin clair.
3. T52 pas d'abandon tant que Clone90 est en arrière-plan.
4. T52 Mac : envoi sans donnée abandonné après le délai, rien de gardé à moitié, verrou libéré.
5. T52 BIOS déclaré jamais envoyé ni accepté comme un jeu.
6. T52 jeu déjà sur le Mac : signalé, jamais remplacé, l'envoi continue.
7. T52 bouton « œil » sur le téléphone et sur le Mac, masqué par défaut.
8. Version 0.52.0.

## Tests
`tests/envoi-bloque.test.mjs`, `tests/password-toggle.test.mjs` ; existants `tests/sync-upload.test.mjs`, `tests/sync-server.test.mjs`, `tests/sync-plan.test.mjs`.

## Vérification manuelle (Hicham)
1. Mac : Clone90 à jour (automatique), partage actif, « Accepter les jeux du téléphone » coché.
2. Android : « Mes fichiers » > « Envoyer mes jeux au Mac » : le nom du jeu et les Mo avancent ; l'écran ne s'éteint pas.
3. Pendant l'envoi, passer dans une autre appli 1 à 2 minutes puis revenir : l'envoi reprend (pas d'abandon pendant l'absence).
4. Fin : message avec le nombre de jeux envoyés, et ceux « déjà sur le Mac » ou « interrompus » ; relancer l'envoi reprend les interrompus.
5. Œil : sur le téléphone (champ « Mot de passe du Mac ») et sur le Mac (« Partager avec le téléphone ») : touché, le mot de passe s'affiche ; touché de nouveau, il se masque.
