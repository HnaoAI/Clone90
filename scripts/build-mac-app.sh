#!/bin/bash
# Reconstruit Clone90.app (T26) à la racine du projet depuis scripts/mac-app/Clone90.applescript.
# Dépend de osacompile (macOS). Ne lance pas l'application. Usage : bash scripts/build-mac-app.sh
# INVARIANT : Clone90.app est commitée (Hicham double-clique sans rien construire) : relancer ce script après toute modification de la source.
set -euo pipefail

RACINE="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE="$RACINE/scripts/mac-app/Clone90.applescript"
APP="$RACINE/Clone90.app"

rm -rf "$APP"
# -s : applet « stay open » (reste ouverte, sans quoi les gestionnaires reopen et quit ne servent à rien).
osacompile -s -o "$APP" "$SOURCE"

PLIST="$APP/Contents/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleName Clone90" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier fr.clone90.launcher" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string fr.clone90.launcher" "$PLIST"

# Sans CFBundleIconName, macOS prend applet.icns (sinon il préfère l'icône par défaut de Assets.car).
/usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$PLIST" 2>/dev/null || true

# Icône : celle de la PWA (assets/icons/icon-512.png) convertie en .icns, si les outils du Mac sont là.
ICONE="$RACINE/assets/icons/icon-512.png"
if [ -f "$ICONE" ] && command -v sips >/dev/null && command -v iconutil >/dev/null; then
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  JEU="$TMP/Clone90.iconset"
  mkdir "$JEU"
  for taille in 16 32 128 256 512; do
    sips -z "$taille" "$taille" "$ICONE" --out "$JEU/icon_${taille}x${taille}.png" >/dev/null
    sips -z "$((taille * 2))" "$((taille * 2))" "$ICONE" --out "$JEU/icon_${taille}x${taille}@2x.png" >/dev/null
  done
  iconutil -c icns "$JEU" -o "$APP/Contents/Resources/applet.icns"
fi

# Signature ad hoc (sans compte développeur) : cohérente après les modifications ci-dessus.
codesign --force --deep -s - "$APP"
echo "Clone90.app reconstruite : $APP"
