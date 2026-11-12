# T28 : Pochettes automatiques

**Branche** : `ticket/T28-pochettes` - **Version** : 0.28.0
**Demandé par** : Hicham (2026-11-12) : « avoir les pochettes afin de choisir facilement ; les télécharger du web et les mettre dans le dossier des roms pour chaque jeu ».

## Réalisation
- `systems.json` : champ `thumbnailsRepo` pour les 12 machines (dépôts de l'organisation GitHub `libretro-thumbnails`, noms vérifiés en lecture).
- `scripts/covers.mjs` : pour chaque jeu sans jaquette, cherche dans `Named_Boxarts/` du dépôt de sa machine (2 requêtes d'arbre par machine, cache 7 jours dans `clone90.covers-cache.json`, ignoré par git). Titre normalisé, préférence Europe, USA, World, ambiguïté signalée sans téléchargement, sous-titre accepté s'il est seul. Téléchargement depuis `raw.githubusercontent.com`, PNG vérifié, 2 Mo, jamais d'écrasement, écrit à côté du jeu sous son nom en `.png`. `node scripts/covers.mjs [--dry-run] [--refresh]`, résumé en français, `games.json` régénéré.
- API locale : `GET /api/covers`, `POST /api/covers/download` (`settings-api.mjs`), mêmes contrôles que T25, verrou partagé, suivi par lecture de l'état.
- Interface : bouton « Télécharger les pochettes » dans le panneau « Dossiers des jeux » (progression et résumé en `role="status"`, accueil rechargé).
- Docs : README et guide (« Pochettes des jeux », nom exact à donner à une image déposée à la main), architecture 7.4, ux 3.1, READMEs.
- Tests sans réseau : `tests/covers.test.mjs`, `tests/covers-api.test.mjs`, ajouts à `tests/folders-panel.test.mjs` et `tests/systems.test.mjs`.

## Constats en lecture sur les vrais dépôts (2026-11-12)
- Amiga : `Gods.png`, `Leander (Europe).png` (l'USA existe aussi), `Zaxxon.png`. Neo Geo : `Viewpoint.png`. Arcade (FBNeo) : `Viewpoint.png`, mais `Zaxxon`, `Pac-Man`, `Galaga`, `Donkey Kong` ont plusieurs sets (ambigus). Mega Drive : `Gods (Europe).png`, `Viewpoint (USA).png`.
- Le dépôt FBNeo refuse l'arbre récursif (500) : d'où deux requêtes par machine.

## Point pour le PO
- Règle produit 5 (« aucune donnée envoyée sur le réseau ») : le téléchargement fait des lectures vers GitHub, sans rien envoyer de Clone90. Exception documentée en architecture 7.4 ; proposition d'entrée au CLAUDE.md : « 2026-11-12 : lectures seules vers api.github.com et raw.githubusercontent.com autorisées pour les pochettes (T28) ».

## Vérification manuelle (non faite par le dev : aucun navigateur, serveur ni téléchargement réel lancés)
1. `node scripts/covers.mjs --dry-run` avec de vrais jeux : la liste annoncée est plausible.
2. `node scripts/covers.mjs` : les images apparaissent dans le dossier des ROMs, à côté des jeux, et sur les tuiles.
3. Bouton « Télécharger les pochettes » dans le panneau : progression, résumé, accueil mis à jour.
4. Relancer : « Déjà présentes », rien n'est retéléchargé ni remplacé.
5. Sur GitHub Pages et depuis un téléphone : aucun bouton.
