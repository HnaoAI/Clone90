# T43 : synchronisation Mac -> téléphone par le Wi-Fi

**Branche** : `ticket/T43-synchro-wifi` - **Version** : 0.43.0
**Demandé par** : Hicham (2026-11-15) : « Est-ce que les pochettes et les jeux peuvent se transférer du Mac au téléphone et avoir tout le temps les mêmes jeux et pochettes ? » Plan présenté (3 options), choix : « Option 1 » (synchronisation automatique par le Wi-Fi, tout copier, téléphone Android).

## Constat de départ
Les jeux du Mac restent sur le disque du Mac. Le téléphone (Clone90 en HTTPS sur GitHub Pages) garde ses propres jeux dans son navigateur (« Mes fichiers ») et télécharge lui-même pochettes et logos. Rien n'est copié d'un appareil à l'autre. Un navigateur refuse qu'une page HTTPS lise une adresse `http://` : le Mac doit répondre en HTTPS.

## Réalisation
- **Mac, serveur de partage** (`scripts/sync-server.mjs`) : HTTPS sur le port 8443, toutes les interfaces, LECTURE SEULE. Routes : page d'aide, certificat de l'autorité, `POST /sync/pair` (code -> jeton), `GET /sync/manifest`, `GET /sync/file?path=`. Liste et fichiers exigent le jeton d'un téléphone associé. Seuls les fichiers des dossiers des jeux et des BIOS sont servis (`syncTargetPath` : machines de systems.json, un niveau de sous-dossier, logos, BIOS ; jamais de fichier caché, de `..` ni de lien qui sort du dossier). Aucune écriture, aucune route `api/`.
- **Mac, certificats** (`scripts/sync-cert.mjs`) : petite autorité « Clone90 - partage local » propre au Mac, fabriquée avec la commande `openssl` du Mac (aucune dépendance), LIMITÉE (nameConstraints) aux adresses privées, à localhost et aux noms `.local` ; clés en 0600 dans `.clone90-sync/` (caché, ignoré par git). Certificat du serveur refait quand l'adresse du Mac change, sans rien réinstaller sur le téléphone.
- **Mac, appairage** (`scripts/sync-pairing.mjs`) : code à 6 chiffres affiché sur demande, 5 minutes, 5 essais, un seul téléphone par code ; jeton de 256 bits, seule son empreinte SHA-256 est gardée (`clone90.sync.json`, ignoré par git) ; « Oublier les téléphones associés ».
- **Mac, commande** (`scripts/sync-api.mjs`, branchée par `serve.mjs`) : `api/sync` (état, activer, arrêter, code, oublier), mêmes contrôles que l'API des dossiers (Host localhost, Origin, X-Clone90). Rien n'est ouvert au réseau avant « Activer le partage » ; le partage est repris aux lancements suivants jusqu'à « Arrêter le partage ». Port libéré avant la relance d'une mise à jour (T35).
- **Mac, écran** (`js/ui/sync-panel.js`) : « Dossiers », « Partager avec le téléphone » : texte sur ce qui est ouvert, adresse, code en gros chiffres, étapes du certificat, nombre de téléphones.
- **Téléphone** (`js/sync-client.js`, `js/ui/sync-section.js`) : « Mes fichiers », rubrique « Synchroniser avec le Mac » (adresse + code, puis « Synchroniser maintenant », « Oublier ce Mac »). Synchronisation sans clic à chaque ouverture de Clone90 (après la vérification des mises à jour), message seulement si quelque chose a changé. Fichiers rangés dans la bibliothèque du navigateur au même chemin que sur le Mac (servis par `sw.js` comme « Mes fichiers »).
- **Règles communes** (`js/sync-plan.js`, pur) : fichiers partagés, adresse du Mac (IPv4 privée ou `.local`, HTTPS seulement), plan de copie, message.

## Choix (non tranchés par Hicham, pris par défaut)
- **Suppression** : un fichier venu du Mac puis supprimé sur le Mac est retiré du téléphone. Un fichier mis par la personne sur le téléphone n'est JAMAIS remplacé ni effacé.
- **Tout copier** : jeux, pochettes, logos et BIOS. Copie dans l'ordre logos, pochettes, BIOS puis jeux du plus petit au plus gros ; un fichier qui ne tient plus est sauté et signalé.
- Un fichier supprimé à la main sur le téléphone revient à la synchronisation suivante tant qu'il est sur le Mac.

## Critères d'acceptation
1. Rien n'est ouvert au réseau avant « Activer le partage » ; « Arrêter le partage » ferme le port.
2. Sans jeton valide, la liste et les fichiers sont refusés ; un code faux, expiré ou trop essayé ne donne rien.
3. Le serveur de partage ne sert que les jeux, pochettes, logos et BIOS, en lecture seule ; jamais hors de ces dossiers.
4. Après association, le téléphone a les mêmes jeux, pochettes et logos que le Mac, jouables sans le Mac.
5. À chaque ouverture, le téléphone copie les nouveautés et retire ce que le Mac n'a plus ; Mac éteint : aucun message, jeux gardés.
6. Un fichier mis par la personne sur le téléphone n'est jamais remplacé ni effacé.
7. Le téléphone ne parle qu'à son site et au Mac associé.

## Tests
`tests/sync-plan.test.mjs` (26) et `tests/sync-server.test.mjs` (16, vrai openssl et vrai serveur HTTPS vérifié par l'autorité). Recette `tests/recette/synchro.mjs` (19/19, Chromium, Mac + Pixel 7).

## Limites
- Non essayé sur un vrai Android : installation du certificat, confiance de Chrome dans une autorité ajoutée par la personne, autorisation « appareils du réseau local » que Chrome peut demander la première fois.
- La recette relaie l'adresse 192.168.50.10 vers 127.0.0.1 (le conteneur n'a pas d'adresse privée) et ne voit donc pas la requête préalable CORS ; celle-ci est vérifiée par les tests unitaires.
- Si l'adresse du Mac change (box redémarrée), il faut la ressaisir sur le téléphone (associer de nouveau). Une adresse fixe pour le Mac dans la box évite cela.
- Copie pendant que Clone90 est ouvert sur le téléphone ; fermer l'onglet arrête la copie (reprise à l'ouverture suivante).

## Vérification manuelle (Hicham)
1. Mac : mettre Clone90 à jour, l'ouvrir, « Dossiers », « Partager avec le téléphone », « Activer le partage ». Le Mac peut demander d'autoriser Node à accepter les connexions entrantes : accepter.
2. Téléphone (même Wi-Fi), Chrome : ouvrir l'adresse affichée, accepter l'avertissement, « Télécharger le certificat », l'installer (Paramètres, Sécurité, « Certificat CA »).
3. Mac : « Associer un téléphone ». Téléphone : Clone90, « Mes fichiers », « Synchroniser avec le Mac », adresse et code, « Associer » : les jeux arrivent.
4. Ajouter un jeu sur le Mac, rouvrir Clone90 sur le téléphone : il arrive tout seul.
