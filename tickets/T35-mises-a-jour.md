# T35 : mises à jour automatiques de Clone90

**Branche** : `ticket/T35-mises-a-jour` - **Version** : 0.35.0
**Demandé par** : Hicham (2026-11-13) : « ajoute un mécanisme pour vérifier les mises à jour disponibles et s'il y a une mise à jour alors mettre Clone90 à jour. Mettre une fenêtre qui explique que la mise à jour arrive. » puis « La vérification est à chaque ouverture, elle démarre 5 secondes après le démarrage et la fenêtre doit apparaître avant pour prévenir. » Plan validé le 2026-11-13 (`plans/T35-mises-a-jour.md` des fichiers du projet).

## Critères d'acceptation
1. Vérification à chaque ouverture de Clone90, 5 secondes après le lancement ; pas de nouvelle vérification en revenant d'un jeu (même onglet).
2. Mac : le serveur local lit la dernière version (js/version.js de main sur github.com, adresse fixe) et la compare à la version installée ; rien n'est envoyé.
3. Fenêtre AVANT la mise à jour : versions, ce qui va se passer, compte à rebours de 5 secondes ; à zéro la mise à jour démarre seule ; « Plus tard » annule pour cette ouverture ; « Mettre à jour maintenant » démarre sans attendre.
4. Mac : `git pull --ff-only origin main` seulement si le dossier est une copie git du dépôt officiel, sur main, sans fichier suivi modifié ; jeux, BIOS, games.json et réglages jamais touchés ; puis games.json régénéré et serveur relancé ; la page attend la nouvelle version puis se recharge.
5. Échec (pas d'Internet, modification locale, autre origine, git absent, redémarrage raté) : rien n'est changé, message en français avec la commande à lancer à la main.
6. Pendant la mise à jour, ni retour ni clic hors de la boîte ne ferment la fenêtre.
7. API locale : mêmes contrôles que T25 (127.0.0.1, hôte, origine, X-Clone90), corps `{}` seulement, même verrou que les téléchargements.
8. Site Pages et téléphone : même fenêtre ; la version du site est relue au réseau, et « mettre à jour » recharge la page.

## Vérification manuelle (Hicham)
Sur le Mac, après la fusion d'une version plus récente que la tienne : ouvre Clone90, attends 5 secondes : la fenêtre « Mise à jour disponible » s'ouvre et compte 5, 4, 3, 2, 1, puis « Mise à jour en cours », « Redémarrage », et la page se recharge sur la nouvelle version (numéro en bas de l'accueil). Une autre fois, « Plus tard » : rien ne change, la fenêtre revient à l'ouverture suivante.
