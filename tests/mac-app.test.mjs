// Tests de l'application Mac Clone90.app (T26) : source AppleScript, bundle commité, script de construction, jamais servie ni mise en cache.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import vm from 'node:vm';
import { PROJECT_ROOT, createStaticServer } from '../scripts/serve.mjs';

const source = () => readFileSync(join(PROJECT_ROOT, 'scripts/mac-app/Clone90.applescript'), 'utf8');
const APP = join(PROJECT_ROOT, 'Clone90.app');

test('application Mac : la source AppleScript lance generate-games puis serve --host 127.0.0.1', () => {
  const s = source();
  assert.match(s, /node scripts\/generate-games\.mjs/);
  assert.match(s, /node scripts\/serve\.mjs --host 127\.0\.0\.1/);
  assert.ok(s.indexOf('generate-games.mjs') < s.indexOf('serve.mjs --host'), 'generate-games doit passer avant serve');
});

test('application Mac : vérifie Node.js (chemins usuels) et renvoie vers nodejs.org', () => {
  const s = source();
  assert.match(s, /command -v node/);
  assert.match(s, /\/opt\/homebrew\/bin/);
  assert.match(s, /\/usr\/local\/bin/);
  assert.match(s, /https:\/\/nodejs\.org/);
});

test('application Mac : détecte un Clone90 déjà lancé et ouvre seulement la page', () => {
  const s = source();
  assert.match(s, /curl -fs --max-time 2 " & pageUrl & " \| grep -q Clone90/);
  assert.match(s, /if not my clone90Answers\(\) then/);
  assert.match(s, /open location pageUrl/);
  assert.match(s, /set pageUrl to "http:\/\/localhost:8080\/"/);
});

test('application Mac : attend la page Clone90 au plus 10 s puis affiche une erreur claire', () => {
  const s = source();
  assert.match(s, /waitForClone90\(10\)/);
  assert.match(s, /n'a pas pu démarrer/);
});

test('application Mac : sortie du serveur dans ~/Library/Logs/Clone90.log, pid mémorisé', () => {
  const s = source();
  assert.match(s, /"\\"\$HOME\/Library\/Logs\/Clone90\.log\\""/, 'journal entre guillemets (dossier personnel avec espace)');
  assert.match(s, /echo \$!/);
  assert.match(s, /set serverPid to do shell script/);
});

test('application Mac : on quit arrête le serveur par son pid (et lui seul) puis quitte; on reopen rouvre la page', () => {
  const s = source();
  assert.match(s, /on quit\s+my stopServer\(\)\s+continue quit\s+end quit/);
  assert.match(s, /kill " & serverPid/);
  assert.match(s, /grep -q serve\.mjs/, 'on vérifie que le pid est encore serve.mjs avant de tuer');
  assert.doesNotMatch(s, /killall|pkill|lsof/);
  assert.match(s, /on reopen\s+my openClone90\(\)\s+end reopen/);
});

test('application Mac : aucun tiret cadratin, aucun sudo, aucun accès réseau hors localhost et nodejs.org', () => {
  const s = source();
  assert.ok(!s.includes('—'), 'tiret cadratin');
  assert.doesNotMatch(s, /with administrator privileges|\bsudo\b|\bdefaults write\b|\bwget\b/);
  assert.doesNotMatch(s, /https?:\/\/(?!localhost|nodejs\.org)/);
});

test('application Mac : le bundle existe avec Info.plist et l\'exécutable applet', () => {
  assert.ok(statSync(join(APP, 'Contents/Info.plist')).isFile());
  const exe = statSync(join(APP, 'Contents/MacOS/applet'));
  assert.ok(exe.isFile());
  assert.ok(exe.mode & 0o100, 'bit exécutable manquant sur applet');
  assert.ok(statSync(join(APP, 'Contents/Resources/Scripts/main.scpt')).isFile());
});

test('application Mac : Info.plist déclare une applet nommée Clone90 qui reste ouverte', () => {
  const plist = readFileSync(join(APP, 'Contents/Info.plist'), 'utf8');
  assert.match(plist, /<key>CFBundleExecutable<\/key>\s*<string>applet<\/string>/);
  assert.match(plist, /<key>CFBundleName<\/key>\s*<string>Clone90<\/string>/);
  assert.match(plist, /<key>OSAAppletStayOpen<\/key>\s*<true\/>/);
});

test('application Mac : le script de construction existe, est exécutable et passe bash -n', () => {
  const path = join(PROJECT_ROOT, 'scripts/build-mac-app.sh');
  assert.ok(statSync(path).mode & 0o100);
  const s = readFileSync(path, 'utf8');
  assert.match(s, /osacompile -s -o "\$APP" "\$SOURCE"/);
  assert.match(s, /^#!\/bin\/bash\n/);
  const r = spawnSync('bash', ['-n', path], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
});

test('application Mac : le serveur local ne sert ni Clone90.app ni scripts/mac-app (403 ou 404)', async () => {
  const server = createStaticServer({ root: PROJECT_ROOT });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    const paths = ['/Clone90.app', '/Clone90.app/', '/Clone90.app/Contents/Info.plist', '/Clone90.app/Contents/MacOS/applet',
      '/scripts/mac-app/Clone90.applescript', '/scripts/mac-app/', '/scripts/build-mac-app.sh'];
    for (const p of paths) {
      const res = await fetch(base + p);
      assert.ok([403, 404].includes(res.status), `${p} : ${res.status}`);
      await res.text();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('application Mac : absente de la coquille du service worker et jamais interceptée', () => {
  const sandbox = { URL, decodeURIComponent, self: null };
  sandbox.self = { addEventListener: () => {}, location: new URL('https://hnaoai.github.io/Clone90/sw.js?v=1.0.0') };
  vm.runInNewContext(readFileSync(join(PROJECT_ROOT, 'sw.js'), 'utf8'), sandbox);
  const sw = sandbox.self.Clone90SW;
  assert.ok(!sw.SHELL_FILES.some((f) => /\.app|mac-app/.test(f)));
  for (const p of ['Clone90.app/Contents/Info.plist', 'scripts/mac-app/Clone90.applescript']) {
    assert.equal(sw.isShellPath(p), false, p);
  }
});

test('application Mac : aucun `property` dans la source (l\'applet les réécrirait dans le bundle commité et casserait la signature)', () => {
  const code = source().split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  assert.doesNotMatch(code, /^\s*property\b/m);
  assert.match(code, /^global pageUrl, logPath, nodePath, serverPid$/m);
  assert.match(code, /on run\s+set pageUrl to/);
});

test('application Mac : le serveur est lancé par `cd ...; node ... &` (pas `&&`) pour que $! soit le pid de node', () => {
  const s = source();
  assert.match(s, /"cd " & quoted form of projectDir & "; "/);
  assert.doesNotMatch(s, /cd " & quoted form of projectDir & " && "/);
  assert.match(s, /node scripts\/serve\.mjs --host 127\.0\.0\.1 >> " & logPath & " 2>&1 < \/dev\/null & echo \$!/);
});

test('application Mac : le pid renvoyé par le motif `cd dossier; cmd >> journal & echo $!` est celui du processus lancé', () => {
  const r = spawnSync('/bin/sh', ['-c', 'cd /; sleep 30 >> /dev/null 2>&1 < /dev/null & echo $!'], { encoding: 'utf8' });
  const pid = Number(r.stdout.trim());
  try {
    const ps = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
    assert.match(ps.stdout, /sleep 30/, `le pid ${pid} n'est pas celui de sleep : ${ps.stdout}`);
  } finally {
    process.kill(pid);
  }
});

test('application Mac : boîte de dialogue claire si l\'application a été déplacée hors du projet', () => {
  const s = source();
  assert.match(s, /test -f " & quoted form of \(projectDir & "\/scripts\/serve\.mjs"\)/);
  assert.match(s, /Clone90\.app doit rester dans le dossier de Clone90/);
});
