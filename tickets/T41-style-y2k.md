# T41 : style Y2K (début des années 2000) et barre de navigation en bas

**Branche** : `ticket/T41-style-y2k` - **Version** : 0.41.0
**Demandé par** : Hicham (2026-11-15) : « Glossy gradient buttons with metallic shine, skeuomorphic elements (beveled edges, embossed text, drop shadows), bright saturated colors (hot pink, electric blue, lime green, chrome silver). Bubbly rounded shapes, glassy reflections [...] Bottom navigation bar. » Maquette validée le 2026-11-15 (« Je valide ») : `maquette-y2k.html` et `captures/Y2K/` des fichiers du projet, avec ses deux propositions : police arrondie façon Windows XP, barre du bas qui remplace les boutons de l'accueil et qui est absente pendant le jeu.

Remplace la direction « Cartouche bleue » (T24) : palette, police, cadres et boutons de `css/base.css`, accueil (`css/home.css`). Les autres écrans prennent la nouvelle palette par les variables ; leurs mises en page ne changent pas.

## Critères d'acceptation
1. Palette Y2K dans le seul bloc `:root` de `css/base.css` : rose vif, bleu électrique, vert citron, violet, chrome, jaune ; aucune couleur littérale ailleurs.
2. Contrastes gardés : texte >= 4.5:1 sur chaque fond et chaque couleur de bulle ; anneau de focus >= 3:1.
3. Police arrondie (Trebuchet MS, Arial Rounded) pour l'interface et les titres ; Press Start 2P reste dans le dépôt, utilisée seulement par les visuels de repli (logos et jaquettes) et l'écran de jeu.
4. Formes arrondies et « gel » : reflet en haut, biseau, ombre portée ; aucun `clip-path` (il couperait l'anneau de focus).
5. Accueil : en-tête chromé, titre « Clone90 » en relief (« 90 » en rose) ; machines en bulles qui alternent rose, bleu, vert citron, violet ; nombre de jeux dans une pastille chromée ; jauge en 6 voyants ronds ; machine à 0 jeu en chrome terne.
6. Barre du bas sur toutes les pages de index.html : « Machines », « Mes fichiers » (si le navigateur le permet), « Page web » (si l'API du Mac répond ou si « Mes fichiers » est possible), « Dossiers » (seulement si l'API du Mac répond). Mêmes conditions et mêmes `data-nav-id` que les anciens boutons de l'accueil.
7. L'onglet de la page courante est marqué `aria-current="page"` et ressort de la barre (plus gros, halo rose) ; la grille d'une machine marque « Machines ».
8. Les boutons « Mes fichiers », « Dossiers des jeux » et « Depuis une page web » ne sont plus sur l'accueil.
9. La barre est atteinte au clavier et à la manette (bas depuis la dernière rangée), au toucher et à la souris ; cibles d'au moins 48 px ; le contenu n'est jamais caché dessous.
10. Pas de barre pendant le jeu (player.html).
11. `prefers-reduced-motion` : pas d'agrandissement ni de transition, comme avant.

## Vérification manuelle (Hicham)
Sur le téléphone et sur le Mac, ouvre Clone90 : en-tête chromé, machines en bulles colorées, barre du bas. Touche « Mes fichiers », puis « Page web », puis « Machines » : l'onglet actif change. Sur le Mac, « Dossiers » ouvre le panneau des dossiers. Avec une manette, descends depuis la dernière machine : le focus arrive dans la barre. Lance un jeu : pas de barre.
