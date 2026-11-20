# T46 : jouer hors ligne

**Branche** : `ticket/T46-jeu-hors-ligne` - **Version** : 0.46.0
**Demandé par** : Hicham (2026-11-20) : « Je ne peux pas jouer hors ligne ? », puis « Oui » au plan proposé.

## Constat de départ (vérifié dans le code de main et d'EmulatorJS 4.2.3)
- `sw.js` garde la coquille de l'application, et les jeux de « Mes fichiers » sont servis depuis l'appareil : cette partie marche sans réseau.
- Le moteur EmulatorJS (loader.js, emulator.min.js, compression/, cœurs) vient toujours de cdn.emulatorjs.org, et `sw.js` s'interdisait de le garder.
- Le cache propre d'EmulatorJS (IndexedDB `EmulatorJS-core`) ne sert pas sans réseau : avant de l'utiliser, EmulatorJS lit `cores/reports/<cœur>.json` sur le CDN ;
  si cette lecture échoue, il prend un numéro de version au hasard, ignore son cache et retélécharge le cœur. La décision de l'architecture 8.4
  (« un cœur déjà chargé peut rejouer sans réseau ») était donc fausse.

## Plan validé
- `sw.js` garde les fichiers du CDN EmulatorJS dans un cache à part, `clone90-ejs-<version>` (une version x.y.z par cache, jamais « stable »).
  Cache d'abord : les adresses du CDN contiennent la version, leur contenu ne change pas. Ce cache n'est pas vidé quand Clone90 change de version.
- Il se remplit tout seul au premier lancement d'un jeu avec du réseau (chaque fichier demandé par EmulatorJS est gardé).
- « Mes fichiers » : rubrique « Jouer sans réseau » et bouton « Préparer le jeu hors ligne » : moteur et cœur de chaque machine qui a des jeux,
  téléchargés d'avance. Les versions du moteur qui ne servent plus sont effacées à ce moment.
- La machine Amiga (EmulatorJS 4.2.1, T21) a son propre cache.
- Message du lecteur sans réseau : il indique le bouton.
- Exception écrite à la règle 6 (journal du CLAUDE.md, architecture 8.4).

## Critères d'acceptation
1. Hors ligne, un jeu de « Mes fichiers » démarre si sa machine a été préparée (bouton) ou déjà lancée une fois avec du réseau.
2. Le cache du moteur ne contient que des fichiers de `https://cdn.emulatorjs.org/<x.y.z>/data/` ; jamais de ROM, de BIOS, ni de réponse en erreur.
3. Une mise à jour de Clone90 ne vide pas le cache du moteur ; préparer avec une autre version du moteur efface l'ancienne.
4. Le bouton télécharge seulement ce qui manque, et dit pour quelles machines le jeu est prêt et combien a été téléchargé, ou ce qui a échoué.
5. Sans réseau et sans préparation, le message d'erreur du lecteur cite « Préparer le jeu hors ligne ».
6. Seul `js/player/launcher.js` (et ses modules) connaît les fichiers d'EmulatorJS (règle 4).

## Taille
Moteur environ 1 Mo par version ; cœurs environ 1 Mo (NES, Super Nintendo, Game Boy, PC Engine, Master System, Mega Drive, 32X),
4 Mo (Amiga), 8 Mo (arcade et Neo Geo). Environ 21 Mo pour toutes les machines.

## Vérification
- `node --test tests/offline-engine.test.mjs tests/sw.test.mjs tests/library-screen-offline.test.mjs tests/launcher.test.mjs`
- `node tests/recette/hors-ligne.mjs [dossier de captures]` (vrai EmulatorJS : `EJS_DATA`, `EJS_CORE`, voir tests/recette/README.md).
- À la main sur le téléphone : avec réseau, « Mes fichiers » > « Préparer le jeu hors ligne » ; puis mode avion, ouvrir Clone90 et lancer un jeu.
