# CLAUDE.md : Clone90

Lis ce fichier entièrement avant toute action.

Règles générales de travail (méthode, tests, Git, commentaires) : @docs/regles-de-travail.md
Ce fichier ne contient que ce qui est propre à Clone90. En cas de contradiction, ce fichier l'emporte.

## Le produit

Clone90 est un site web pour jouer aux jeux rétro des années 90 avec EmulatorJS, sur PC, Mac et Android.
On choisit une machine, puis un jeu dans une grille de grandes tuiles, et le jeu s'ouvre en plein écran.
Navigation à la souris, au tactile, au clavier et à la manette (Gamepad API). Installable en PWA.

## Stack technique

- HTML, CSS et JavaScript (modules ES) **sans framework et sans build**.
- EmulatorJS chargé depuis son CDN officiel, version dans une seule constante (`js/config.js`).
- Script Node.js **sans dépendance** : `scripts/generate-games.mjs` scanne `roms/` et produit `games.json`.
- Tests : `node:test` pour la logique (script, modules purs). Pas de dépendance npm sans accord.
- Hébergement : GitHub Pages (dépôt public), chemins **toujours relatifs**.

L'architecture détaillée est dans `docs/architecture.md`, l'interface dans `docs/ux.md`. Les lire avant de coder.

## Règles produit (non négociables)

1. **Aucune ROM ni BIOS dans le dépôt** (`roms/`, `bios/` et `games.json` sont ignorés par git). On ne fournit aucun jeu.
2. `systems.json` est la **seule source de vérité** des machines : aucune liste de machines écrite ailleurs.
3. Une seule couche d'entrée (`js/input/`) pour clavier, manette, tactile et souris.
4. Seul `js/player/launcher.js` connaît EmulatorJS.
5. Aucune statistique, aucun compte. Aucune donnée de l'utilisateur n'est envoyée sur le réseau. Seule exception : des lectures vers github.com (base libre libretro-thumbnails), déclenchées par le bouton « Télécharger les pochettes » ou par `node scripts/covers.mjs` ; GitHub voit alors l'adresse IP et les noms des jeux cherchés.
6. Le service worker ne met jamais en cache les ROMs ni les BIOS.

## Décisions déjà prises (validées par Hicham le 2026-11-09)

- Le jeu tourne dans une page dédiée `player.html`, précédée d'un écran « Jouer » (geste utilisateur requis pour le plein écran et le son).
- Logos des machines faits maison (pas de logos officiels).
- Titres arcade et Neo Geo : `data/titles.json` (nom de romset vers titre), sinon nom du fichier.
- Android en réseau local sans HTTPS : on joue, mais pas d'installation PWA. Limite acceptée.
- Sur GitHub Pages, aucun jeu : un message clair l'explique.
- Provisoire (proposé par ux, sans réponse de Hicham) : machines sans jeu grisées, confirmation avant de quitter un jeu, pas de recherche en v1.

## Ordre de livraison

1. Amiga (puae) et Neo Geo (fbneo) d'abord, tickets T0 à T9.
2. Les autres machines ensuite.
3. PWA, guide local et publication GitHub Pages.

Le spike T0 attend les ROMs et BIOS de test que Hicham fournira : ne pas les lui redemander avant.

## Journal des décisions
- 2026-11-12 : exception à la règle 5 pour le téléchargement des pochettes depuis github.com, validée par Hicham (« ok pochettes »). Raison : choisir les jeux par leur pochette ; connexion seulement sur action de l'utilisateur, lectures seules.
