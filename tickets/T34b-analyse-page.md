# T34b : mieux trouver les fichiers d'une page (correctif de T34, plan « T36 »)

**Branche** : `ticket/T36-analyse-page` - **Version** : 0.34.1
**Demandé par** : Hicham (2026-11-13) : « pour le téléchargement cela ne fonctionne pas, il faut scanner la page pour trouver les liens ». Plan validé le 2026-11-13 (`plans/T36-analyse-page-amelioree.md` des fichiers du projet).

## Critères d'acceptation
1. Profondeur au choix : cette page seulement, les pages reliées (défaut) ou 2 niveaux ; même site seulement ; 40 pages, 10 Mo, 90 s au plus ; avancement et bouton Arrêter (ce qui est trouvé est gardé).
2. Liens sans nom de fichier (download, dl, get, file...) : nom lu dans Content-Disposition (ou l'adresse finale) sans télécharger le corps, 60 interrogations au plus ; le fichier est ensuite écrit sous ce nom, revérifié (extension acceptée par la machine).
3. Liens lus aussi dans les attributs data-* d'adresse, <meta refresh> et les adresses en clair (scripts, JSON échappé).
4. Identifiant de navigateur courant (User-Agent).
5. Analyse vide expliquée (liens et pages lus, causes probables) ; chaque fichier affiche la page d'où il vient.
6. Garde-fous T34 inchangés à chaque requête (adresses publiques, DNS figé, redirections revérifiées). Téléphone : sous-pages lues si le site l'autorise (CORS), pas d'interrogation des liens sans nom.

## Limites connues (dites à Hicham)
Sites avec compte, captcha ou protection anti-robot, listes fabriquées par JavaScript, téléchargements à attente, torrents, hébergeurs de fichiers.

## Vérification manuelle (Hicham)
Sur le Mac, « Depuis une page web », une page d'un site qui propose des fichiers que tu as le droit d'avoir, « Et les pages reliées », Analyser : avancement, puis liste avec la page d'origine sous chaque fichier.
