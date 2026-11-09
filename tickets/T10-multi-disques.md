# T10 : Jeux Amiga multi-disquettes

**Dépend de** : T2, T7
**Branche** : `ticket/T10-multi-disques`

## Besoin
Un jeu à plusieurs disquettes (ex. Leander, 3 ADF) apparaît comme UNE tuile et se lance avec toutes ses disquettes ; le joueur change de disquette en jeu.

## Fait
- Générateur : regroupe les noms `(Disk N of M)` / `(Disk N)` / `Disk N of M` en un jeu avec `disks` (games.json 6.2, `version` reste 1, champ facultatif), avertit si une disquette manque. Validation de `disks` dans `js/data.js`.
- Lanceur : `.m3u` virtuel (File) + disquettes en `EJS_externalFiles` ; trois contournements d'EmulatorJS stable (architecture 3.1).

## Vérifié en navigateur automatisé (avant l'interdiction de tester sur le Mac de Hicham)
Leander : 3 disquettes lues par puae, menu « Disk 1/2/3 », écran Psygnosis avec la disquette 1, changement 2 puis 3 puis 1 avec le journal « Disk (N) inserted in drive DF0 ».

## NON vérifié (à faire à la main par Hicham)
Jouer réellement, message « insérez la disquette 2 » du jeu, tactile, `.m3u` écrit à la main, version finale du code après relecture. Étapes de vérification dans le rapport du dev.
