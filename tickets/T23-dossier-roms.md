# T23 : choisir le dossier des ROMs et des BIOS

**Dépend de** : T20
**Branche** : `ticket/T23-dossier-roms` - **Version** : 0.23.0

## Demande
Hicham : « peut-on aussi choisir le chemin du dossier qui contient les roms ? »

## Réalisation
- `clone90.local.json` (racine, ignoré par git, jamais servi) : `romsDir` et `biosDir` facultatifs (chemins absolus). Lu et validé par `scripts/local-settings.mjs` (chemin non absolu ou inexistant : avertissement en français et repli sur `roms/` ou `bios/` du projet ; jamais d'exception).
- `scripts/generate-games.mjs` scanne `romsDir`, cherche les BIOS requis dans `biosDir` et affiche les dossiers utilisés. Les chemins de `games.json` restent `roms/<machine>/...` : rien ne change côté navigateur, service worker ou GitHub Pages.
- `scripts/serve.mjs` : options `romsDir` et `biosDir` de `createStaticServer`. Même liste blanche, realpath du dossier choisi comme racine autorisée (règle T11), 403/404 propres.
- `Choisir le dossier des jeux.command` : boîtes de dialogue du Mac (ROMs, puis BIOS ou « Garder bios/ du projet »), écriture par `node scripts/local-settings.mjs set` (fusion, sans détruire les autres clés), résumé, attente d'une touche. Annuler : rien n'est écrit.
- `Lancer Clone90.command` : affiche les dossiers via le générateur (aucun autre changement).
- README, `docs/guide.md`, `docs/architecture.md`, README de `scripts/` et `tests/`.
- Tests : `tests/local-settings.test.mjs`, `tests/serve-dossiers.test.mjs`, `tests/choisir-dossier-mac.test.mjs`.

## Vérification manuelle (non faite par le dev : aucune exécution des .command)
1. Double-clic (première fois : clic droit, Ouvrir) sur `Choisir le dossier des jeux.command`, choisir un dossier de ROMs (sous-dossiers `amiga/`, `neogeo/`), garder bios/ : le résumé s'affiche.
2. Annuler à chaque étape : `clone90.local.json` inchangé.
3. `Lancer Clone90.command` : la ligne « Dossier des ROMs : ... » s'affiche, les jeux du dossier choisi apparaissent et se lancent.
4. Supprimer `clone90.local.json` : retour à `roms/` du projet.
