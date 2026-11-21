# T47 : revérifier les mises à jour quand l'onglet reste ouvert

**Branche** : `ticket/T47-reverifier-mises-a-jour` - **Version** : 0.47.0
**Demandé par** : Hicham (2026-11-21) : correctif proposé « revérifier au retour sur l'onglet après 12 h », réponse « oui mais plutôt sur 5 h ».

## Constat de départ
La vérification T35 ne se faisait qu'une fois par onglet (marque « 1 » dans sessionStorage), 5 s après l'ouverture. Un onglet laissé ouvert des jours ne revérifiait jamais : le Mac de Hicham est resté en v0.37 du 13 au 21/11.

## Réalisation
- `js/update-schedule.js` (pur) : heure de la dernière vérification dans sessionStorage (`clone90-update-checked`, l'ancienne marque « 1 » est lue comme très ancienne), `isCheckDue` (jamais vérifié, 5 h ou plus, ou horloge reculée), `canCheckNow` (page visible, aucune fenêtre ni panneau ouvert, aucune vérification déjà prévue).
- `js/app.js` : vérification à l'ouverture si elle est due, puis au retour sur l'onglet (`visibilitychange`, `focus`) et à la fermeture du panneau des dossiers ou du partage. Toujours 5 s d'attente, même fenêtre (compte à rebours 5 s, « Plus tard »). Onglet quitté pendant les 5 s : rien, on vérifie au retour. Pas de nouveau stockage durable : sessionStorage, et une variable si le stockage est refusé.
- « Plus tard » : pas de nouvelle proposition avant 5 h.
- Pendant une partie : le jeu est dans `player.html`, qui ne vérifie jamais ; revenir à l'accueil recharge index.html, qui vérifie si la dernière vérification a 5 h ou plus.
- `sw.js` : nouveau module dans la coquille.

## Critères d'acceptation
1. À l'ouverture d'un onglet : une vérification 5 s après, comme T35.
2. Retour sur l'onglet moins de 5 h après la dernière vérification : aucune vérification.
3. Retour sur l'onglet 5 h ou plus après : vérification 5 s après le retour, même fenêtre et même « Plus tard ».
4. Onglet caché : aucune vérification tant qu'il n'est pas revenu.
5. Jamais de fenêtre pendant une partie ; le retour à l'accueil vérifie si c'est dû.
6. Pas de double vérification (focus et visibilitychange ensemble).

## Vérification
- `node --test tests/update-schedule.test.mjs tests/sw.test.mjs tests/version.test.mjs`
- `PLAYWRIGHT_PATH=... node tests/recette/reverif-mises-a-jour.mjs` : 17 vérifications T47-*, horloge simulée (`page.clock`).
- À la main : sur le Mac, laisser Clone90 ouvert, revenir dessus le lendemain : la vérification se fait (fenêtre seulement s'il y a une nouvelle version).
