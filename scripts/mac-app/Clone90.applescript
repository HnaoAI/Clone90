-- Source de l'application Mac Clone90.app (T26). Compilée par scripts/build-mac-app.sh (osacompile, applet « stay open »).
-- Rôle : lancer Clone90 sans fenêtre Terminal. Dépend de Node.js, de scripts/generate-games.mjs et de scripts/serve.mjs.
-- INVARIANT : serveur limité à ce Mac (--host 127.0.0.1), aucun mot de passe, aucun réglage du Mac, rien sur le réseau.
-- INVARIANT : à la fermeture, on n'arrête que le serveur lancé par cette application, reconnu par son pid.
-- INVARIANT : ni Clone90.app ni scripts/mac-app ne sont publics (liste blanche de scripts/serve.mjs).

property pageUrl : "http://localhost:8080/"
property logPath : "$HOME/Library/Logs/Clone90.log"
property nodePath : "export PATH=/usr/local/bin:/opt/homebrew/bin:$PATH; "
property serverPid : ""

-- Premier lancement : ouvre la page, en démarrant Clone90 si besoin.
on run
	set projectDir to my findProjectDir()
	if not my nodeIsInstalled() then
		my showNodeMissing()
		quit
		return
	end if
	if not my clone90Answers() then
		my startServer(projectDir)
		if not my waitForClone90(10) then
			my stopServer()
			display dialog "Clone90 n'a pas pu démarrer : le port 8080 est peut-être utilisé par un autre programme. Fermez-le puis relancez Clone90. Le détail est dans le journal ~/Library/Logs/Clone90.log." buttons {"OK"} default button "OK" with icon caution with title "Clone90"
			quit
			return
		end if
	end if
	open location pageUrl
end run

-- Clic sur l'icône du Dock alors que l'application tourne : on rouvre la page.
on reopen
	if my clone90Answers() then open location pageUrl
end reopen

-- Fermeture (Cmd + Q, ou clic droit sur l'icône puis Quitter) : on arrête le serveur lancé par nous, puis on quitte.
on quit
	my stopServer()
	continue quit
end quit

-- Dossier du projet : le dossier qui contient Clone90.app.
on findProjectDir()
	return do shell script "dirname " & quoted form of POSIX path of (path to me)
end findProjectDir

-- Vrai si Node.js est trouvable (l'application ne reçoit pas le PATH du Terminal : chemins usuels ajoutés).
on nodeIsInstalled()
	try
		do shell script nodePath & "command -v node"
		return true
	on error
		return false
	end try
end nodeIsInstalled

on showNodeMissing()
	set answer to display dialog "Node.js n'est pas installé sur ce Mac. Installez la version LTS depuis https://nodejs.org puis relancez Clone90." buttons {"Fermer", "Ouvrir nodejs.org"} default button "Ouvrir nodejs.org" with icon caution with title "Clone90"
	if button returned of answer is "Ouvrir nodejs.org" then open location "https://nodejs.org"
end showNodeMissing

-- Vrai si une page contenant « Clone90 » répond déjà sur le port 8080 (pas un autre programme).
on clone90Answers()
	try
		do shell script "curl -fs --max-time 2 " & pageUrl & " | grep -q Clone90"
		return true
	on error
		return false
	end try
end clone90Answers

-- Met à jour la liste des jeux puis démarre le serveur en arrière-plan ; la sortie va dans le journal, le pid est mémorisé.
on startServer(projectDir)
	set prefix to nodePath & "cd " & quoted form of projectDir & " && "
	try
		do shell script prefix & "node scripts/generate-games.mjs >> " & logPath & " 2>&1 < /dev/null"
	end try
	set serverPid to do shell script prefix & "node scripts/serve.mjs --host 127.0.0.1 >> " & logPath & " 2>&1 < /dev/null & echo $!"
end startServer

-- Attend la page Clone90 (un essai toutes les demi-secondes, limite en secondes).
on waitForClone90(limitSeconds)
	repeat limitSeconds * 2 times
		if my clone90Answers() then return true
		delay 0.5
	end repeat
	return false
end waitForClone90

-- Arrête le serveur lancé par cette application, uniquement s'il s'agit bien encore de serve.mjs (le pid a pu être réattribué).
on stopServer()
	if serverPid is "" then return
	try
		do shell script "ps -p " & serverPid & " -o command= | grep -q serve.mjs && kill " & serverPid
	end try
	set serverPid to ""
end stopServer
