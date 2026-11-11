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
# Affiche aussi le dossier des jeux et des BIOS utilisé (T23, réglable avec « Choisir le dossier des jeux »).
node scripts/generate-games.mjs

# Un serveur Clone90 répond déjà ? On ouvre simplement la page.
if curl -fs --max-time 2 "$URL" 2>/dev/null | grep -q "Clone90"; then
  echo "Clone90 tourne déjà : ouverture de la page."
  open "$URL"
  exit 0
fi

# --host 127.0.0.1 : jeux et BIOS visibles depuis ce Mac seulement, pas depuis le réseau (Wi-Fi public).
node scripts/serve.mjs --host 127.0.0.1 &
SERVEUR=$!
# Le serveur s'arrête avec la fenêtre (fermeture ou Ctrl + C).
trap 'kill "$SERVEUR" 2>/dev/null' EXIT HUP INT TERM

# Attend que la page réponde (50 essais espacés d'un dixième de seconde, soit 5 secondes au plus).
for _ in $(seq 1 50); do
  # Ne s'arrête que si la page est bien celle de Clone90 (pas un autre programme sur le port 8080).
  curl -fs --max-time 1 "$URL" 2>/dev/null | grep -q "Clone90" && break
  kill -0 "$SERVEUR" 2>/dev/null || break
  sleep 0.1
done

if ! kill -0 "$SERVEUR" 2>/dev/null || ! curl -fs --max-time 1 "$URL" 2>/dev/null | grep -q "Clone90"; then
  echo "Clone90 n'a pas pu démarrer : le port 8080 est utilisé par un autre programme."
  echo "Fermez ce programme, puis double-cliquez de nouveau sur ce fichier."
  attendre_touche
  exit 1
fi

open "$URL"
echo ""
echo "Clone90 tourne. Pour l'arrêter, fermez cette fenêtre ou appuyez sur Ctrl + C."
wait "$SERVEUR"
