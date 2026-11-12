# UX - Site de jeux rétro (EmulatorJS)

Version 1 (étape 1a). Auteur : UX. Statut : proposition à valider par le PO.
Points marqués **[à aligner tech-lead]** dépendent de docs/architecture.md.

## 1. Principes

- **Une seule logique de navigation** pour souris, tactile, clavier et manette : une liste d'éléments focusables, un focus visible unique, une action "valider" et une action "retour".
- **Écran de télévision d'abord, téléphone ensuite** : grandes cibles, peu de texte, rien qui dépend du survol.
- **Le jeu a la priorité** : pendant une partie, le site ne capte aucune touche du jeu, sauf une combinaison de sortie dédiée.
- **Sobre malgré l'ambiance console** (design « Cartouche bleue », T24, validé par Hicham le 2026-11-11) : l'ambiance rétro vient de la typo, des couleurs et des cadres pixel. Aucun effet de fond (pas de scanlines, pas de défilement de fond). **Le seul clignotement autorisé** est celui du curseur ▶ de l'élément focalisé et de la mention « PRÊT ? » de l'écran Jouer : 1 Hz (sous le seuil de 3 flashs par seconde de WCAG 2.3.1), coupé par `prefers-reduced-motion` (curseur et mention fixes). Cet assouplissement remplace l'ancien « pas de clignotements ».

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

**Bouton « Dossiers des jeux » (T25).** Centré sous la grille des machines, bouton secondaire (bleu, classe `.button.is-secondary`, curseur ▶ au focus), `data-nav`, atteint en pressant bas depuis la dernière rangée. Il n'est dessiné que si `GET api/settings` répond (serveur du lanceur Mac) : jamais sur GitHub Pages ni en réseau local. Il ouvre un panneau modal (boîte de dialogue de la section 3.4, boîte large) :

```
+--[ Dossiers des jeux ]--------------+
| Clone90 cherche vos jeux et vos BIOS|
| dans ces dossiers.                  |
|  ROMs : /Volumes/Jeux (dossier choisi)
|  BIOS : /projet/bios (dossier du projet)
|  <message d'état, aria-live>        |
| [ Choisir le dossier des ROMs ]     |
| [ Choisir le dossier des BIOS ]     |
| [ Utiliser les ROMs du projet ]     |
| [ Utiliser les BIOS du projet ]     |
| [ Fermer ]                          |
+-------------------------------------+
```

Quatre choix puis Fermer, en colonne : haut/bas pour naviguer (sans boucler), confirmer pour agir, retour ou Fermer pour fermer, focus sur le premier choix. Pendant le choix, les trois boutons sont marqués `aria-disabled` (appuis ignorés) et le message « Une fenêtre de choix s'est ouverte sur votre Mac. » est annoncé. Résultats : « Dossiers enregistrés. La liste des jeux est mise à jour. » (accueil redessiné derrière le panneau), « Aucun changement. » (annulation), ou le refus en français (dossier trop large ou introuvable, fenêtre déjà ouverte, serveur injoignable). Au retour, le focus revient sur le bouton « Dossiers des jeux ».

**Pochettes (T28).** Le panneau ajoute, entre « Utiliser les BIOS du projet » et « Fermer », le bouton **Télécharger les pochettes** et une phrase d'explication (base libre libretro-thumbnails, usage personnel, images gardées sur ce Mac). Pendant le téléchargement, tous les choix sauf Fermer sont `aria-disabled` et la zone `role="status"` annonce « Lecture de la liste des pochettes (Amiga)... » puis « Téléchargement des pochettes : 12 sur 80... ». À la fin, le résumé en une ligne (« Pochettes téléchargées : 5 ; Déjà présentes : 2 ; Introuvables : 3 ; Ambiguës (rien téléchargé) : 1 ») et l'accueil se redessine si des pochettes sont arrivées. Fermer le panneau ne l'interrompt pas ; rouvert, le suivi reprend.

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

- **Bouton "Menu"** (flèche ◀ + texte "Menu"), coin haut gauche, 48 x 48 px min, semi-transparent (opacité 0.6). Sur desktop il se masque après 3 s sans mouvement de souris et réapparaît au mouvement. Sur tactile il reste visible en permanence (opacité 0.4) car les contrôles virtuels d'EmulatorJS sont en bas : le haut gauche est libre. (confirmé : les contrôles virtuels EmulatorJS occupent le bas de l'écran)
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
- Manette : le premier appui sur une manette fraîchement vue (les navigateurs ne la montrent qu'au 1er appui, donc à chaque nouvelle page) affiche un petit toast "Manette connectée" 2 s. **S'il n'y a encore aucun élément focalisé** (accueil à l'ouverture), cet appui active seulement la navigation et pose le focus sur le 1er élément, sans déclencher d'action. **S'il y a déjà un élément focalisé** (bouton Jouer, tuile de retour, bouton de la page d'erreur), l'appui est traité normalement : A valide dès le 1er appui (décision PO, recette A3).
- Convention A = valider en bas, B = retour à droite (disposition Xbox/standard de la Gamepad API). Pas d'inversion style Nintendo en v1.

### 4.3 Focus visible et modes d'entrée

- Le style de focus apparaît dès qu'on utilise clavier ou manette (`:focus-visible` + classe `input-gamepad` posée par le JS). Avec souris ou tactile, pas d'anneau persistant, seulement l'effet de survol (souris) ou d'appui (tactile).
- Style de focus (T24) : contour 4 px couleur `--focus`, décalé de 8 px (4 px sur téléphone, variable `--focus-offset`), + curseur ▶ jaune clignotant au coin (pseudo-élément, forme), + cadre jaune et plaque de nom jaune à texte noir, + mise à l'échelle 1.05 (supprimée en reduced-motion). Le focus ne repose jamais sur la couleur seule : forme du curseur, épaisseur du contour, plaque inversée et agrandissement sont quatre indices indépendants.

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

**Changer de disquette (Amiga, T12, avis de ux validé par le PO et Hicham)** : seul autre raccourci du site pendant le jeu, uniquement pour un jeu à plusieurs disquettes (sinon sans effet, sans message).

| Entrée | Déclencheur | Pourquoi |
|---|---|---|
| Manette | **Select maintenu + RB** (bouton 5) | Même "famille" que la sortie (Select + autre bouton) sans jamais coïncider avec Select + Start ; RB est rarement vital en jeu Amiga. |
| Clavier | **F9** | Touche de fonction à côté de F10, libre dans EmulatorJS ; pas D (touche de jeu possible). |

- Disquette suivante, en cycle (3 puis 1). Front montant : un appui maintenu = un changement.
- Retour : toast « Disquette 2 / 3 » 2 s (région `role="status"`, bas de l'écran, sans prendre le focus, sans recouvrir le bouton Menu ni le rappel de sortie), animation coupée en reduced-motion.
- Rappel : 2e ligne « Disquette : Select + RB - F9 » dans le bandeau de sortie (3 premiers lancements, 4 s), jeux à plusieurs disquettes seulement, pas sur tactile sans manette.
- Ignoré pendant la boîte de confirmation de sortie. Le numéro est lu dans le cœur d'émulation : cohérent si le joueur change aussi par le menu d'EmulatorJS (dont l'affichage peut rester sur l'ancien disque).

**Après la sortie** : arrêt complet de l'émulateur (son coupé immédiatement), sortie du plein écran, retour sur la grille de la machine, **focus sur la tuile du jeu quitté**, défilement restauré pour qu'elle soit visible.

## 5. Direction visuelle

### 5.1 Ambiance

« Cartouche bleue » (T24) : une console de jeu des années 90 en bleu profond. Cadres pixel à contour noir et biseau, fond rayé de deux bleus très proches, curseur ▶ jaune qui clignote, jauges à segments, titres en police pixel, texte courant en police lisible. Tout est dessiné pour Clone90 : aucun nom, personnage, sprite, logo, police, son ni écran d'un jeu existant. Thème sombre uniquement (usage TV / soirée, les jaquettes ressortent mieux).

### 5.2 Palette (variables CSS)

Source unique : le bloc `:root` de `css/base.css` (aucune couleur littérale ailleurs, `tests/design.test.mjs`). Les logos et les icônes PWA la lisent.

```css
:root {
  --bg: #0a1233;  --band: #0e1b52;          /* fond : rayures horizontales de 32 px */
  --bg-deep: #05091f; --band-deep: #070d2c; /* même fond, plus sombre, derrière le jeu (player.html) */
  --panel: #16296e;   /* cartes, en-tête, boîte de dialogue, toast */
  --panel-2: #1f3a9c; /* boutons secondaires, barre de titre de la boîte */
  --panel-3: #2646b0; /* seconde rayure de la barre de titre */
  --line: #000000;    /* contour noir des cadres (4 px) */
  --bevel-hi: #6fa8ff; --bevel-lo: #0a1a66; /* biseaux du cadre pixel */
  --text: #ffffff;    --text-muted: #b9c8ff;
  --accent: #ffd23f;  /* jaune : titres, bouton principal, focus (cadre, plaque, curseur) */
  --accent-hi: #fff3a8; --accent-lo: #b88a00; --on-accent: #1a1200;
  --focus: #3ee0ff;   /* anneau de focus, cyan */
  --danger: #b3202a; --danger-hi: #ff6b73; --danger-lo: #6e0f16; /* bouton Quitter */
  --danger-text: #ff8a8a;                   /* texte d'erreur (titre des écrans d'échec) */
  --disabled-bg: #1b2147; --disabled-hi: #4a5486; --disabled-lo: #11163a; /* machine à 0 jeu */
  --stripe-a: #2a3162; --stripe-b: #222850; /* hachures du logo d'une machine à 0 jeu */
  --scrim: rgba(5, 9, 31, 0.82); --scrim-strong: rgba(5, 9, 31, 0.94); /* voiles : boîte de dialogue, diagnostic */

  /* couleur d'accent par machine (visuel de repli des tuiles et logos) : inchangées par T24 */
  --m-arcade: #c0392b;  --m-neogeo: #7a5a06; --m-amiga: #a84300;
  --m-nes: #b03a2e;     --m-snes: #6c3fa0;   --m-gameboy: #4a6a2e;
  --m-gameboycolor: #7d3c98; --m-mastersystem: #1f5fa8; --m-gamegear: #2c3e50;
  --m-megadrive: #2b2b2b;    --m-megacd: #34495e;       --m-32x: #8e2a2a;
}
```

Contrastes (calcul WCAG 2.x, vérifié par `tests/design.test.mjs`) : `--text` sur `--bg` 18.3, sur `--panel` 13.3, sur `--panel-2` 9.8, sur `--panel-3` 8.1 ; `--text-muted` sur `--panel-2` 6.0 (le plus bas) ; `--accent` sur `--bg` 12.7 ; `--on-accent` sur `--accent` 12.9 ; `--text` sur `--danger` 6.7 ; `--danger-text` sur `--panel` 5.9 ; `--text` sur chaque couleur machine de 5.4 (arcade) à 14.2 (megadrive) ; `--focus` sur `--bg` 11.6 et `--bevel-hi` sur `--bg` 7.6 (seuil 3:1 pour le non textuel). Le contour noir seul est presque invisible sur le fond (environ 1.1:1) : c'est le biseau clair `--bevel-hi` qui porte la limite visible des composants.

Le texte des logos et des tuiles de repli est toujours `--text` sur la couleur machine (>= 4.5:1, contrôlé à la génération des logos).

**Composants** : cadre pixel = `--frame` (contour noir 4 px en ombre externe + biseaux en ombres internes), coins carrés, pas de `border-radius` ni de `clip-path` (il couperait l'anneau de focus). Boutons : principal jaune, secondaire bleu, danger rouge, capitales à `letter-spacing: .04em`, appui = décalage de 2 px. Tuile de jeu : jaquette 3:4 cadrée, plaque de titre sombre bordée de `--bevel-hi`. Tuile machine : logo sur la couleur machine, jauge verticale décorative de 6 segments (un segment pour 2 jeux, `aria-hidden`), nom et nombre de jeux en texte. Boîte de confirmation : barre de titre rayée `--panel-2` / `--panel-3`, focus par défaut « Continuer » (jaune), « Quitter » rouge. Écran Jouer : jaquette cadrée, titre, « PRÊT ? » clignotant (décoratif, `aria-hidden`), bouton Jouer jaune.

### 5.3 Typographie

- Titres (nom du site, nom de machine dans le logo, initiales des tuiles de repli, « Jouer », « PRÊT ? ») : **"Press Start 2P"** (police pixel libre, auto-hébergée dans `assets/fonts/` pour le hors-ligne PWA, repli monospace), utilisée en grand uniquement (>= 16 px), jamais pour du texte long. Ombre de texte pixel `2px 2px 0 var(--line)` (3 px pour le nom du site) : elle ne porte aucune information et ne réduit pas le contraste.
- Libellés de boutons : pile système en gras, capitales, `letter-spacing: .04em`.
- Texte courant et titres de jeux : pile système `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`, 16 px min (titres de tuiles 16 px desktop, 15 px téléphone, poids 600).
- Chemins de fichiers : `ui-monospace, "SF Mono", Consolas, monospace`.
- Tailles en `rem`, le site respecte le zoom navigateur jusqu'à 200 % sans perte de contenu.

### 5.4 Dimensions

| Élément | Desktop | Téléphone portrait |
|---|---|---|
| Carte machine | 220-280 px de large, 4 colonnes | ~50 % largeur, 2 colonnes |
| Tuile de jeu | 180-240 px de large, ratio 3:4 | ~160 px, 2 colonnes |
| Espacement grille | 24 px | 16 px |
| Marges latérales | 48 px | 16 px |
| Cible tactile min | - | 48 x 48 px (boutons en-tête, Menu, boîte de dialogue) |
| Coins | carrés (cadre pixel de 4 px) | carrés |

### 5.5 Mouvement et accessibilité

- Transitions courtes (150 ms) sur focus/survol/appui. Pas d'animation de page. Seules animations : le clignotement 1 Hz du curseur ▶ et de « PRÊT ? » (voir principe 1).
- `@media (prefers-reduced-motion: reduce)` : aucune mise à l'échelle, aucune transition, aucune animation (curseur et « PRÊT ? » fixes), défilement instantané. Une seule règle globale dans `css/base.css` (`*, *::before, *::after`), qui couvre toute animation ajoutée ; `tests/design.test.mjs` le vérifie.
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
- **CA-V1** Le focus est visible (contour >= 3 px, contraste >= 3:1) sur toutes les cartes, tuiles et boutons ; il ne repose pas sur la couleur seule (curseur ▶, plaque jaune, agrandissement). Le contour noir des cadres étant peu visible sur le fond, la limite des composants est portée par le biseau clair (>= 3:1) (T24).
- **CA-V2** Contraste texte >= 4.5:1 partout, y compris le texte des tuiles de repli sur chaque couleur machine (outil : vérificateur de contraste ou Lighthouse).
- **CA-V3** Toutes les cibles tactiles mesurent au moins 48 x 48 px sur téléphone.
- **CA-V4** Avec prefers-reduced-motion activé, aucune animation ni mise à l'échelle n'est visible : le curseur ▶ du focus et « PRÊT ? » restent affichés, fixes. Sans la préférence, ils clignotent à 1 Hz et rien d'autre ne clignote (T24).
- **CA-V5** Zoom navigateur à 200 % sur desktop : aucun contenu coupé ni chevauchement.
- **CA-V6** Lighthouse accessibilité >= 95 sur l'accueil et sur une grille.
- **CA-V7** Aucun défilement horizontal à 360 px de large, y compris avec l'anneau de focus, le cadre pixel et l'agrandissement 1.05 sur la tuile de la 1re ou de la dernière colonne (T24).

## 7. Questions ouvertes

- **Q1 (Hicham)** Combien de jeux par machine environ ? Au-delà de ~40, il faudra une recherche ou un saut par lettre.
- **Q2 (Hicham)** Les machines à 0 jeu doivent-elles apparaître (grisées, comme proposé) ou être masquées ?
- **Q3 (Hicham)** Confirmation avant de quitter un jeu : gardée (proposé) ou sortie directe ?
- **Q4 (tech-lead)** Iframe ou page dédiée ; la page parente peut-elle lire la Gamepad API et le clavier (F10, Échap long) pendant que EmulatorJS tourne ; position des contrôles virtuels EmulatorJS ; formats de ROM par machine.
