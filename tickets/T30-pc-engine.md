# T30 : PC Engine et PC Engine CD

**Branche** : `ticket/T30-pc-engine` - **Version** : 0.30.0
**Demandé par** : Hicham (2026-11-12) : « c'est possible d'avoir la pc engine ? »

## Besoin
Jouer aux jeux PC Engine (TurboGrafx-16, SuperGrafx) et PC Engine CD, comme les autres machines : dossier dans les ROMs, tuile sur l'accueil, logo maison, vrai logo téléchargeable, pochettes, « Mes fichiers » sur téléphone.

## Vérifié dans EmulatorJS 4.2.3 (2026-11-12, paquets npm `@emulatorjs/emulatorjs` et `@emulatorjs/core-mednafen_pce` 4.2.3)
- Alias `pce` -> cœur `mednafen_pce` (Beetle PCE, version complète : PC Engine, SuperGrafx et CD dans le même cœur).
- `core.json` : `pce, cue, ccd, iso, img, bin, chd` ; `valid_extensions` du cœur (wasm) : `pce|sgx|cue|ccd|chd|toc|m3u`.
- BIOS CD cherchés par le cœur : `syscard3.pce` (défaut, System Card 3), `syscard2.pce`, `syscard1.pce`, `gexpress.pce`. Un BIOS passé à `EJS_biosUrl` est écrit à la racine du système de fichiers du cœur sous son nom.

## Choix
- **Deux machines**, comme Mega Drive et Mega-CD : `pcengine` (cartes HuCard : `.pce`, `.sgx`, `.zip`) et `pcenginecd` (`.cue` + ses `.bin`, `.chd`). Les pochettes libretro sont rangées dans deux bases distinctes, et le BIOS n'est nécessaire que pour les CD.
- `pcenginecd` : `syscard3.pce` **requis** (BIOS par défaut, passé à `EJS_biosUrl`) : sans lui aucun CD ne démarre, message en français.
- Pochettes : `NEC_-_PC_Engine_-_TurboGrafx_16` et `NEC_-_PC_Engine_CD_-_TurboGrafx-CD` (libretro-thumbnails, vérifiées en lecture).
- Vrais logos (es-theme-carbon, commit figé) : `pcengine` et `tg-cd` (le thème n'a pas de dossier `pcenginecd` à ce commit). Le nom de dossier du thème accepte désormais un tiret.
- Pas de `.iso` ni de `.zip` pour le CD (non listés par le cœur, ou zip de cue+bin non vérifié).

## Critères d'acceptation
1. `systems.json` contient `pcengine` et `pcenginecd`, alias `pce`, extensions acceptées par le cœur `mednafen_pce` (ou `zip`).
2. `pcenginecd` déclare `syscard3.pce` requis (BIOS par défaut) ; `pcengine` n'a aucun BIOS.
3. Chaque nouvelle machine a sa couleur d'accent (contraste 4.5:1 avec le texte), son logo maison généré, son dépôt de pochettes et son dossier de logo.
4. Un `.cue` PC Engine CD et ses `.bin` donnent UN jeu (même règle que le Mega-CD).
5. Le téléchargement des logos accepte un dossier de thème avec tiret (`tg-cd`) et refuse toujours `..`, `/` ou des majuscules.
6. Version 0.30.0.

## Vérification manuelle (Hicham)
1. Créer `roms/pcengine/` et y mettre un `.pce` ; relancer Clone90 : la tuile PC Engine affiche le jeu, il démarre.
2. Pour les CD : `roms/pcenginecd/` (le `.cue` et ses `.bin`, ou un `.chd`) et `bios/syscard3.pce`.
3. « Dossiers des jeux » : « Télécharger les pochettes » puis « Télécharger les logos des machines » : les deux nouvelles machines ont leur logo.
