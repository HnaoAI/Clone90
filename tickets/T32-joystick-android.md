# T32 : Joystick tactile qui part parfois dans le mauvais sens (Android)

**Branche** : `ticket/T32-joystick-android` - **Version** : 0.32.0
**Demandé par** : Hicham (2026-11-13) : « est-ce que tu peux tester le joystick sur android, j'ai l'impression qu'il y a des ratés sur les commandes. Quand je vais à droite, le jeu va à gauche. » Puis : « c'est de temps en temps. »

## Constat (Chromium, profil Pixel 7 portrait et paysage, vrai EmulatorJS 4.2.3 avec emulator.min.js du CDN, vrais évènements tactiles)
- La PR #38 (T31, couleur et boutons en paysage) n'est pas en cause : la position du joystick et le centre calculé par nipplejs sont justes.
- Le défaut est dans EmulatorJS (même code en 4.2.1, version de l'Amiga, et 4.2.3), traitement « move » de la zone joystick du schéma par défaut (Amiga, arcade, Neo Geo...) :
  1. **Aucune zone morte** : le doigt se pose rarement pile au centre. Posé 1 px à gauche, EmulatorJS envoie « gauche », puis « gauche + droite » en glissant vers la droite, avant « droite ». Le jeu part donc à gauche un instant, de temps en temps (selon où tombe le doigt). Mesuré : `gauche > gauche+droite > droite`.
  2. **Relâchements envoyés 30 ms en retard** (setTimeout) : une direction quittée puis reprise dans ces 30 ms est relâchée alors que le doigt la tient (raté), et deux directions opposées restent appuyées ensemble pendant 30 ms.
  3. Un doigt immobile au centre qui tremble de 2 ou 3 px faisait défiler toutes les directions.

## Réalisation
- `js/player/virtual-stick.js` (pur) : directions depuis l'angle et la distance de nipplejs. Zone morte (appui au-delà de 12 px, relâche sous 8 px, rayon 50 px), 4 directions et 4 diagonales de 45°, hystérésis de 8° aux bords quand le joystick est tenu, jamais deux directions opposées.
- `js/player/launcher.js` : `nipplejs.create` est enveloppé dès que nipplejs se pose sur `window` (avant le constructeur d'EmulatorJS) ; le « move » d'EmulatorJS n'est jamais branché, le nôtre envoie au cœur seulement les changements, immédiatement. La fin du toucher (tout relâcher) et l'affichage du disque restent ceux d'EmulatorJS et de nipplejs. Schéma N64 exclu (zone analogique, aucune machine de Clone90).
- `sw.js` : nouveau module dans la coquille. `js/version.js` : 0.32.0.

## Critères d'acceptation
1. Doigt posé un peu à gauche du centre puis glissé à droite : le cœur ne reçoit jamais « gauche ».
2. Gauche puis droite d'un coup : droite reste appuyée, jamais gauche et droite ensemble.
3. Doigt immobile au centre (tremblement de quelques px) : aucune direction.
4. Les 8 directions marchent ; le disque suit toujours le doigt ; tout est relâché quand on lève le doigt.

## Tests
- `tests/virtual-stick.test.mjs` (directions, zone morte, hystérésis, enveloppe de nipplejs) et `tests/launcher.test.mjs` (nipplejs posé par EmulatorJS est enveloppé, sauf N64).
- `tests/recette/joystick-tactile.mjs` : 40 vérifications (Pixel 7 portrait et paysage). Avant : 14 échecs (`gauche > gauche+droite > droite`). Après : 40 passent. `manette-tactile.mjs` et `mobile-menu.mjs` : 48 passent toujours.

## Limites
- Essayé en émulation Android (Chromium), pas sur un vrai téléphone. La recette 4.2.1 n'a pas pu tourner (cœur NES 4.2.3 seulement en local) ; le code d'EmulatorJS concerné est identique (vérifié par diff).
- Seuils (12 px / 8 px) choisis à l'estime : à ajuster si le joystick paraît trop « dur » au démarrage.

## Vérification manuelle (Hicham)
Sur le téléphone, jeu Amiga ou Neo Geo, portrait puis paysage : poser le pouce sur le joystick et aller franchement à droite, plusieurs fois, en partant de différents endroits du disque. Le personnage ne doit plus jamais partir à gauche ; aller-retour gauche-droite rapide sans raté.
