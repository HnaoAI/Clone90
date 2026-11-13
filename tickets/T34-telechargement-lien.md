# T34 : Télécharger depuis une page web

**Branche** : `ticket/T34-telechargement-lien` - **Version** : 0.34.0
**Demandé par** : Hicham (2026-11-13) : « Peux-tu faire un menu avant qui me demande la page du site à chercher ? et je donne le lien que je veux comme source ? »
Plan validé par Hicham le 2026-11-13 (`plans/T34-telechargement-par-lien.md` des fichiers du projet).

## Besoin
Un écran qui demande l'adresse d'une page web (la source choisie par Hicham), liste les fichiers de types reconnus par Clone90 (ROMs, BIOS, .zip), laisse cocher ceux à télécharger avec leur machine, puis les range au bon endroit. Outil neutre : aucune source écrite dans le code.

## Critères d'acceptation
1. Écran `#/telecharger` « Depuis une page web », ouvert depuis l'accueil (bouton) et depuis « Mes fichiers » ; avertissement « Télécharge uniquement des fichiers dont tu as le droit de disposer. »
2. Seules les extensions de `systems.json` et les noms de BIOS déclarés sont proposés ; machine devinée par l'extension puis par les mots du chemin (id et noms de `systems.json`), modifiable ; un fichier sans machine devinée n'est pas coché.
3. Sur le Mac, le serveur local lit la page et télécharge (API locale existante, mêmes contrôles) : http(s) seulement, adresses locales et privées refusées (IPv4, IPv6, IPv4 dans IPv6), connexion vers l'adresse vérifiée (anti DNS rebinding), redirections revérifiées (5 au plus), page de 2 Mo et fichier de 1 Go au plus, 200 fichiers par lot.
4. Fichiers écrits dans `roms/<machine>/` ou `bios/` (dossiers choisis compris), jamais d'écrasement, fichier temporaire supprimé en cas d'échec ; `games.json` régénéré ; résumé (téléchargés, déjà présents, échecs).
5. Sur téléphone ou GitHub Pages : lecture directe si le site l'autorise (CORS), fichiers dans « Mes fichiers » ; sinon message clair qui renvoie vers le Mac.
6. Connexion seulement au clic, aucun cookie ni référent envoyé, aucune télémétrie (règle 5, exception (c)).

## Vérification manuelle (Hicham)
1. Sur le Mac : accueil, « Depuis une page web », coller l'adresse d'une page qui propose des fichiers que tu as le droit d'avoir, « Analyser ». Vérifier la liste et les machines, choisir celles qui manquent, « Télécharger la sélection ». Le résumé s'affiche, les jeux apparaissent dans leur machine.
2. Recommencer : « Déjà présents ».
3. Sur le téléphone (site Pages) : même chose ; selon le site, soit les fichiers arrivent dans « Mes fichiers », soit le message renvoie vers le Mac.
