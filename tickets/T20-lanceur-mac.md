# T20 : Lancer Clone90 sur Mac sans Terminal

**Dépend de** : T1, T17
**Branche** : `ticket/T20-lanceur-mac`
**Demandé par** : le PO (délégation de Hicham) : « y a pas un moyen plus simple que le terminal ? »

## Besoin
Un double-clic dans le Finder suffit pour jouer.

## Réalisation
- `Lancer Clone90.command` (racine, exécutable) : va dans son dossier, vérifie Node.js (sinon message et lien https://nodejs.org), lance `generate-games.mjs`, ouvre la page si Clone90 tourne déjà sur le port 8080, sinon démarre `serve.mjs`, attend la réponse (5 s au plus), ouvre http://localhost:8080/ et reste au premier plan : fermer la fenêtre arrête le serveur.
- Aucun mot de passe, aucun réglage du Mac, rien d'envoyé sur le réseau, aucune dépendance.
- Le serveur local ne le sert pas (liste blanche, 403) ; il n'est pas dans le service worker.
- `docs/guide.md` et `README.md` : section « Lancer sans Terminal » (première ouverture : clic droit, Ouvrir).
- `tests/launcher-mac.test.mjs`. `js/version.js` : 0.20.0.

## Critères d'acceptation
1. Le fichier existe, est exécutable et passe `bash -n`.
2. Il contient les étapes cd, generate-games, serve, open.
3. Il n'est ni servi (403/404) ni mis en cache.
4. Le guide et le README expliquent l'usage et la première ouverture.

## Vérification manuelle (Hicham)
Double-cliquer sur le fichier (clic droit, Ouvrir la première fois) : le navigateur s'ouvre sur Clone90. Fermer la fenêtre : la page ne répond plus.
