# T14 : Raccourcis natifs de RetroArch et échec de démarrage

**Dépend de** : T7, T10, T12
**Branche** : `ticket/T14-retroarch-et-echec`
**Demandé par** : le PO (délégation de Hicham). Contexte : `docs/diagnostic-neogeo-lent.md` section 7 (fichier non suivi par git).

## Besoin
A. Quand "Direct Keyboard Input" est actif (Amiga), les raccourcis par défaut de RetroArch se déclenchent : F1 menu, Échap quitter, F9 muet (conflit avec notre raccourci disquette T12), Espace avance rapide, P pause, F plein écran, H reset, etc.
B. `EJS_onGameStart` est appelé même quand le cœur refuse le contenu : RetroArch affiche alors son menu natif sur fond noir et la personne reste bloquée. Il faut notre écran d'erreur en français.

## Partie A : retroarch.cfg (arbitrage du PO : AJOUTER des lignes, ne pas remplacer le fichier)
- `js/player/retroarch-cfg.js` (seule source de vérité) fabrique les lignes à AJOUTER et surcharge `EJS_GameManager.prototype.getRetroArchCfg` pour les ajouter au texte qu'EmulatorJS produit. Rien d'EmulatorJS n'est recopié : rembobinage et `retroarchOpts` des cœurs sont conservés.
- Moment (VÉRIFIÉ, 4.2.3) : loader.js charge tous ses scripts, dont GameManager.js qui pose `window.EJS_GameManager` (l.464), puis fait `window.EJS_emulator = new EmulatorJS(...)` (loader.js l.150). Notre accesseur sur `EJS_emulator` surcharge le prototype à cet instant. `new window.EJS_GameManager(...)` n'a lieu que plus tard, dans `downloadFiles` (emulator.js l.918), et son constructeur appelle `this.getRetroArchCfg()` (GameManager.js l.38) : la surcharge est donc posée avant.
- Champ `disableRetroArchHotkeys: true` dans `systems.json` (Amiga seulement) : une ligne `input_<action> = "nul"` par raccourci (tous les "meta binds" de `configuration.c`).
- Journal d'erreurs (partie B), pour toute machine : `log_verbosity = true`, `frontend_log_level = 3`, `libretro_log_level = 3`.
- Le clavier du jeu n'est pas touché : seuls les raccourcis RetroArch sont mis à nul.

## Partie B : échec de démarrage
- Signal retenu : une ligne d'erreur du chargeur de contenu de RetroArch, `[ERROR] [Content]: ...` (ex. "Failed to load content"), lue dans la sortie du cœur (`print`/`printErr`) interceptée dans `js/player/ejs-start-watch.js`. Les lignes `[libretro ERROR]` qui précèdent (ex. FBNeo "ROM ... is missing") donnent la raison.
- Pourquoi : c'est une preuve positive de l'échec (elle n'existe que si le cœur a refusé le contenu). Aucun minuteur ne décide d'un échec, donc aucun faux positif sur un chargement lent. Les lignes ne sont écoutées que jusqu'à 15 s après `EJS_onGameStart` (`START_WATCH_MS`), pour ne pas relire des erreurs tardives et sans rapport.
- Écran d'erreur : « Ce jeu n'a pas pu démarrer » + raison en français + détail technique, bouton « Revenir à la liste », phase `error` (sortie en un appui, T11/A2).

## Critères d'acceptation
1. Nos lignes sont ajoutées sans doublon ni ligne vide ; aucune ligne d'EmulatorJS n'est recopiée.
2. Amiga : toutes les actions de raccourci sont à "nul". Neo Geo et autres : aucune.
3. `getRetroArchCfg` est surchargé avant la création du GameManager, le texte d'EmulatorJS est conservé à l'identique et nos lignes sont à la fin.
4. Une ligne `[ERROR] [Content]` déclenche `onFailure` une fois, avec les messages du cœur qui précèdent.
5. Aucun faux positif : lignes normales, erreurs sans `[Content]`, démarrage lent sans ligne, lignes après la fenêtre d'écoute.
6. Le hook ne casse pas `EJS_Runtime` (appel, retour, options `print`/`printErr` d'origine toujours appelées).
7. Écran d'erreur : titre, raison (fichier manquant/incorrect si le cœur le dit), détail technique, sortie en un appui.

## Limites connues
- Dépend de la version épinglée du CDN (4.2.3) : nom `getRetroArchCfg` et classe `window.EJS_GameManager`. Si l'un manque, on ne fait rien (avertissement console) : pas de raccourcis neutralisés et pas de détection d'échec, jamais de plantage.
- HYPOTHÈSE à vérifier par Hicham : `stderr` de RetroArch arrive à `printErr` et la ligne est bien `[ERROR] ... [Content]: ...` (test avec un zip volontairement invalide, avec l'accord de Hicham).

## Vérification manuelle (Hicham)
Voir le rapport de fin de ticket.
