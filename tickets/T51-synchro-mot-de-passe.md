# T51 : synchro par mot de passe

**Branche** : `ticket/T51-synchro-mot-de-passe` - **Version** : 0.51.0
**Demandé par** : Hicham (2026-11-21) : « la synchro avec le téléphone ne fonctionne pas », « Mac introuvable, mais il faut simplifier la methode. Je veux un systeme qui me demande seulement le mot de passe. » Option A choisie sur carte : « mot de passe + https ».

## Diagnostic (Mac de Hicham, 2026-11-21)
- Partage activé pour la première fois le 21/11 à 22:53, aucun téléphone jamais associé (`clone90.sync.json` : `devices: []`) : l'échec était à la première connexion.
- Le téléphone affichait « Mac injoignable » dès que le navigateur refusait la connexion, sans pouvoir dire pourquoi. Cause la plus probable : certificat du Mac pas installé sur Android (étape manuelle facile à rater) ; autres causes possibles : pare-feu macOS, autorisation Chrome « appareils du réseau local ».

## Limite acceptée
Clone90 vient de GitHub Pages en HTTPS : Chrome ne parle au Mac qu'en HTTPS avec un certificat approuvé. Le certificat du Mac reste à installer **une fois** sur le téléphone. Tout le reste se réduit au mot de passe.

## Choix
- Mac : mot de passe choisi une fois (« Dossiers », « Partager avec le téléphone », « Choisir le mot de passe »), 6 à 128 caractères. Gardé en empreinte scrypt (sel aléatoire) dans `clone90.sync.json` (0600). 5 mauvais essais : plus aucun essai pendant 15 minutes (tous appareils). Le changer oublie les téléphones associés. Plusieurs téléphones peuvent utiliser le même mot de passe. Le code à 6 chiffres disparaît.
- Téléphone : un seul champ, le mot de passe. Le téléphone cherche le Mac : dernière adresse connue, nom `.local` du Mac, puis 192.168.1.x et 192.168.0.x (et le réseau de la dernière adresse), port 8443, `GET /sync/hello` sans aucune donnée. L'adresse se saisit encore, en secours seulement.
- Une fois associé, le téléphone garde un jeton (comme avant) : le mot de passe n'est plus demandé, sauf si le Mac l'a changé.
- Mac qui change d'adresse : à l'ouverture, le téléphone essaie seulement la dernière adresse et le nom `.local` (pas de balayage, le téléphone peut être loin de la maison) ; « Synchroniser maintenant » balaie le réseau. Une nouvelle adresse n'est gardée que si le Mac accepte le jeton.
- Certificat : guide « Première fois » en 5 étapes sur le téléphone et sur la page du Mac. Le Mac affiche « Un téléphone (adresse) a refusé le certificat de ce Mac » pendant 30 minutes quand un appareil refuse son certificat (alerte TLS « unknown ca » / « certificate unknown », envoyée par Chrome ; vérifié avec un vrai Chromium dans la recette).
- Le premier essai de la recherche attend 60 s : Chrome peut demander « autoriser l'accès aux appareils du réseau local ».

## Critères d'acceptation
1. T51 mot de passe choisi une fois sur le Mac, jamais gardé ni renvoyé en clair, 6 à 128 caractères.
2. T51 5 mauvais mots de passe -> blocage de 15 minutes, même avec le bon.
3. T51 changer le mot de passe oublie les téléphones associés.
4. T51 le téléphone ne demande que le mot de passe et trouve le Mac seul ; adresse facultative en secours.
5. T51 Mac changé d'adresse : retrouvé (nom .local à l'ouverture, balayage sur « Synchroniser maintenant »), jamais un autre Mac.
6. T51 message « Mac introuvable » qui renvoie au guide du certificat ; le Mac signale un téléphone qui refuse son certificat.
7. T51 aucune donnée envoyée pendant la recherche ; seulement des adresses privées ou .local.
8. Version 0.51.0.

## Tests
`tests/sync-discovery.test.mjs`, `tests/sync-server.test.mjs`, `tests/sync-plan.test.mjs`, `tests/sync-upload.test.mjs`. Recettes `tests/recette/synchro.mjs` (30/30) et `tests/recette/envoi-mac.mjs` (17/17).

## Vérification manuelle (Hicham)
1. Mac : mettre Clone90 à jour (automatique), « Dossiers » > « Partager avec le téléphone » > saisir un mot de passe > « Choisir le mot de passe ».
2. Android, une seule fois : ouvrir dans Chrome l'adresse affichée sur le Mac, suivre le guide (télécharger puis installer le certificat comme « Certificat CA »), rouvrir l'adresse : plus d'avertissement.
3. Android : Clone90 > « Mes fichiers » > « Synchroniser avec le Mac » > saisir seulement le mot de passe > « Associer ». Autoriser Chrome à accéder aux appareils du réseau local s'il le demande.
4. Si « Mac introuvable » : regarder le panneau du Mac ; s'il dit qu'un téléphone a refusé le certificat, refaire l'étape 2.
