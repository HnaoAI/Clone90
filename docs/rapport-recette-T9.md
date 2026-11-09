# Rapport de recette T9

Testeur, ticket T9. Code testé : `main` au commit c45d27d (T0 à T8 et T5b mergés, T0 mergé en cours de recette ; les parcours ont été rejoués sur ce code), Chromium 1161 piloté par Playwright 1.51, faux EmulatorJS.
Les scripts sont dans `tests/recette/` (README dans le dossier). Ils ne font pas partie de `node --test` (ils demandent Playwright et un serveur lancé). La suite unitaire existante passe : 283 tests verts.

Méthode : site servi par `node scripts/serve.mjs` depuis une COPIE du projet hors dépôt, avec de FAUX fichiers (2 octets) dans `roms/` et `bios/` de la copie. Le vrai `roms/`, `bios/` et `games.json` de Hicham n'ont pas été utilisés (voir la section "Incident" en fin de rapport).
Le moteur est remplacé par un faux `loader.js` (le CDN est intercepté) qui expose `EJS_emulator.pause()/play()` et appelle `EJS_onGameStart` : on teste donc TOUT le site, mais pas EmulatorJS lui-même (T0 l'a fait avec de vrais fichiers).

## 1. Verdict global

**La v1 (Amiga + Neo Geo) peut sortir côté site : aucune anomalie bloquante.** 197 vérifications automatiques Chromium passent sur les 3 tailles d'écran (une seule "échec" est un défaut du test, expliqué plus bas), plus 33 de contrôle d'accessibilité, 34 de robustesse, 16 de GitHub Pages et d'hors-ligne.
Réserves : une anomalie moyenne à corriger avant ou juste après la v1 (A1, noms de fichiers avec `#` ou `?`), et tout ce qui demande du vrai matériel (section 8).

## 2. Critères d'acceptation CA-* (desktop 1280x720, téléphone 360x740 et 390x844)

Légende : PASSE = vérifié ici sur les 3 tailles sauf indication ; NV = non vérifiable ici.

| Critère | Verdict | Remarque |
|---|---|---|
| CA-N1 focus à la 1re flèche / 1er appui manette | PASSE | Pas de focus automatique en souris/tactile ; 1re flèche : carte focusée ; manette : réveil + toast "Manette connectée" + focus (voir A3). |
| CA-N2 parcours complet au clavier seul | PASSE | Accueil, grille, Jouer (Entrée), jeu, F10, Droite, Entrée (Quitter), grille avec focus, Échap, accueil avec focus sur la machine. |
| CA-N3 parcours complet à la manette seule | PASSE en simulation | Gamepad API simulée (croix, stick gauche avec répétition, A, B, Start = valider, Select+Start). Vraie manette Xbox sur Chrome desktop et Android : NV. |
| CA-N4 parcours complet au tactile | PASSE en émulation | Chromium en mode mobile avec événements tactiles (tap). Vrai téléphone Android : NV. |
| CA-N5 flèches = voisin visuel, sans bouclage, haut = bouton retour | PASSE | Droite/gauche/haut/bas, bord = on reste, haut depuis la 1re rangée = "< Machines". |
| CA-N6 élément focusé toujours entièrement visible | PASSE | Aussi l'anneau complet (4 px + 3 px) reste dans la fenêtre, et avec 12 machines. |
| CA-N7 bouton précédent du navigateur = retour | PASSE | Grille vers accueil (focus rendu à la machine) ; pendant le jeu : ouvre la confirmation ; pendant la confirmation : Continuer. Geste retour Android : NV. |
| CA-J1 aucune touche de jeu ne quitte | PASSE | Flèches, A/B/X/Y/Z/S, Entrée, Espace, Échap court et maintenu 0,4 s, Start seul et Select seul maintenus 1,3 s, boutons A/B/X/Y manette : aucune confirmation, aucune pause. Les touches du jeu ne sont jamais bloquées par le site (garde en lecture seule). |
| CA-J2 Select+Start 1 s, F10, Échap 1 s, bouton Menu | PASSE | Les 4 ouvrent la confirmation ; `pause()` du moteur appelé. Le son réellement coupé : NV (voir CA-J4). |
| CA-J3 focus par défaut sur Continuer, B/Échap reprennent | PASSE | `role="dialog"`, `aria-modal`, nommé, focus gardé dans la boîte avec Tab (Chromium). |
| CA-J4 après Quitter : grille + focus + visible | PASSE (partie vérifiable) | Retour sur la grille, focus sur la tuile du jeu quitté, visible. Son coupé immédiatement et plein écran quitté : NV (headless, faux moteur ; le site quitte par `location.replace`, donc le déchargement de la page coupe le moteur ; `exitFullscreen` appelé). |
| CA-J5 Menu 48x48, ne recouvre pas les contrôles virtuels | PARTIEL | Menu 94x48 px en haut à gauche (8,8), le rappel de sortie est placé sous lui. Absence de recouvrement avec les vrais contrôles virtuels d'EmulatorJS : NV (faux moteur, vrai téléphone). |
| CA-J6 ROM en échec = message + bouton focusé | PASSE | ROM supprimée ("Jeu introuvable"), BIOS manquant (nom exact donné), CDN injoignable ("EmulatorJS inaccessible"), player.html sans paramètre ou paramètres absurdes : toujours un message et un bouton focusé, jamais d'écran noir. Voir A2 pour un défaut mineur dans ce cas. |
| CA-J7 écran Jouer : focus, Entrée/A/tap, B/Échap/Menu reviennent | PASSE | Voir A3 pour la manette (2 appuis sur A). |
| CA-C1 état vide : chemin exact + bouton focusé | PASSE | `roms/neogeo/` en `code`, formats `.zip`, bouton focusé, pleine largeur au téléphone, Entrée revient à l'accueil. |
| CA-C2 jaquette absente ou cassée = repli | PASSE | Sans jaquette : initiales + couleur machine. Jaquette 404 ou fichier non image : bascule sur le repli. |
| CA-C3 titre long coupé à 2 lignes, nom accessible complet | PASSE | Titre de 135 caractères : 2 lignes, `title` et `aria-label` complets. |
| CA-C4 12 machines sans défilement horizontal | PASSE | 12 cartes, 2 colonnes à 360 px, aucun nom coupé, cibles >= 48 px, focus visible en descendant. |
| CA-V1 focus visible >= 3 px et >= 3:1 | PASSE | 4 px solide cyan #3ee0ff (11:1) sur toutes les cartes, tuiles, boutons, en clavier et en mode manette. |
| CA-V2 contraste texte >= 4.5:1 | PASSE | Calcul sur tout le texte rendu de 9 écrans (accueil, grilles, état vide, Jouer, chargement, erreur, confirmation, bannière, erreur fatale) : 0 écart. Texte `--text` sur les 12 couleurs machine : minimum 4,77:1 (arcade), neogeo 5,59, amiga 5,31. |
| CA-V3 cibles tactiles >= 48x48 | PASSE | Accueil, grille, état vide, Jouer, erreurs, boîte de confirmation, bouton Menu. |
| CA-V4 reduced-motion | PASSE | Aucune transformation, transition ni animation ; défilement instantané ; témoin sans reduced-motion : l'échelle 1.05 existe bien. |
| CA-V5 zoom 200 % | PASSE (équivalent) | Fenêtre 640x360 CSS px à échelle 2 (équivalent à 200 % sur 1280x720) : ni coupure, ni chevauchement, ni débordement (accueil, grille, état vide, Jouer). Le vrai zoom du navigateur n'est pas pilotable. |
| CA-V6 Lighthouse accessibilité >= 95 | NV | Lighthouse n'est pas installé localement. Contrôle manuel équivalent passé (section 5) ; score chiffré à obtenir avec Chrome (onglet Lighthouse) sur l'accueil et une grille. |
| CA-V7 pas de défilement horizontal à 360 px | PASSE | Contrôle de `scrollWidth` et de l'arête droite de chaque élément (le `overflow-x: hidden` du body masquerait un débordement) : accueil, grilles, état vide, Jouer, erreurs, confirmation. |

Test en défaut : "CA-N5 bas jusqu'à la dernière rangée" échoue dans le dernier passage uniquement parce que le script compte mal les colonnes (la tuile focusée est agrandie de 5 %, donc son `top` diffère de ses voisines). Le focus était bien sur l'indice 12 sur 15, dans la dernière rangée. Défaut du test, corrigé dans `ux.mjs`, non rejoué.

## 3. Navigation et entrées

- Clavier : fait (CA-N2). Tab suit l'ordre visuel ; Entrée et Espace valident ; Retour arrière = retour sur les menus.
- Manette simulée : croix, stick gauche (seuil 0,5, répétition), A, B, Start = valider, Select+Start 1 s, anneau de focus en mode manette, réveil au 1er appui. 
- Tactile émulé : tap carte, tuile, Jouer, Menu, Quitter, bouton "<".
- Rappel de sortie : affiché aux 3 premiers lancements puis plus (1,1,1,0,0 sur 5 lancements), lancement possible même si `localStorage` est inaccessible.
- WebKit (moteur de Safari, via Playwright, headless, desktop seulement) : 57 vérifications passent sur le parcours accueil, grille, jeu, sortie. Un échec : le focus ne reste pas dans la boîte de confirmation avec Tab (Safari ne met pas les boutons dans l'ordre de tabulation par défaut, et Playwright WebKit sort alors de la page) ; à revoir sur un vrai Safari. Ce n'est pas un navigateur réel.
- Firefox : le Firefox de Playwright ne démarre pas sur cette machine (délai dépassé au lancement), donc NV.

## 4. Performance (3000 tuiles Amiga fausses)

games.json simulé par interception : 3000 jeux, 3000 tuiles et 3000 logos `<img loading="lazy">` dans la grille. Chromium, 40 flèches alternées, valeurs en millisecondes.

| Condition | Chargement de la grille | Latence flèche (touche vers focus), médiane / p95 / max | Tâches longues (> 50 ms) pendant 40 flèches |
|---|---|---|---|
| Desktop, CPU normal | 341 ms | 18,1 / 23,6 / 33,1 | 0 |
| CPU ralenti x4 (téléphone milieu de gamme) | 1429 ms | 53,3 / 90,7 / 106,7 | 64 (50 à 257 ms) |
| Téléphone 360x740, CPU x4 | 1577 ms | 59,5 / 100,1 / 117,0 | 77 (jusqu'à 262 ms) |
| CPU x6 (bas de gamme, boîtier TV) | 2372 ms | 97,8 / 196,4 / 218,7 | 66 (jusqu'à 446 ms) |

Soupçon du tech-lead sur `getBoundingClientRect` : **partiellement confirmé, mais ce n'est pas la cause principale.** Le calcul de voisinage de `focus-nav.js` (filtre `items()` + lecture des rectangles) coûte, médiane :

| Condition | `items()` (3000 rects) | lecture des rects | lecture des rects après un focus (layout sale) |
|---|---|---|---|
| Desktop x1 | 2,1 ms | 1,3 ms | 1,5 ms |
| x4 | 9,7 ms | 5,3 ms | 11,8 ms |
| x6 | 15,0 ms | 8,1 ms | 10,0 ms |

Soit environ 3 à 4 ms par flèche en desktop (négligeable) et 15 à 25 ms à x4 à x6. Les tâches longues viennent surtout du rendu : trace Chromium à CPU normal sur 20 flèches : `PrePaint` 835 ms, `Commit` 1218 ms, `IntersectionObserver::computeIntersections` 1181 ms, `UpdateLayoutTree` 191 ms, `Layout` 175 ms (la lecture des rectangles force ce layout, ~9 ms par flèche). Le coût par flèche est donc dominé par la peinture et surtout par les observateurs d'intersection des 3000 images `loading="lazy"` (logos de repli sur chaque tuile), et non par `getBoundingClientRect`. À CPU normal, aucune tâche longue : l'usage desktop avec 3000 jeux est fluide. Au repos (aucune touche), 0 tâche longue.
Piste testée à titre indicatif, non retenue comme preuve : `content-visibility: auto` sur `.game-item` fait passer les tâches longues de 66 à 21 (x4), mais une tâche aberrante de 86 s a été mesurée dans cet essai (artefact probable), à reproduire avant de s'y fier. Autre piste : logo de repli en CSS ou en `<img>` unique plutôt qu'une image par tuile. Voir A4.

## 5. Accessibilité (contrôle manuel, Lighthouse absent)

- `lang="fr"`, titre de page, 1 `h1` puis `h2`, repères `header`/`main`, `alt=""` sur toutes les images décoratives, aucun `tabindex`, viewport sans blocage du zoom.
- Noms accessibles (arbre d'accessibilité Chromium) : "Amiga 9 jeux", "Neo Geo 4 jeux", "Retour aux machines", titres de jeux, dialog "Quitter Zool 2 ?" avec boutons "Continuer" et "Quitter". Le lien "Retour aux machines" contient bien son texte visible "Machines" (critère "étiquette dans le nom").
- Ordre de tabulation : ordre du DOM = ordre visuel (retour d'abord, puis les tuiles).
- Régions `role="status"` pour le toast et les bannières.
- prefers-reduced-motion : voir CA-V4.
- Contrastes : voir CA-V2. Le texte est mesuré sur le fond effectif ; le grisé des machines à 0 jeu (filtre `grayscale`) n'est pas visible par le calcul sur styles, mais le gris du fond (#5c6275) donne 5,6:1 avec `--text`.

## 6. GitHub Pages simulé (`/Clone90/`, sans roms/, bios/, games.json)

Serveur de test `tests/recette/subpath-server.mjs` (404 sur roms/, bios/, games.json, tout hors du préfixe).

| Vérification | Verdict |
|---|---|
| Accueil, logos, polices chargés sous `/Clone90/` (chemins relatifs), aucune requête hors du préfixe | PASSE |
| Message "Aucun jeu disponible ici" (explique GitHub Pages et comment jouer chez soi) | PASSE |
| Seule requête en 404 : `games.json` (attendu) ; aucune erreur JavaScript. Le navigateur affiche tout de même une ligne rouge "Failed to load resource" dans la console pour ce 404, inévitable | PASSE |
| Grille d'une machine = état vide avec `roms/amiga/` ; player.html sur un jeu inconnu = message + bouton focusé qui reste dans `/Clone90/` ; machine inconnue = accueil | PASSE |
| Service worker enregistré avec la portée `/Clone90/`, cache `clone90-shell-v2` de 50 entrées (coquille, icônes, police, logos) | PASSE |
| Aucun `roms/`, `bios/`, `games.json` ni ressource du CDN dans le cache, y compris après avoir lu ces fichiers et ouvert l'écran Jouer sur le serveur local | PASSE (2 contextes) |
| Hors ligne : l'application s'ouvre depuis le cache | PASSE (voir A6 pour le message) |
| Manifest : `start_url` et `scope` relatifs résolus sur `/Clone90/`, 4 icônes en 200 | PASSE |
| Page 404 d'une URL inexistante | NV (page propre à GitHub) |
| Installation PWA réelle, déploiement GitHub Pages réel (HTTPS) | NV |

## 7. Sécurité du serveur local et robustesse

Serveur (`curl --path-as-is`) : 403 pour `/.git/*`, `/docs`, `/docs/ux.md`, `/tickets/*`, `/scripts/*`, `/config-equipe/*`, `/package.json`, `/tests/*`, `/CLAUDE.md`, `/README.md`, `/.gitignore`, `/.DS_Store`, `/node_modules`, `/robots.txt`, fichier caché dans `roms/` ; 403 sur les variantes de casse (`/JS/app.js`, `/Package.json`) ; traversées `/../etc/passwd`, `/%2e%2e/`, `/js/..%2fpackage.json`, `//etc/passwd`, `/roms/../docs/ux.md`, antislash : toutes 403 ; `%00` et `%ZZ` : 400 ; POST : 405 ; Range 206 et 416 corrects ; HEAD 200 ; les fichiers de la liste blanche répondent 200. Un lien symbolique placé dans `roms/` et pointant hors du projet est servi (voir A7).

Robustesse (tous PASSE, aucune erreur JavaScript, l'accueil reste utilisable) :
- `games.json` : JSON corrompu, vide, tableau, version 2, HTTP 500 : "Liste des jeux illisible" ; 404 : message GitHub Pages ; `games: []` : "Aucun jeu trouvé" ; entrées avec `..`, chemin absolu, schéma `http:` ou machine inconnue : écartées avec le compte ("4 entrée(s) invalides").
- `systems.json` : illisible, vide, sans machine, id invalide, HTTP 404 : écran d'erreur "Impossible de charger les machines" avec bouton "Réessayer" focusé, sans crash (voir A5 pour le texte).
- Injection : titres `<img onerror>` et `<script>`, `?focus=<script>`, hash absurde, `?focus=` mal encodé : rien n'est exécuté, la grille reste correcte.
- Noms de fichiers (parcours grille, Jouer, jeu, Quitter, retour avec focus sur la bonne tuile, et fichier réellement atteint avec le bon contenu) : PASSE pour espaces, `%` (`100% Dynamite`), accents (`Pinball Dreams ça été`, `Émile`), parenthèses, `&`, `+`, caractères japonais. **ÉCHEC pour `#` et `?`** (A1). Non testés : jaquettes aux noms spéciaux (même fonction `assetUrl`, donc même défaut probable).
- ROM manquante, BIOS manquant, CDN en panne : messages clairs, bouton focusé (CA-J6).

## 8. Anomalies

| N° | Gravité | Bloque la v1 ? | Résumé |
|---|---|---|---|
| A1 | Moyenne | Non (à corriger) | Un fichier dont le nom contient `#` ou `?` est "Jeu introuvable" |
| A2 | Faible | Non | Après un échec de chargement du moteur, le bouton Menu est inerte et le rappel de sortie reste affiché |
| A3 | Faible (décision PO) | Non | Manette : le 1er appui sur chaque nouvelle page est avalé par le réveil (A deux fois sur "Jouer") |
| A4 | Moyenne à partir de ~1000 jeux sur matériel modeste | Non | Grille de 3000 jeux : 50 à 450 ms de blocage par flèche sur CPU lent |
| A5 | Faible | Non | Erreur de systems.json : texte brut anglais du parseur JSON |
| A6 | Faible | Non | Hors ligne, le message dit "games.json illisible. Relancez generate-games" |
| A7 | Faible | Non | Le serveur local suit les liens symboliques hors du projet ; pas d'en-tête nosniff |

**A1. Noms de fichiers avec `#` ou `?` (moyenne, ne bloque pas la v1)**
Étapes : créer `roms/amiga/Turrican II #1.adf` (ou `Quest? Part 1.adf`), `node scripts/generate-games.mjs`, ouvrir la grille Amiga, ouvrir ce jeu.
Obtenu : écran "Jeu introuvable : Le fichier roms/amiga/Turrican II #1.adf n'existe plus. Relancez node scripts/generate-games.mjs". Le jeu est donc injouable.
Attendu : le jeu se lance comme les autres.
Cause probable : `assetUrl` (js/data.js) utilise `encodeURI`, qui laisse `#` et `?` intacts ; le navigateur les lit alors comme début du fragment ou de la requête, et la requête HEAD de contrôle (`headExists`) puis `EJS_gameUrl` visent un autre fichier. Encoder chaque segment du chemin avec `encodeURIComponent` règle le cas (`%`, espaces, accents, `&`, `+` marchent déjà). Les jaquettes passent par la même fonction. Les romsets Neo Geo (noms courts sans `#`) ne sont pas touchés ; les noms de ROMs Amiga du commerce contiennent parfois `#`.
Le correctif n'est pas demandé par le testeur : décision du PO.

**A2. Échec du moteur après "Jouer" (faible, ne bloque pas)**
Étapes : bloquer `cdn.emulatorjs.org` (ou couper internet), ouvrir un jeu, cliquer "Jouer".
Obtenu : message "Impossible de lancer ce jeu" + "Revenir à la liste" focusé (conforme CA-J6), mais le bouton Menu reste affiché et ne fait rien (clic, F10 : aucune confirmation), le bandeau "Quitter : Select + Start (maintenir) - F10 - bouton Menu" reste affiché par-dessus l'erreur, et le bouton Retour du navigateur demande 2 appuis (une entrée "sentinelle" a été ajoutée à l'historique).
Attendu : pas de Menu inerte ni de bandeau trompeur sur l'écran d'erreur.
Cause probable : `requestExit` (player-main.js) ne traite que les phases `playing`, `dialog`, `ready`, pas `error`.

**A3. Réveil de la manette à chaque page (faible, décision PO)**
Étapes : manette (simulée) : sur l'accueil, ouvrir un jeu avec A, arriver sur "Jouer", appuyer sur A.
Obtenu : le 1er A ne fait que "réveiller" (toast "Manette connectée") ; il faut un 2e A. Idem à l'arrivée sur la grille après "Quitter" (le 1er B est avalé). C'est conforme à ux.md 4.2, mais les navigateurs ne montrent la manette à une nouvelle page qu'au 1er appui, donc ce réveil se reproduit à chaque changement de page (accueil, player.html).
Attendu (suggestion) : à décider par le PO. Peut-être ne pas avaler l'appui quand un élément focusé existe déjà (bouton Jouer), à valider avec une vraie manette.

**A4. Performance avec beaucoup de jeux (moyenne, ne bloque pas la v1 avec quelques dizaines de jeux)**
Étapes : générer 3000 fichiers Amiga, ouvrir la grille, naviguer avec les flèches, CPU ralenti x4 (outils de développement).
Obtenu : chiffres de la section 4 : fluide en desktop (18 ms), 50 à 450 ms de blocage par flèche sur CPU lent. Le coût de `getBoundingClientRect` est de 3 à 4 ms (desktop) : ce n'est pas la cause principale (peinture et 3000 images `lazy` observées).

**A5. Texte d'erreur de systems.json (faible)**
Obtenu : "systems.json illisible : Expected property name or '}' in JSON at position 1 (line 1 column 2)" ou "Unexpected end of JSON input" (anglais technique). Le conseil "Ouvrez le site avec le serveur local... http://localhost:8080" est correct mais cite le port 8080 même sur un autre port.

**A6. Message hors ligne (faible)**
Étapes : ouvrir l'application (installée ou en cache), couper le réseau, recharger.
Obtenu : l'accueil s'affiche, mais la bannière dit "Liste des jeux illisible. games.json est illisible. Relancez node scripts/generate-games.mjs". Le vrai problème est l'absence de réseau.

**A7. Serveur local (faible)**
Obtenu : un lien symbolique `roms/amiga/x.adf` vers un fichier hors du projet est servi (200). Aucune protection contre un lien créé par l'utilisateur lui-même, donc sans conséquence pour un usage personnel ; à noter car le serveur écoute sur toutes les interfaces. Aucun en-tête `X-Content-Type-Options: nosniff`.

## 9. À faire avec du vrai matériel (non vérifiable ici)

- Firefox (desktop) : le Firefox de Playwright ne démarre pas ici. Safari réel (macOS et iOS), y compris Tab dans la boîte de confirmation (WebKit headless a échoué sur ce point).
- Vrai téléphone Android (Chrome) : parcours tactile, geste Retour système, plein écran, installation PWA (HTTPS seulement), position du bouton Menu par rapport aux contrôles virtuels réels d'EmulatorJS (CA-J5), orientation portrait et paysage, clavier virtuel.
- Vraie manette (Xbox ou compatible) sur Chrome desktop et sur Android : numérotation des boutons, Select+Start 1 s, réveil au premier appui (A3), vibrations ou conflits du système.
- Vrais ROMs et BIOS : validation par T0 pour Neo Geo (Viewpoint) ; restent ouverts : Kickstart `kick40068.A1200` retrouvé par puae, fichiers IPF et multi-disquettes, son réellement coupé à la sortie, sortie du plein écran, et F10 / Échap maintenu avec le vrai moteur en plein écran.
- Lighthouse (score chiffré CA-V6) avec Chrome.
- Zoom réel du navigateur à 200 % (équivalent simulé seulement).
- Déploiement réel sur GitHub Pages (HTTPS, page 404 propre, installation PWA).
- Reprise hors ligne d'un cœur EmulatorJS déjà chargé (cache propre à EmulatorJS, noté dans le README).

## 10. Incident pendant la recette

Avant de recevoir la consigne de ne pas toucher à `roms/` et `bios/`, j'avais créé de FAUX fichiers (2 octets) dans le vrai dossier : 9 `.adf` dans `roms/amiga/`, 4 faux romsets dans `roms/neogeo/`, `bios/kick40068.A1200` et un faux `bios/neogeo.zip`, et j'avais lancé `generate-games.mjs` une fois (écriture de `games.json`). Hicham a ensuite déposé ses vrais fichiers (qui ont remplacé mes faux `neogeo.zip` et romsets). Après la consigne, j'ai supprimé uniquement mes 9 faux `.adf` (taille vérifiée à 2 octets), le dossier `roms/amiga` devenu vide et `bios/kick40068.A1200`. Je n'ai jamais supprimé de vrai fichier. Le `games.json` du vrai dossier reste celui généré par mon essai (faux jeux) : Hicham doit relancer `node scripts/generate-games.mjs`. Tout le reste de la recette a tourné dans une copie hors dépôt.
