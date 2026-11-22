# T55 : « Mes fichiers » en rubriques qui s'ouvrent une par une

**Branche** : `ticket/T55-mes-fichiers-repliable` - **Version** : 0.55.0
**Demandé par** : Hicham (2026-11-22), maquette « Swared » validée (`maquette-swared.html`, écran « Mes fichiers ») ; découpé de T54 et lancé le 2026-11-22 (« ok pour les rubriques repliables de « Mes fichiers » seraient un ticket à part (T55) »).

Aujourd'hui « Mes fichiers » est une longue page : synchronisation, import d'un dossier, ajout de jeux, BIOS, pochettes, jeu hors ligne, puis la liste des fichiers. Avec ce ticket, chaque rubrique devient une ligne (titre, petit résumé, flèche) qui s'ouvre sous elle-même ; une seule rubrique ouverte à la fois. Même contenu, mêmes boutons, mêmes `data-nav-id` : aucune fonction ne change.

## Critères d'acceptation
1. En haut, deux tuiles comme la maquette : « Ajouter des jeux » (verte) et « Importer un dossier » ; puis les lignes « Synchroniser avec le Mac » (téléphone seulement, comme avant), « Ajouter des BIOS », « Pochettes », « Jouer sans réseau ». La liste « Sur cet appareil » reste toujours visible en bas.
2. Chaque tuile ou ligne est un bouton (`aria-expanded`, `aria-controls`, `data-nav`) : le toucher, le clic, Entrée ou A l'ouvrent ; une rubrique ouverte se referme en la touchant de nouveau ; ouvrir une rubrique referme les autres.
3. Un résumé d'une ligne sous le titre : nom du Mac associé ou « Pas encore associé », BIOS présents sur le nombre déclaré, rien de plus.
4. Rubrique ouverte d'office : celle du bouton qui reprend le focus après une action (Associer, Synchroniser, Choisir des BIOS, Chercher les pochettes, Préparer le jeu hors ligne, Choisir le dossier), « Ajouter des jeux » en arrivant depuis la grille vide d'une machine, sinon la dernière ouverte ; à la première visite, tout est fermé.
5. Le message du dernier import, de la recherche des pochettes ou du jeu hors ligne s'affiche en haut de l'écran, visible quelle que soit la rubrique ouverte.
6. Clavier et manette : les boutons d'une rubrique fermée ne reçoivent jamais le focus ; ceux de la rubrique ouverte, oui.
7. Style Swared (T54) : tuile verte pleine et tuile à fine bordure, lignes sombres arrondies avec flèche verte qui tourne vers le bas quand la rubrique est ouverte (forme, pas seulement la couleur).

## Vérification manuelle (Hicham)
Sur le téléphone : « Mes fichiers » montre deux tuiles et quatre lignes, tout fermé. Touche « Ajouter des BIOS » : la rubrique s'ouvre ; touche « Pochettes » : les BIOS se referment. Dans une grille vide, touche « Ajouter des jeux » : « Mes fichiers » s'ouvre sur l'ajout de jeux de cette machine. Associe ou synchronise avec le Mac : la rubrique reste ouverte et le message apparaît en haut.
