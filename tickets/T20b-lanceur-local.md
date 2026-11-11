# T20b : Lanceur Mac limité à ce Mac, attente fiable

**Dépend de** : T20 (corrections de la revue du tech-lead, mergé avant la revue)
**Branche** : `ticket/T20b-lanceur-local`

## Réalisation
- `scripts/serve.mjs` : option `--host` (et variable `HOST`), défaut 0.0.0.0 inchangé (téléphone Android). L'adresse « Réseau local » n'est annoncée que si l'hôte n'est pas local.
- `Lancer Clone90.command` : lance `serve.mjs --host 127.0.0.1` (arbitrage du PO : le double-clic n'expose pas les jeux sur le réseau). La boucle d'attente ne sort que si la page contient « Clone90 » ; sinon message clair (port 8080 pris par un autre programme) et attente d'une touche.
- Guide et README : pour le téléphone, lancer à la main `node scripts/serve.mjs`, sur un réseau de confiance seulement, jamais sur un Wi-Fi public.
- Tests : `tests/serve-port.test.mjs` (hôte, défaut, adresses locales), `tests/launcher-mac.test.mjs`. Version 0.20.1.

## Vérification manuelle
Double-clic : page ouverte ; le téléphone ne peut plus s'y connecter. Avec un autre programme sur 8080 : message d'erreur, pas de page ouverte.
