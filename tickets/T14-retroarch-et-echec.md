# T14 : Raccourcis natifs de RetroArch et échec de démarrage

**Dépend de** : T7, T10, T12
**Branche** : `ticket/T14-retroarch-et-echec`
**Demandé par** : le PO (délégation de Hicham). Contexte : `docs/diagnostic-neogeo-lent.md` section 7 (fichier non suivi par git).

## Besoin
A. Quand "Direct Keyboard Input" est actif (Amiga), les raccourcis par défaut de RetroArch se déclenchent : F1 menu, Échap quitter, F9 muet (conflit avec notre raccourci disquette T12), Espace avance rapide, P pause, F plein écran, H reset, etc.
B. `EJS_onGameStart` est appelé même quand le cœur refuse le contenu : RetroArch affiche alors son menu natif sur fond noir et la personne reste bloquée. Il faut notre écran d'erreur en français.

## Partie A : retroarch.cfg
- `js/player/retroarch-cfg.js` (nouveau, seule source de vérité) fabrique le texte de `retroarch.cfg`. Il est posé par `EJS_externalFiles` à `/home/web_user/.config/retroarch/retroarch.cfg` : EmulatorJS 4.2.3 écrit son propre fichier dans le constructeur de `EJS_GameManager`, puis `loadExternalFiles()` (qui écrase), puis `callMain` (GameManager.js l.38, emulator.js `downloadFiles`).
- Les 11 lignes d'origine de `getRetroArchCfg` (4.2.3) sont recopiées à l'identique (sans les 2 lignes de rembobinage, ni `retroarchOpts`, voir limites).
- Si la machine a `"disableRetroArchHotkeys": true` dans `systems.json` (Amiga seulement) : une ligne `input_<action> = "nul"` par raccourci (liste complète des "meta binds" de `configuration.c`, pas seulement ceux qui ont une touche par défaut).
- Journal d'erreurs (pour la partie B) : `log_verbosity = true`, `frontend_log_level = 3`, `libretro_log_level = 3` (erreurs seulement, donc quasi aucun coût).
- Le clavier du jeu (taper, touches F du jeu) n'est pas touché : seuls les raccourcis RetroArch (`input_<meta>`) sont mis à nul, pas les touches du clavier émulé.

## Partie B : échec de démarrage
- Signal retenu : une ligne d'erreur du chargeur de contenu de RetroArch, `[ERROR] [Content]: ...` (ex. "Failed to load content"), lue dans la sortie du cœur (`print`/`printErr`) interceptée dans `js/player/ejs-start-watch.js`. Les lignes `[libretro ERROR]` qui précèdent (ex. FBNeo "ROM ... is missing") donnent la raison.
- Pourquoi : c'est une preuve positive de l'échec (elle n'existe que si le cœur a refusé le contenu). Aucun minuteur ne décide d'un échec, donc aucun faux positif sur un chargement lent. Les lignes ne sont écoutées que jusqu'à 15 s après `EJS_onGameStart` (`START_WATCH_MS`), pour ne pas relire des erreurs tardives et sans rapport.
- Écran d'erreur : « Ce jeu n'a pas pu démarrer » + raison en français + détail technique, bouton « Revenir à la liste », phase `error` (sortie en un appui, T11/A2).

## Critères d'acceptation
1. Le cfg contient les lignes d'origine, identiques et dans l'ordre.
2. Amiga : toutes les actions de raccourci sont à "nul". Neo Geo et autres : aucune.
3. Le cfg est posé via `EJS_externalFiles` (octets) au bon chemin, pour toute machine.
4. Une ligne `[ERROR] [Content]` déclenche `onFailure` une fois, avec les messages du cœur qui précèdent.
5. Aucun faux positif : lignes normales, erreurs sans `[Content]`, démarrage lent sans ligne, lignes après la fenêtre d'écoute.
6. Le hook ne casse pas `EJS_Runtime` (appel, retour, options `print`/`printErr` d'origine toujours appelées).
7. Écran d'erreur : titre, raison (fichier manquant/incorrect si le cœur le dit), détail technique, sortie en un appui.

## Limites connues
- Le cfg remplace celui d'EmulatorJS : `retroarchOpts` du `core.json` du cœur (vide pour puae et fbneo, VÉRIFIÉ) et le rembobinage (réglage EmulatorJS) ne sont plus appliqués. À revérifier pour chaque nouvelle machine (`core.json` du `.data` du cœur).
- Dépend de la version épinglée du CDN (4.2.3).

## Vérification manuelle (Hicham)
Voir le rapport de fin de ticket.
