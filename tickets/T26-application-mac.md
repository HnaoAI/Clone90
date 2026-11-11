# T26 : Application Mac Clone90.app (lancer sans fenêtre Terminal)

**Dépend de** : T20, T20b
**Branche** : `ticket/T26-application-mac`
**Demandé par** : le PO, pour Hicham : ne plus voir la fenêtre Terminal du lanceur.

## Réalisation
- `Clone90.app` à la racine, **commitée** (Hicham double-clique sans rien construire). Reconstruction : `bash scripts/build-mac-app.sh` (source : `scripts/mac-app/Clone90.applescript`, `osacompile -s`, applet « stay open »).
- `on run` : dossier du projet = dossier parent de l'app ; Node.js cherché dans /usr/local/bin, /opt/homebrew/bin et le PATH (sinon boîte de dialogue et lien nodejs.org) ; si une page « Clone90 » répond déjà sur http://localhost:8080/, on ouvre seulement la page ; sinon `generate-games.mjs` puis `serve.mjs --host 127.0.0.1` en arrière-plan (journal `~/Library/Logs/Clone90.log`), pid mémorisé, attente de 10 s au plus, puis ouverture de la page.
- `on quit` : arrête le serveur lancé par l'application, par son pid et seulement si ce pid est encore `serve.mjs`. `on reopen` (icône du Dock) : rouvre la page.
- Aucun mot de passe, aucun réglage du Mac, rien sur le réseau. Ni l'app ni `scripts/mac-app` ne sont servies (liste blanche) ni mises en cache.
- `Lancer Clone90.command` reste la solution de secours. README et guide : première ouverture (clic droit, Ouvrir), Dock, quitter, quarantaine (`xattr -dr com.apple.quarantine`).
- `tests/mac-app.test.mjs`. `js/version.js` : 0.26.0.

## Critères d'acceptation
1. La source AppleScript contient les étapes (Node, generate-games, serve 127.0.0.1, ouverture, détection d'un Clone90 déjà lancé, arrêt par pid).
2. Le bundle existe (Info.plist, exécutable applet) et le script de construction passe `bash -n`.
3. Le serveur local ne sert ni `Clone90.app` ni `scripts/mac-app`; le service worker non plus.
4. README et guide documentent l'usage.

## Vérification manuelle (Hicham)
Clic droit sur Clone90.app, Ouvrir, Ouvrir : le navigateur s'ouvre sur Clone90, sans fenêtre Terminal. Clic sur l'icône du Dock : la page s'ouvre. Cmd + Q : la page ne répond plus. Sans Node.js : boîte de dialogue en français.
