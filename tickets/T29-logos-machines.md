# T29 : Logos des machines téléchargés

**Branche** : `ticket/T29-logos-machines` - **Version** : 0.29.0
**Demandé par** : Hicham (2026-11-12) : « Peut-on faire pareil que les pochettes, avec les logos des machines ? »

## Besoin
Comme pour les pochettes (T28) : un bouton qui télécharge les vrais logos des machines, rangés chez Hicham (jamais publiés sur le site), avec repli sur les logos maison actuels. Connexion seulement au clic.

## Source retenue
Thème EmulationStation **es-theme-carbon** de RetroPie (`github.com/RetroPie/es-theme-carbon`), fichier `<dossier>/art/system.svg` : logos officiels redessinés en SVG, un par machine, pour les 12 machines de Clone90. Licence du thème : CC BY-NC-SA (partage et modification permis, usage non commercial, attribution) ; les logos eux-mêmes sont des marques de leurs fabricants. Usage personnel, sur le Mac de l'utilisateur seulement : compatible. Rien n'est mis dans le dépôt ni sur GitHub Pages.
- La base libretro-thumbnails (pochettes) n'a pas de logos de machines ; `libretro/retroarch-assets` (CC BY 4.0) n'a que des icônes de consoles, pas les logos.
- Adresse figée sur un commit (`b09973e0b0c589cb11fe772c169a6ff5d588b390`, 2020-05-20) : le contenu téléchargé ne peut pas changer sans nous.

## Critères d'acceptation
1. `systems.json` donne pour chaque machine le dossier du thème (`logoTheme`) : seule source de vérité (règle 2).
2. Un bouton « Télécharger les logos des machines » dans le panneau « Dossiers des jeux », à côté de « Télécharger les pochettes », avec un texte qui dit quand Clone90 se connecte et ce que GitHub voit (adresse IP seulement, aucun nom de jeu).
3. Seules des lectures vers `raw.githubusercontent.com` (thème figé), uniquement au clic ou par `node scripts/machine-logos.mjs`.
4. Logos écrits dans le dossier des ROMs, sous `clone90-logos/<machine>.svg`, jamais dans le dépôt ; jamais d'écrasement d'un logo déjà présent.
5. Fichier vérifié avant écriture : SVG, 256 Ko au plus, sans script, sans gestionnaire d'événement, sans lien externe ; sinon refusé et signalé.
6. `games.json` indique les logos présents ; l'accueil et les grilles les affichent ; si un logo manque ou ne charge pas : logo maison, puis nom de la machine.
7. Résumé en français (téléchargés, déjà présents, échecs) ; l'accueil se met à jour à la fin, même panneau fermé.
8. Le serveur local sert les SVG avec une politique de sécurité qui interdit tout script.
9. Sur GitHub Pages et sur téléphone : aucun bouton, logos maison.

## Vérification manuelle (Hicham)
1. Lancer Clone90 sur le Mac, accueil, « Dossiers des jeux », « Télécharger les logos des machines » : résumé « Logos téléchargés : 12 », l'accueil montre les vrais logos.
2. Recommencer : « Déjà présents : 12 », rien n'est retéléchargé.
3. Pour revenir aux logos maison : supprimer le dossier `clone90-logos` dans le dossier des ROMs, puis relancer Clone90.
