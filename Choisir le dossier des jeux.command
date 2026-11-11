#!/bin/bash
# Choix du dossier des ROMs et des BIOS (T23) : deux boîtes de dialogue du Mac, puis écriture de clone90.local.json.
# Dépend de Node.js 18+ et de scripts/local-settings.mjs (qui valide et fusionne sans détruire les autres réglages).
# INVARIANT : Annuler à n'importe quelle étape ne change rien ; aucun mot de passe demandé, aucun réglage du Mac modifié.

attendre_touche() {
  echo ""
  read -n 1 -s -r -p "Appuyez sur une touche pour fermer cette fenêtre."
  echo ""
}

cd "$(dirname "$0")" || { echo "Impossible d'accéder au dossier de Clone90."; attendre_touche; exit 1; }

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé sur ce Mac."
  echo "Installez la version LTS depuis https://nodejs.org puis double-cliquez de nouveau sur ce fichier."
  attendre_touche
  exit 1
fi

# Redemande tant que le dossier est refusé (trop large : /, dossier personnel, /Users, /Volumes, dossiers système...). Annuler : code 1.
choisir_dossier_valide() {
  local chemin
  while true; do
    chemin=$(choisir_dossier "$1") || return 1
    node scripts/local-settings.mjs check "$chemin" >&2 && { printf '%s' "$chemin"; return 0; }
    osascript -e 'display dialog "Ce dossier est trop large ou introuvable. Choisissez le dossier qui contient directement vos jeux." buttons {"OK"} default button "OK"' >/dev/null 2>&1 || return 1
  done
}

# Affiche la boîte « choisir un dossier » ; imprime le chemin sans « / » final, ou rien si l'on annule.
choisir_dossier() {
  local chemin
  chemin=$(osascript -e "POSIX path of (choose folder with prompt \"$1\")" 2>/dev/null) || return 1
  [ "$chemin" != "/" ] && chemin="${chemin%/}"
  printf '%s' "$chemin"
}

annuler() {
  echo "Annulé : rien n'a été changé."
  attendre_touche
  exit 0
}

echo "Choisissez le dossier qui contient vos ROMs (une fenêtre s'ouvre)..."
ROMS=$(choisir_dossier_valide "Choisissez le dossier qui contient vos ROMs") || annuler

# Même dossier que les ROMs ? Non : on propose de garder le dossier bios/ du projet ou d'en choisir un autre.
REPONSE=$(osascript -e 'button returned of (display dialog "Où sont vos BIOS (Amiga, Neo Geo...) ?" buttons {"Garder bios/ du projet", "Choisir un dossier"} default button "Garder bios/ du projet")' 2>/dev/null) || annuler
if [ "$REPONSE" = "Choisir un dossier" ]; then
  BIOS=$(choisir_dossier_valide "Choisissez le dossier qui contient vos BIOS") || annuler
else
  BIOS="-"
fi

echo ""
node scripts/local-settings.mjs set romsDir "$ROMS" >/dev/null && node scripts/local-settings.mjs set biosDir "$BIOS" || {
  echo "L'enregistrement a échoué. Rien n'a été envoyé sur le réseau."
  attendre_touche
  exit 1
}
echo "Réglages enregistrés dans clone90.local.json :"
node scripts/local-settings.mjs show
echo ""
echo "Double-cliquez sur « Lancer Clone90 » pour utiliser ces dossiers."
echo "Si Clone90 est déjà ouvert, fermez sa fenêtre Terminal puis relancez Lancer Clone90."
echo "Pour revenir au dossier roms/ du projet, supprimez le fichier clone90.local.json."
attendre_touche
