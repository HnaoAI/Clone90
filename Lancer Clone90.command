#!/bin/bash
# Lanceur Mac de Clone90 (T20) : un double-clic dans le Finder génère la liste des jeux, démarre le serveur local et ouvre la page.
# Dépend de Node.js 18+ et de scripts/generate-games.mjs, scripts/serve.mjs. Rien n'est envoyé sur le réseau (tout reste sur localhost).
# INVARIANT : ce fichier n'est PAS public (liste blanche de scripts/serve.mjs) et n'est jamais mis en cache par sw.js.
# INVARIANT : aucun mot de passe demandé, aucun réglage du Mac modifié.

URL="http://localhost:8080/"

attendre_touche() {
  echo ""
  read -n 1 -s -r -p "Appuyez sur une touche pour fermer cette fenêtre."
  echo ""
}

# Se place dans le dossier du script, d'où qu'il soit lancé (les espaces dans le chemin sont gérés par les guillemets).
cd "$(dirname "$0")" || { echo "Impossible d'accéder au dossier de Clone90."; attendre_touche; exit 1; }

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé sur ce Mac."
  echo "Installez la version LTS depuis https://nodejs.org puis double-cliquez de nouveau sur ce fichier."
  attendre_touche
  exit 1
fi

echo "Mise à jour de la liste des jeux..."
node scripts/generate-games.mjs

# Un serveur Clone90 répond déjà ? On ouvre simplement la page.
if curl -fs --max-time 2 "$URL" 2>/dev/null | grep -q "Clone90"; then
  echo "Clone90 tourne déjà : ouverture de la page."
  open "$URL"
  exit 0
fi

node scripts/serve.mjs &
SERVEUR=$!
# Le serveur s'arrête avec la fenêtre (fermeture ou Ctrl + C).
trap 'kill "$SERVEUR" 2>/dev/null' EXIT HUP INT TERM

# Attend que la page réponde (50 essais espacés d'un dixième de seconde, soit 5 secondes au plus).
for _ in $(seq 1 50); do
  curl -fs --max-time 1 -o /dev/null "$URL" 2>/dev/null && break
  kill -0 "$SERVEUR" 2>/dev/null || break
  sleep 0.1
done

if ! kill -0 "$SERVEUR" 2>/dev/null; then
  echo "Le serveur n'a pas pu démarrer (le port 8080 est peut-être utilisé par un autre programme)."
  attendre_touche
  exit 1
fi

open "$URL"
echo ""
echo "Clone90 tourne. Pour l'arrêter, fermez cette fenêtre ou appuyez sur Ctrl + C."
wait "$SERVEUR"
