# T44 : envoyer les jeux du téléphone vers le Mac

**Branche** : `ticket/T44-envoi-vers-mac` - **Version** : 0.44.0
**Demandé par** : Hicham (2026-11-15) : « Comment ça se passe pour l'inverse ? Si j'ai des jeux dans le téléphone qui ne sont pas sur le Mac ? » Plan présenté, réponse : « Je valide tout sauf le bios ».

## Constat de départ
La synchronisation T43 va seulement du Mac vers le téléphone. Un jeu ajouté directement sur le téléphone (« Mes fichiers », dossier, page web) n'est jamais touché, mais il ne va pas non plus sur le Mac.

## Choix validés par Hicham
1. Envoi direct par le Wi-Fi, au serveur de partage du Mac déjà en place (même appairage, même certificat).
2. Bouton à part « Envoyer mes jeux au Mac » (pas d'envoi automatique à l'ouverture).
3. Un jeu envoyé devient « géré par le Mac » : supprimé ensuite sur le Mac, il est retiré du téléphone.
4. Jeux seulement : ni BIOS, ni pochettes (le Mac cherche les siennes), ni logos.

## Réalisation
- **Téléphone** (`js/sync-client.js` `sendGamesToMac`, `js/ui/sync-section.js`, `js/app.js`) : « Mes fichiers », rubrique « Synchroniser avec le Mac », bouton « Envoyer mes jeux au Mac ». Lit la liste du Mac, envoie un par un, du plus petit au plus gros, les jeux mis par la personne et absents du Mac. Avancement dans l'écran, message de fin.
- **Règles communes** (`js/sync-plan.js`, pur) : `uploadTargetPath` (seulement `roms/<machine de systems.json>/<fichier>`, pas d'image, de fichier caché, de `..`), `planUpload` (doublons : même chemin sur le Mac = non envoyé et signalé ; jeux venus du Mac jamais renvoyés ; plus de 1 Go signalé), `describeUploadResult`.
- **Mac, réception** (`scripts/sync-upload.mjs`, route `POST /sync/upload?path=` de `scripts/sync-server.mjs`) : jeton d'un téléphone associé ; case « Accepter les jeux du téléphone » cochée ; taille annoncée obligatoire, 1 Go au plus ; place libre (500 Mo gardés) ; dossier de la machine vérifié par son chemin réel ; fichier temporaire caché puis lien physique (échoue si le nom existe : jamais d'écrasement) ; envoi incomplet effacé ; un seul envoi à la fois ; `games.json` refait après chaque jeu reçu. La liste du Mac dit si la réception est permise (`uploads`).
- **Mac, réglage** (`scripts/sync-pairing.mjs`, `scripts/sync-api.mjs`, `js/ui/sync-panel.js`) : `acceptUploads` dans `clone90.sync.json`, éteint par défaut ; `POST api/sync/uploads-on|uploads-off` (mêmes contrôles que l'API du Mac) ; bouton « Accepter les jeux du téléphone » / « Ne plus accepter les jeux du téléphone » dans « Partager avec le téléphone ».
- Délai de requête du serveur de partage porté à 1 heure (un jeu de 1 Go par le Wi-Fi dépasse les 5 minutes par défaut de Node).

## Critères d'acceptation
1. Rien n'est reçu par le Mac tant que « Accepter les jeux du téléphone » n'est pas coché (éteint par défaut).
2. Sans jeton valide, l'envoi est refusé.
3. Le Mac ne reçoit que des jeux de machines connues, rangés dans `<dossier des jeux>/<machine>/` ; jamais de BIOS, logo, pochette, fichier caché, `..`, ni dossier qui sort du dossier des jeux.
4. Un fichier du Mac n'est jamais remplacé.
5. Taille limitée à 1 Go, place libre vérifiée ; un envoi coupé ne laisse aucun fichier.
6. Le téléphone n'envoie que ses propres jeux absents du Mac ; un même nom sur le Mac est signalé, pas envoyé.
7. Un jeu envoyé devient géré par le Mac : supprimé sur le Mac, il est retiré du téléphone.
8. Le jeu reçu apparaît dans Clone90 sur le Mac (liste des jeux refaite).
9. Envoi seulement au clic, seulement au Mac associé.

## Tests
`tests/sync-upload.test.mjs` (18, vrai serveur HTTPS). Recette `tests/recette/envoi-mac.mjs` (Chromium, Mac + Pixel 7).
Deux tests T43 suivent le changement d'interface (sans rien affaiblir) : l'état lu contient `acceptUploads: false`, et le panneau du Mac a un bouton de plus.

## Limites
- Non essayé sur un vrai Android (même réserve que T43).
- Un jeu de plusieurs fichiers (disquettes, .cue + .bin) est envoyé fichier par fichier ; si un nom existe déjà sur le Mac, seul ce fichier est sauté.
- Fermer l'onglet pendant l'envoi arrête l'envoi ; les jeux déjà envoyés restent sur le Mac, le suivant reprendra au prochain clic.

## Vérification manuelle (Hicham)
1. Mac : mettre Clone90 à jour, « Dossiers », « Partager avec le téléphone », « Accepter les jeux du téléphone ».
2. Téléphone : « Mes fichiers », ajouter un jeu absent du Mac, puis « Envoyer mes jeux au Mac » : message « 1 jeu envoyé au Mac ».
3. Mac : le jeu apparaît dans la machine (recharger la page si besoin).
4. Mac : supprimer ce jeu, rouvrir Clone90 sur le téléphone : il disparaît aussi du téléphone.
5. Mac : « Ne plus accepter les jeux du téléphone », puis « Envoyer mes jeux au Mac » sur le téléphone : message qui dit quoi cocher.
