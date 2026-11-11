# T15 : Activer les 10 autres machines (vague 2)

**Dépend de** : T0 à T14
**Branche** : `ticket/T15-autres-machines`
**Demandé par** : le PO (délégation de Hicham).

## Besoin
Arcade, Master System, Mega Drive, Game Gear, Mega-CD, 32X, NES, Super Nintendo, Game Boy, Game Boy Color sont dans `systems.json` (`wave: 2`) mais jamais vérifiées contre EmulatorJS 4.2.3. Les vérifier dans le source, corriger `systems.json` (seule source de vérité), les afficher (`MAX_VISIBLE_WAVE = 2` ; sans jeu elles restent grisées).

## Périmètre
- Vérification par machine : cœur réellement chargé, `core.json` du cœur sur le CDN 4.2.3 (`useKeyboard`, `retroarchOpts`, extensions), threads, BIOS (nom exact, obligatoire ou non, quand le cœur s'en sert). Résultat dans `docs/architecture.md` section 2 et 3.3.
- Mega-CD : un `.cue` et ses fichiers (`.bin`, audio) forment UN jeu (le générateur lit les lignes `FILE` du `.cue`, comme il lit un `.m3u`) ; le lanceur pose les fichiers du `.cue` à côté du `.cue` dans le système de fichiers du cœur.
- BIOS à poser en plus (Mega-CD : les trois régions ; Game Boy/Color ; NES `disksys.rom`) : champ `preload` d'une entrée `bios` de `systems.json`.
- README : section par machine. `data/titles.json` : rien à ajouter (déjà fourni pour l'arcade).

## Hors périmètre
- Parent/clone des romsets arcade (`EJS_gameParentUrl`), SGB, Sega CD multi-disque `.m3u`, options de cœur.

## Risques ouverts
- Mega-CD cue+bin : un `.bin` (300 à 700 Mo) est lu en `Uint8Array` puis recopié dans le système de fichiers du cœur ; peut dépasser la mémoire WebAssembly sans message utile. Chargement séquentiel conservé. Recommandé : `.chd` ou `.iso`. Non testé avec de vrais fichiers.
- Mega-CD : au moins un des trois BIOS est exigé (`biosAtLeastOne`), message en français sinon.
- Raccourcis RetroArch à nul pour toutes les machines par défaut (décision tech-lead, revue T15) ; `disableRetroArchHotkeys: false` pour l'ôter. Le test T14 « Neo Geo : aucun raccourci touché » est remplacé en conséquence (changement de spécification, pas un affaiblissement).

## Critères d'acceptation
1. Chaque machine a un cœur EmulatorJS connu d'EmulatorJS 4.2.3, des extensions que ce cœur accepte (ou l'archive `zip`), et aucune machine n'est en double.
2. Les BIOS déclarés sont cohérents (noms exacts de leur cœur, `preload` seulement pour des fichiers dont le cœur se sert).
3. Un `.cue` et ses `.bin` donnent UN jeu (`extraFiles`), les `.bin` ne sont pas listés à part ; `.bin` orphelin ignoré avec avertissement ; `.bin` manquant signalé.
4. Le lanceur pose les `extraFiles` et les BIOS `preload` présents (rien pour un BIOS absent), sans toucher à `EJS_biosUrl`.
5. `MAX_VISIBLE_WAVE` vaut 2.

## Vérification manuelle (Hicham)
Voir le rapport de fin de ticket.
