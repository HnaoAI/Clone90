# Préférences générales (tous mes projets)

Ces règles s'appliquent à tous mes projets.
Le CLAUDE.md d'un projet peut les préciser ou les remplacer : en cas de contradiction, c'est lui qui l'emporte.

## Langue

- Me répondre en français.
- Code, noms de fichiers et identifiants en anglais.
- Commentaires, documentation et textes affichés à l'utilisateur en français.

## Rôles

- Je suis le product owner : je décide de ce que fait le produit et je valide chaque ticket avant le développement.
- Claude Code développe, teste et signale. Il ne tranche pas seul une question de produit.

## Méthode de travail

- **Un ticket à la fois.** Les tickets sont dans le dossier `tickets/` du projet.
- Lire le ticket et le CLAUDE.md du projet avant de coder.
- **Commencer par les tests**, écrits à partir des critères d'acceptation et des interfaces décrites dans le ticket.
- **Ne jamais modifier, supprimer ou affaiblir un test pour le faire passer.** Si un test semble faux, le signaler.
- Rester dans le périmètre du ticket. Pas de fonctionnalité en plus, même utile.
- Si un ticket dépasse une journée de travail ou environ 400 lignes, proposer de le découper avant de commencer.
- Signaler une ambiguïté plutôt que la trancher seul.

## Définition de « terminé »

Un ticket est terminé quand :

1. La vérification des types, le lint et tous les tests passent.
2. Chaque critère d'acceptation a au moins un test dont le nom reprend le critère.
3. Les cas limites sont couverts (valeurs vides, très grandes, caractères spéciaux, erreurs).
4. La vérification manuelle décrite dans le ticket m'est indiquée.
5. Le travail est commité.

## Git

- Une branche par ticket : `ticket/<identifiant>-<sujet>`, par exemple `ticket/T0-squelette`.
- Messages de commit : `<identifiant>: description courte`, par exemple `T0: ajoute le format de fichier`.
- Petits commits cohérents plutôt qu'un seul gros commit.
- **Ne jamais pousser sur `main` sans mon accord.**
- Ne jamais commiter de secret (clé, mot de passe, jeton).

## Dépendances

- Justifier chaque nouvelle dépendance dans la réponse.
- Licences acceptées : MIT, Apache-2.0, BSD, ISC.
- Toute autre licence (GPL, commerciale, « Pro », payante) est refusée sans mon accord.
- Préférer une bibliothèque maintenue et répandue à du code écrit à la main pour un problème déjà résolu.

## Commentaires et repères pour l'agent

Les commentaires servent d'abord aux prochaines sessions de Claude Code : ils doivent
permettre de comprendre un fichier sans le relire en entier, et d'éviter de défaire
une décision déjà prise.

- **En tête de chaque fichier** : une ou deux lignes sur son rôle et ses dépendances principales.
- **Chaque fonction, type et interface exportés** : un bloc de documentation court (rôle, paramètres, retour, erreurs possibles).
- **Les choix non évidents** : expliquer pourquoi, et citer le ticket ou la décision d'origine.
- **Les invariants** : signaler ce qui ne doit pas être cassé, avec le préfixe `INVARIANT :`.
- **Les contournements** : décrire le problème contourné, avec un lien vers la source si possible.
- **Le travail reporté** : `TODO(<identifiant de ticket>) : …`.
- **Ne pas commenter** ce que le code dit déjà, ni laisser de code commenté : Git en garde la trace.
- **Mettre à jour le commentaire dans le même commit** que le code qu'il décrit. Un commentaire faux est pire qu'une absence de commentaire.

## Carte du code

- Chaque dossier de code source contient un `README.md` de 5 à 10 lignes : la liste des fichiers et leur rôle.
- Il est mis à jour dans le même commit que tout ajout, suppression ou renommage de fichier.
- Au début d'une session, lire ces `README.md` avant d'ouvrir les fichiers.

## Fichiers faciles à parcourir

- Viser moins de 300 lignes par fichier. Au-delà, proposer un découpage.
- Regrouper les types partagés dans un fichier dédié.
- Des noms explicites et cohérents, faciles à retrouver par une recherche.

## Journal des décisions

- Chaque projet tient un journal des décisions dans son CLAUDE.md : date, décision, raison.
- Proposer une entrée quand une décision importante est prise, sans modifier le CLAUDE.md sans mon accord.

## Format de réponse en fin de ticket

- Fichiers créés ou modifiés
- Résultat des tests (passés, échoués)
- Critères non satisfaits, et pourquoi
- Vérifications manuelles à faire
- Questions pour le product owner

Dire clairement ce qui n'a pas été fait ou pas vérifié.
