# UX - Site de jeux rétro (EmulatorJS)

Version 1 (étape 1a). Auteur : UX. Statut : proposition à valider par le PO.
Points marqués **[à aligner tech-lead]** dépendent de docs/architecture.md.

## 1. Principes

- **Une seule logique de navigation** pour souris, tactile, clavier et manette : une liste d'éléments focusables, un focus visible unique, une action "valider" et une action "retour".
- **Écran de télévision d'abord, téléphone ensuite** : grandes cibles, peu de texte, rien qui dépend du survol.
- **Le jeu a la priorité** : pendant une partie, le site ne capte aucune touche du jeu, sauf une combinaison de sortie dédiée.
- **Sobre** : ambiance rétro par la typo et les couleurs, pas par des effets (pas de scanlines animées, pas de clignotements).

## 2. Parcours

```
Accueil (machines) --valider--> Grille de jeux --valider--> Écran de jeu
      ^                              |   ^                        |
      +---------retour---------------+   +-------sortie dédiée----+
                                     |
                             (aucun jeu) -> état vide
```

URL (proposition, pour que le bouton précédent du navigateur et Android marchent) :
- `/` accueil
- `/#/neogeo` grille d'une machine
- `player.html?system=neogeo&game=<id>` écran de jeu (page dédiée, pas d'iframe : confirmé par le tech-lead, architecture.md 8.3 et 11)
- Retour du jeu : `index.html#/neogeo?focus=<idJeu>` (le focus revient sur la tuile du jeu quitté)

Le bouton retour système (navigateur, geste retour Android) fait exactement la même chose que l'action "retour".

## 3. Écrans

### 3.1 Accueil - choix de la machine

But : choisir une machine en 1 action. Une machine est visible si sa vague est livrée OU si elle a au moins un jeu (décision PO). Celles à 0 jeu sont affichées grisées en fin de liste avec la mention "0 jeu" (elles restent focusables pour afficher l'état vide, ce qui guide l'ajout de ROMs). En v1, seules amiga et neogeo sont listées.

Ordre : celui du champ `order` de systems.json (source de vérité, rien en dur dans le code). Les machines avec jeux passent avant celles à 0 jeu. Ordre initial retenu : Amiga, Neo Geo, Arcade, Master System, Mega Drive, Game Gear, Mega CD, 32X, NES, SNES, Game Boy, Game Boy Color.

Chaque carte machine : logo (SVG ou PNG fond transparent), nom en texte (toujours présent, le logo seul ne suffit pas), nombre de jeux.

**Desktop (>= 1024 px)**, 4 colonnes, cartes ratio 4:3 :

```
+------------------------------------------------------------------+
|  RETRO ARCADE                                    [?] Aide touches |
|                                                                  |
|  Choisis une machine                                             |
|                                                                  |
|  +============+  +------------+  +------------+  +------------+  |
|  || [LOGO]   ||  |  [LOGO]    |  |  [LOGO]    |  |  [LOGO]    |  |
|  || Neo Geo  ||  |  Amiga     |  |  NES       |  |  SNES      |  |
|  || 12 jeux  ||  |  8 jeux    |  |  0 jeu     |  |  0 jeu     |  |
|  +============+  +------------+  +------------+  +------------+  |
|   (focus)                                                        |
|  +------------+  +------------+  +------------+  +------------+  |
|  |   ...      |  |   ...      |  |   ...      |  |   ...      |  |
|  +------------+  +------------+  +------------+  +------------+  |
|                                                                  |
|  Flèches : choisir   Entrée / A : ouvrir                         |
+------------------------------------------------------------------+
```

Avec 12 machines : 3 rangées de 4 sur desktop, défilement vertical si nécessaire. Avec 2 machines (v1) : la rangée est centrée, cartes de même taille (pas d'étirement).

**Téléphone portrait (< 600 px)**, 2 colonnes :

```
+--------------------------+
| RETRO ARCADE         [?] |
| Choisis une machine      |
| +----------+ +----------+|
| | [LOGO]   | | [LOGO]   ||
| | Neo Geo  | | Amiga    ||
| | 12 jeux  | | 8 jeux   ||
| +----------+ +----------+|
| +----------+ +----------+|
| |  ...     | |  ...     ||
| +----------+ +----------+|
+--------------------------+
```

Tablette / entre 600 et 1023 px : 3 colonnes.

### 3.2 Grille de jeux

En-tête : bouton "< Machines" (retour), nom + logo de la machine, nombre de jeux. Pas de recherche en v1 (à prévoir si une machine dépasse ~40 jeux, voir questions).

Tuile de jeu : jaquette au ratio 3:4 (portrait, comme une boîte), titre en dessous sur 2 lignes max (ellipse au-delà, titre complet dans `title` et `aria-label`).
Visuel de repli si pas de jaquette : fond de la couleur d'accent de la machine, initiales du jeu (2 lettres max) en grand au centre en police pixel, et le logo de la machine en petit en bas. Jamais d'image cassée : si l'image échoue au chargement, on bascule sur le repli.
Tri : alphabétique, en ignorant "The", "Le", "La" en tête.

**Desktop**, colonnes auto (largeur tuile min 180 px, max 240 px), en général 5 à 6 colonnes :

```
+------------------------------------------------------------------+
| [< Machines]   [LOGO] Neo Geo  - 12 jeux                     [?] |
|                                                                  |
| +========+ +--------+ +--------+ +--------+ +--------+ +--------+ |
| ||      || |        | |  MS    | |        | |        | |  KF    | |
| ||JAQUET|| | JAQUET | | (repli)| | JAQUET | | JAQUET | | (repli)| |
| ||  TE  || |   TE   | |  neo   | |   TE   | |   TE   | |  neo   | |
| +========+ +--------+ +--------+ +--------+ +--------+ +--------+ |
|  Blazing    Garou      Metal      Samurai    Shock      King of   |
|  Star       Mark of..  Slug       Shodown    Troopers   Fighters  |
|                                                                  |
| +--------+ +--------+  ...                                       |
+------------------------------------------------------------------+
```

**Téléphone portrait**, 2 colonnes (tuile ~ 160 px de large) :

```
+--------------------------+
| [<] Neo Geo - 12 jeux [?]|
| +----------+ +----------+|
| |          | |   MS     ||
| | JAQUETTE | | (repli)  ||
| |          | |          ||
| +----------+ +----------+|
| Blazing Star  Metal Slug |
| +----------+ +----------+|
| |   ...    | |   ...    ||
+--------------------------+
```

Retour sur cette grille depuis un jeu : la tuile du jeu quitté a le focus et est visible (scroll si besoin).

### 3.3 État vide (machine sans jeu)

Même en-tête que la grille. Message centré, ton direct, avec le chemin exact à copier :

```
+------------------------------------------------------------------+
| [< Machines]   [LOGO] NES  - 0 jeu                               |
|                                                                  |
|                     [logo machine, grisé]                        |
|                                                                  |
|               Aucun jeu pour cette machine.                      |
|      Déposez vos ROMs dans le dossier :  roms/nes/               |
|      puis rechargez la page.                                     |
|      Formats acceptés : .nes .zip                                |
|                                                                  |
|                  [ Revenir aux machines ]   (focus)              |
+------------------------------------------------------------------+
```

- Le chemin est en police mono, sélectionnable.
- La liste des formats acceptés vient de la config de la machine **[à aligner tech-lead]** ; si non disponible, la ligne est omise.
- Le bouton "Revenir aux machines" a le focus à l'arrivée, pour que manette et clavier aient toujours une action possible.
- Téléphone : même contenu, empilé, bouton pleine largeur.

### 3.4 Écran de jeu

**Étape "Jouer"** : le plein écran et le son exigent un geste utilisateur sur la page de jeu. player.html affiche d'abord un écran intermédiaire : titre du jeu, jaquette, un gros bouton "Jouer" qui a le focus (activable par Entrée, A ou tap) et le bouton Menu/"Retour" (B, Échap). Le clic sur "Jouer" lance EmulatorJS et le plein écran. Cela ajoute une action au parcours (tuile, puis Jouer) ; acceptable car elle reste à la manette. Le bandeau de rappel de la sortie s'affiche ensuite.

EmulatorJS occupe tout l'écran. Le site ajoute seulement :

- **Bouton "Menu"** (icône maison + texte "Menu"), coin haut gauche, 48 x 48 px min, semi-transparent (opacité 0.6). Sur desktop il se masque après 3 s sans mouvement de souris et réapparaît au mouvement. Sur tactile il reste visible en permanence (opacité 0.4) car les contrôles virtuels d'EmulatorJS sont en bas : le haut gauche est libre. (confirmé : les contrôles virtuels EmulatorJS occupent le bas de l'écran)
- **Chargement** : pendant le chargement de la ROM, écran sombre avec titre du jeu + "Chargement..." et le bouton Menu déjà actif. En cas d'échec : "Impossible de lancer ce jeu." + raison si connue + bouton "Revenir à la liste" (focus).

```
Desktop                                   Téléphone (paysage conseillé)
+----------------------------------+      +--------------------------+
|[Menu]                            |      |[Menu]                    |
|                                  |      |                          |
|        (jeu EmulatorJS)          |      |      (jeu)               |
|                                  |      |                          |
|                                  |      | (o)            (A)(B)    |
+----------------------------------+      +--------------------------+
```

Téléphone en portrait : on laisse EmulatorJS gérer son affichage (jeu en haut, contrôles en bas) ; pas de verrouillage d'orientation forcé en v1.

**Confirmation de sortie** : toute sortie (bouton Menu, combinaison clavier ou manette) met le jeu en pause et ouvre une petite boîte :

```
+-------------------------------+
|  Quitter Metal Slug ?         |
|  La partie en cours sera      |
|  perdue.                      |
|                               |
|  [ Continuer ]  [ Quitter ]   |
+-------------------------------+
```

- Focus par défaut sur "Continuer" (évite la sortie accidentelle).
- Gauche/Droite (croix ou flèches) pour changer, A/Entrée pour valider, B/Échap = Continuer.
- Répéter la combinaison de sortie pendant que la boîte est ouverte (Select + Start 1 s, F10, ou Échap maintenu 1 s) = Quitter. Échap court = Continuer.
- Le bouton Menu tactile/souris ouvre la même boîte (pas de sortie directe : un tap accidentel est fréquent sur téléphone).
- Précisions validées à T7 : à la manette, Start seul ne valide pas tant que Select ou Start est tenu (il faut A) ; au clavier, Échap court = Continuer, Échap maintenu 1 s = Quitter, Retour arrière inactif ; sur l'écran Jouer le bouton Menu sert de Retour (avec B/Échap) ; pas de toast "Manette connectée" en jeu ; le bouton Menu est à opacité pleine hors jeu en cours.
- Si la sauvegarde d'état arrive plus tard, le texte deviendra "Progression non sauvegardée" ou proposera "Sauvegarder et quitter".

### 3.5 Écarts validés à l'implémentation de T5 (accueil)

- Bouton [?] Aide touches reporté après la v1 : remplacé par la ligne "Flèches : choisir - Entrée / A : ouvrir", masquée sur écran tactile.
- Police Press Start 2P non intégrée tant que Hicham n'a pas validé le téléchargement : repli monospace système via `--font-pixel`.
- Pas de focus automatique à l'arrivée sur l'accueil en souris/tactile : le focus est posé à la 1re flèche, au réveil de la manette ou au retour d'une grille (cohérent avec CA-N1).
- Sans logo, le repli affiche le nom de la machine sur sa couleur (doublon visuel avec le nom écrit dessous, accepté en attendant assets/logos).

## 4. Navigation unifiée

### 4.1 Modèle

- Chaque écran a une **grille d'éléments focusables** (cartes, tuiles, boutons de l'en-tête). Le focus est un vrai focus DOM (`element.focus()`), pour que lecteurs d'écran et clavier natif marchent, et que la manette pilote le même focus.
- **Déplacement spatial** : flèche droite/gauche = élément voisin dans la rangée ; haut/bas = même colonne, rangée voisine (si la rangée du dessous est plus courte, aller au dernier élément). Pas de bouclage horizontal (bord = on reste). Haut depuis la 1re rangée de la grille = bouton "< Machines" de l'en-tête.
- Le focus suit en défilement : l'élément focusé est toujours entièrement visible (`scrollIntoView({block: "nearest"})`, sans animation si reduced-motion).
- Sur les grilles et l'état vide, un élément a le focus dès l'arrivée en mode clavier/manette. Exception : l'accueil, où le focus n'est pas posé automatiquement (pas d'anneau parasite en souris/tactile) ; il l'est à la 1re flèche, au réveil de la manette ou au retour d'une grille. Dès qu'un mode clavier/manette est actif, jamais "rien de sélectionné".

### 4.2 Table des entrées (menus, hors jeu)

| Action | Clavier | Manette (disposition standard) | Tactile | Souris |
|---|---|---|---|---|
| Déplacer le focus | Flèches (Tab / Maj+Tab aussi) | Croix, ou stick gauche (seuil 0.5, répétition après 400 ms puis toutes les 120 ms) | - | Survol ne déplace pas le focus |
| Valider / ouvrir | Entrée, Espace | A (bouton 0, en bas) | Tap | Clic |
| Retour | Échap, Retour arrière | B (bouton 1, à droite) | Bouton "<" de l'en-tête, geste retour Android | Bouton "<", bouton précédent |
| Aide touches | ? | Select (bouton 8) | Bouton [?] | Bouton [?] |
| Page suivante / précédente | Page bas / Page haut | Gâchettes LB / RB (boutons 4/5) | Défilement | Molette |

- Start (bouton 9) sur les menus = Valider (beaucoup de joueurs l'appuient par réflexe).
- Retour depuis l'accueil : ne fait rien (pas de sortie de l'application).
- Manette : le premier appui sur une manette fraîchement branchée active la navigation sans déclencher d'action (il "réveille" le focus) ; un petit toast "Manette connectée" s'affiche 2 s.
- Convention A = valider en bas, B = retour à droite (disposition Xbox/standard de la Gamepad API). Pas d'inversion style Nintendo en v1.

### 4.3 Focus visible et modes d'entrée

- Le style de focus apparaît dès qu'on utilise clavier ou manette (`:focus-visible` + classe `input-gamepad` posée par le JS). Avec souris ou tactile, pas d'anneau persistant, seulement l'effet de survol (souris) ou d'appui (tactile).
- Style de focus : contour 4 px couleur `--focus`, décalé de 3 px (`outline-offset`), + légère mise à l'échelle 1.05 (supprimée en reduced-motion), + titre de la tuile en gras couleur `--text`. Le focus ne repose jamais sur la couleur seule (contour épais).

### 4.4 Sortie du jeu (point critique)

Pendant le jeu, **toutes les touches et boutons vont à EmulatorJS**. Le site n'écoute que :

| Entrée | Déclencheur de sortie | Pourquoi |
|---|---|---|
| Manette | **Select + Start maintenus ensemble 1 seconde** | Combinaison quasi inutilisée en jeu (convention RetroArch) ; le maintien évite les faux positifs. Un anneau de progression autour du bouton Menu montre le maintien. |
| Clavier | **F10**, ou **Échap maintenu 1 seconde** | Échap court reste à EmulatorJS (son menu, sortie du plein écran par le navigateur). F10 n'est pas une touche de jeu par défaut. (défauts EmulatorJS connus : flèches, X, Z, A, S, Q, W, Entrée, V ; F10 libre à confirmer par un test) |
| Souris / tactile | Bouton "Menu" haut gauche | Toujours atteignable sans connaître de combinaison. |
| Retour système | Bouton précédent / geste retour Android | Ouvre la même confirmation (pas de sortie sèche). |

- Toutes ouvrent la boîte de confirmation (section 3.4), le jeu passe en pause.
- La combinaison est rappelée 4 s au lancement du jeu dans un bandeau discret en haut : "Quitter : Select + Start (maintenir) - F10 - bouton Menu". Il n'est montré que les 3 premiers lancements (mémorisé en localStorage).
- Si la sortie du plein écran par le navigateur (Échap court) a lieu, le jeu continue en fenêtre, le bouton Menu reste visible.

**Après la sortie** : arrêt complet de l'émulateur (son coupé immédiatement), sortie du plein écran, retour sur la grille de la machine, **focus sur la tuile du jeu quitté**, défilement restauré pour qu'elle soit visible.

## 5. Direction visuelle

### 5.1 Ambiance

"Salle d'arcade la nuit" sobre : fond très sombre légèrement bleuté, une couleur d'accent chaude, titres en police pixel, texte courant en police lisible. Pas de dégradés criards, pas de néons animés. Thème sombre uniquement en v1 (usage TV / soirée, et les jaquettes ressortent mieux).

### 5.2 Palette (variables CSS)

```css
:root {
  --bg:          #0f1117; /* fond page */
  --surface:     #1a1d27; /* cartes, tuiles */
  --surface-2:   #252a38; /* survol, en-tête */
  --border:      #2f3547; /* bordures neutres */
  --text:        #f2f0e9; /* texte principal (contraste ~16:1 sur --bg) */
  --text-muted:  #a9adbb; /* texte secondaire (~8:1 sur --bg, ~7:1 sur --surface) */
  --accent:      #ffb000; /* ambre arcade : titres, boutons primaires */
  --on-accent:   #1a1200; /* texte sur fond accent (~10:1) */
  --focus:       #3ee0ff; /* anneau de focus, cyan (~11:1 sur --bg) */
  --danger:      #ff6b6b; /* erreurs */
  --disabled:    #5c6275; /* machines à 0 jeu : uniquement pour le décor, le texte reste en --text-muted */

  /* couleur d'accent par machine (visuel de repli des tuiles) */
  --m-arcade: #c0392b;  --m-neogeo: #7a5a06; --m-amiga: #a84300;
  --m-nes: #b03a2e;     --m-snes: #6c3fa0;   --m-gameboy: #4a6a2e;
  --m-gameboycolor: #7d3c98; --m-mastersystem: #1f5fa8; --m-gamegear: #2c3e50;
  --m-megadrive: #2b2b2b;    --m-megacd: #34495e;       --m-32x: #8e2a2a;
}
```

Le texte des tuiles de repli est toujours `--text` sur la couleur machine ; toutes ces couleurs sont assez foncées pour un contraste >= 4.5:1 avec `#f2f0e9` (valeurs recalculées : les versions initiales de neogeo, amiga et gameboy étaient sous 4.5:1 ; à re-vérifier par le testeur, voir CA-V2).

### 5.3 Typographie

- Titres (nom du site, nom de machine, initiales des tuiles de repli) : **"Press Start 2P"** (police pixel libre, à auto-héberger dans le dossier du site pour le hors-ligne PWA), utilisée en grand uniquement (>= 16 px), jamais pour du texte long.
- Texte courant et titres de jeux : pile système `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`, 16 px min (titres de tuiles 16 px desktop, 15 px téléphone, poids 600).
- Chemins de fichiers : `ui-monospace, "SF Mono", Consolas, monospace`.
- Tailles en `rem`, le site respecte le zoom navigateur jusqu'à 200 % sans perte de contenu.

### 5.4 Dimensions

| Élément | Desktop | Téléphone portrait |
|---|---|---|
| Carte machine | 220-280 px de large, 4 colonnes | ~50 % largeur, 2 colonnes |
| Tuile de jeu | 180-240 px de large, ratio 3:4 | ~160 px, 2 colonnes |
| Espacement grille | 24 px | 12 px |
| Marges latérales | 48 px | 16 px |
| Cible tactile min | - | 48 x 48 px (boutons en-tête, Menu, boîte de dialogue) |
| Rayon des coins | 8 px | 8 px |

### 5.5 Mouvement et accessibilité

- Transitions courtes (150 ms) sur focus/survol uniquement. Pas d'animation de page.
- `@media (prefers-reduced-motion: reduce)` : aucune mise à l'échelle, aucune transition, défilement instantané.
- Contraste texte >= 4.5:1 (normal) et >= 3:1 (anneau de focus et contours d'éléments interactifs).
- Langue `lang="fr"`. Cartes et tuiles sont des `<button>` ou `<a>` avec nom accessible (nom de machine + nombre de jeux ; titre du jeu). Les logos et jaquettes ont `alt=""` puisque le nom est déjà en texte.
- Boîte de confirmation : `role="dialog"`, `aria-modal="true"`, focus piégé dedans, rendu au déclencheur à la fermeture si "Continuer".
- Aucune information portée uniquement par la couleur (machines vides : mention "0 jeu" en texte).

## 6. Critères d'acceptation UX (testeur)

Navigation
- **CA-N1** Sur l'accueil, au chargement, une carte machine a le focus visible dès la 1re touche flèche ou le 1er appui manette.
- **CA-N2** Accueil -> grille -> écran Jouer -> jeu -> grille -> accueil faisable entièrement au clavier seul (flèches, Entrée, Échap, F10), sans souris.
- **CA-N3** Même parcours faisable entièrement à la manette seule (croix, A, B, Select+Start), testé avec au moins une manette Xbox ou compatible sur Chrome desktop et une sur Android.
- **CA-N4** Même parcours faisable au tactile seul sur un téléphone Android en portrait.
- **CA-N5** Les flèches/croix déplacent le focus vers le voisin visuel attendu (droite, gauche, haut, bas), sans bouclage ; haut depuis la 1re rangée atteint le bouton retour de l'en-tête.
- **CA-N6** L'élément focusé est toujours entièrement visible à l'écran (défilement automatique).
- **CA-N7** Le bouton précédent du navigateur et le geste retour Android font la même chose que l'action "retour" (et ouvrent la confirmation pendant un jeu).

Jeu et sortie
- **CA-J1** Pendant une partie, aucune touche de jeu (flèches, A, B, X, Y, Start seul, Select seul, Échap court) ne fait quitter le jeu ni n'ouvre la confirmation.
- **CA-J2** Select + Start maintenus 1 s, F10, Échap maintenu 1 s, et le bouton Menu ouvrent chacun la confirmation ; le jeu et le son sont en pause pendant qu'elle est affichée.
- **CA-J3** Dans la confirmation, le focus par défaut est sur "Continuer" ; B / Échap reprennent le jeu.
- **CA-J4** Après "Quitter" : son coupé immédiatement, plein écran quitté, grille de la machine affichée avec le focus sur la tuile du jeu quitté, visible à l'écran.
- **CA-J5** Le bouton Menu ne recouvre aucun contrôle virtuel d'EmulatorJS sur téléphone et mesure au moins 48 x 48 px.
- **CA-J7** Sur l'écran "Jouer", le bouton a le focus à l'arrivée et se valide au clavier, à la manette (A) et au tap ; B/Échap/Menu reviennent à la grille.
- **CA-J6** Une ROM qui échoue au chargement affiche un message d'erreur et un bouton de retour focusé, jamais un écran noir bloquant.

Contenu et états
- **CA-C1** Une machine sans ROM affiche le message d'état vide avec le chemin exact `roms/<machine>/`, et le bouton "Revenir aux machines" a le focus.
- **CA-C2** Un jeu sans jaquette, ou dont la jaquette ne charge pas, affiche le visuel de repli (initiales + couleur machine), jamais d'icône d'image cassée.
- **CA-C3** Un titre long est coupé à 2 lignes avec "..." et reste lisible en entier via le nom accessible.
- **CA-C4** Avec 12 machines simulées, l'accueil reste lisible sans défilement horizontal, en desktop (1280 x 720) et téléphone (360 x 740).

Visuel et accessibilité
- **CA-V1** Le focus est visible (contour >= 3 px, contraste >= 3:1) sur toutes les cartes, tuiles et boutons.
- **CA-V2** Contraste texte >= 4.5:1 partout, y compris le texte des tuiles de repli sur chaque couleur machine (outil : vérificateur de contraste ou Lighthouse).
- **CA-V3** Toutes les cibles tactiles mesurent au moins 48 x 48 px sur téléphone.
- **CA-V4** Avec prefers-reduced-motion activé, aucune animation ni mise à l'échelle n'est visible.
- **CA-V5** Zoom navigateur à 200 % sur desktop : aucun contenu coupé ni chevauchement.
- **CA-V6** Lighthouse accessibilité >= 95 sur l'accueil et sur une grille.
- **CA-V7** Aucun défilement horizontal à 360 px de large.

## 7. Questions ouvertes

- **Q1 (Hicham)** Combien de jeux par machine environ ? Au-delà de ~40, il faudra une recherche ou un saut par lettre.
- **Q2 (Hicham)** Les machines à 0 jeu doivent-elles apparaître (grisées, comme proposé) ou être masquées ?
- **Q3 (Hicham)** Confirmation avant de quitter un jeu : gardée (proposé) ou sortie directe ?
- **Q4 (tech-lead)** Iframe ou page dédiée ; la page parente peut-elle lire la Gamepad API et le clavier (F10, Échap long) pendant que EmulatorJS tourne ; position des contrôles virtuels EmulatorJS ; formats de ROM par machine.
