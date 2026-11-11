# T25 : bouton « Dossiers des jeux »

**Dépend de** : T23, T24
**Branche** : `ticket/T25-bouton-dossiers` - **Version** : 0.25.0

## Demande
Hicham : « est-ce que je peux avoir un bouton dans l'interface pour choisir les dossiers bios et roms ? »

## Réalisation
- `scripts/settings-api.mjs` : API locale. `GET /api/settings` (dossiers utilisés et s'ils sont ceux du projet), `POST /api/settings/choose` avec `{ "kind": "roms" | "bios" | "bios-default" }`. La boîte « choisir un dossier » du Mac s'ouvre côté serveur (`scripts/mac-folder-dialog.mjs`, osascript), le dossier est validé par `folderProblemKind` (`local-settings.mjs`, mêmes refus que T23 : dossier trop large, introuvable), écrit par `updateLocalSettings`, `games.json` est régénéré par `runGenerate` (appel direct) et les dossiers sont appliqués au serveur sans redémarrage (`server.setFolders`).
- Sécurité : API active seulement si le serveur écoute en local (`--host 127.0.0.1`, lanceur) et sous macOS (`isSettingsApiEnabled`), sinon 404. Chaque requête : en-tête `Host` = `localhost:<port>` ou `127.0.0.1:<port>` (anti DNS rebinding, sinon 403) ; `Origin` identique, ou absente avec `X-Clone90: 1` pour POST (sinon 403) ; `Content-Type: application/json` (415) ; corps de 1 Ko au plus (413) ; corps `{ "kind": ... }` exactement, aucune autre clé donc jamais de chemin du navigateur (400) ; une seule boîte à la fois (409). Réponses `no-store` et `nosniff`.
- Interface : bouton « Dossiers des jeux » sous les machines, seulement si `GET api/settings` répond (jamais sur GitHub Pages ni en mode réseau). Panneau (`js/ui/folders-panel.js`, sur `js/ui/dialog.js` généralisé en `createDialog`) : dossiers actuels, « Choisir le dossier des ROMs », « Choisir le dossier des BIOS », « BIOS du projet », « Fermer ». Message « Une fenêtre de choix s'est ouverte sur votre Mac. » pendant le choix (zone `role="status"`). Après succès : `games.json` rechargé et accueil redessiné.
- `sw.js` : `api/` ajouté à `NEVER_CACHED`, nouveaux modules dans la coquille.
- `Choisir le dossier des jeux.command` conservé comme secours. README, `docs/guide.md`, `docs/ux.md`, `docs/architecture.md`, READMEs.
- Tests : `tests/settings-api.test.mjs` (API, chaque refus, verrou, boîte du Mac factice), `tests/folders-panel.test.mjs` (client, panneau, bouton, boîte générique, service worker).

## Vérification manuelle (non faite par le dev : aucun navigateur, serveur ni osascript lancés)
1. `Lancer Clone90.command` : le bouton « Dossiers des jeux » apparaît sous les machines.
2. Cliquer, choisir un dossier de ROMs : une fenêtre du Mac s'ouvre (elle peut passer derrière le navigateur : à vérifier), le message s'affiche, puis l'accueil montre les jeux du dossier choisi sans redémarrage.
3. Annuler la fenêtre : « Aucun changement. » Choisir le dossier personnel ou un disque entier : refus avec message.
4. « BIOS du projet » : retour à `bios/`.
5. Navigation clavier (flèches, Entrée, Échap) et manette dans le panneau.
6. Sur GitHub Pages et depuis un téléphone (réseau local) : aucun bouton.
