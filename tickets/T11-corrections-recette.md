# T11 : Corrections issues de la recette T9

**Dépend de** : T9 (docs/rapport-recette-T9.md), T10
**Branche** : `ticket/T11-corrections-recette`

## Besoin
Corriger les anomalies A1, A2, A3, A5, A6 et A7 du rapport de recette. A4 (lenteur au-delà de ~1000 jeux) est hors périmètre v1 et n'est PAS traitée.

## Critères d'acceptation
- A1 : un fichier dont le nom contient `#`, `?`, `%`, `&`, `+`, espaces, accents, crochets ou caractères japonais est lancé : chaque segment du chemin est encodé (`encodeURIComponent`), `/` conservé (fichiers, disquettes `disks`, jaquettes, logos, BIOS). Le serveur local sert ces chemins.
- A2 : dans l'état d'erreur du lecteur, le bouton Menu, F10 et le retour navigateur quittent en un seul appui ; aucun bandeau de sortie trompeur.
- A3 : le réveil de la manette n'avale le 1er appui que s'il n'y a pas déjà un élément `data-nav` focalisé. Écran « Jouer » : A fonctionne dès le 1er appui. docs/ux.md 4.2 aligné.
- A5 : erreur de systems.json en français clair pour l'utilisateur, détail technique en console seulement ; plus de port 8080 en dur.
- A6 : la bannière distingue hors ligne (`offline`), absent (`absent`) et invalide (`invalid`).
- A7 : le serveur local refuse (403) tout fichier dont le chemin réel (realpath) sort de la racine, et envoie `X-Content-Type-Options: nosniff` sur toutes les réponses.

## Hors périmètre
A4 (performance avec 3000 jeux).

## Vérification manuelle
Voir le rapport de fin de ticket.
