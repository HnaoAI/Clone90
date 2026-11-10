# T12 : Raccourci de changement de disquette (Amiga)

**Dépend de** : T7, T10
**Branche** : `ticket/T12-raccourci-disquette`
**Demandé par** : Hicham (« oui » du 2026-11-10 à la proposition de ux)

## Besoin
Changer de disquette en jeu sans la barre d'EmulatorJS (non pilotable à la manette).

## Spécification (avis de ux, validé par le PO)
- Manette : Select maintenu + RB (bouton 5, mapping standard) = disquette suivante, en cycle (3 puis 1). Clavier : F9.
- Jamais Start seul ni Select+Start (sortie). Pas de conflit avec F10 ni Échap. Aucune autre touche consommée (seul F9 reçoit `preventDefault`).
- Actif seulement si le jeu a `disks.length > 1` ; sinon ne fait rien, sans toast.
- Retour : toast « Disquette 2 / 3 » de 2 s (`js/ui/toast.js`, zone `role="status"`), sans voler le focus.
- Même fonction de changement que le menu d'EmulatorJS (`handleSpecialOptions('disk', n)` avec son rappel unique), dans `launcher.js`.
- Le numéro courant est lu dans le cœur (`gameManager.getCurrentDisk()`), jamais copié : cohérent après un changement par le menu.
- Anti-rebond : un appui maintenu = un changement (front montant de RB, Select déjà tenu) ; pas de changement pendant qu'un autre est en cours.

## Critères d'acceptation
1. Select + RB (front) passe à la disquette suivante, en cycle.
2. Select seul, RB seul, Select+Start(+RB) : aucun changement.
3. F9 fait la même chose ; avec Ctrl/Alt/Meta ou en répétition : rien.
4. Jeu à une disquette : rien, pas de toast.
5. Un appui maintenu ne change qu'une fois.
6. Un seul appel de `handleSpecialOptions('disk', n)` par changement.
7. Toast « Disquette N / M ».
8. Inactif hors phase de jeu (boîte de confirmation ouverte).

## Limites connues
- Le menu « Disks » d'EmulatorJS garde sa propre sélection affichée : après un changement par F9 il peut montrer l'ancien disque (le numéro du toast, lui, vient du cœur).
- Non vérifié en vrai : voir le rapport du dev.
