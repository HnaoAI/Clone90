// Tests des sources de l'écran « Depuis une page web » (T34, js/link-download.js), des aides de l'écran (js/ui/link-screen.js) et de la route.
// fetch, bibliothèque et attente factices : aucun réseau.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/project-root.mjs';
import { createMacLinkSource, createBrowserLinkSource, BLOCKED_TEXT } from '../js/link-download.js';
import { machineOptions, initialChoices, selectedItems, missingMachines, downloadLabel, describeFound, describeLinksProgress, describePrivacy, WARNING_TEXT } from '../js/ui/link-screen.js';
import { parseHash, buildHash, LINKS_SEGMENT } from '../js/router.js';
import { resolveRoute } from '../js/screens.js';

const { systems } = JSON.parse(readFileSync(join(PROJECT_ROOT, 'systems.json'), 'utf8'));
const response = (status, body, extra = {}) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => body, ...extra });

test('T34 route #/telecharger : lue, reconstruite, affichée ; aucune machine ne porte cet id', () => {
  assert.deepEqual(parseHash('#/telecharger'), { name: 'links' });
  assert.equal(buildHash({ name: 'links' }), '#/telecharger');
  assert.deepEqual(resolveRoute({ name: 'links' }, systems), { name: 'links' });
  assert.ok(!systems.some((s) => s.id === LINKS_SEGMENT));
});

test('T34 avertissement : texte court sur les droits, et texte de connexion selon le Mac ou le navigateur', () => {
  assert.equal(WARNING_TEXT, 'Télécharge uniquement des fichiers dont tu as le droit de disposer.');
  assert.match(describePrivacy('mac'), /seulement quand tu touches/);
  assert.match(describePrivacy('mac'), /adresse IP de ce Mac/);
  assert.match(describePrivacy('browser'), /Mes fichiers/);
  assert.match(describePrivacy('browser'), /depuis Clone90 sur le Mac/);
});

test('T34 choix de machine : BIOS seul, candidats de systems.json, « Choisir la machine » en tête si rien n\'est deviné', () => {
  assert.deepEqual(machineOptions({ kind: 'bios', target: 'bios', candidates: [] }, systems), [{ value: 'bios', label: 'BIOS' }]);
  const guessed = machineOptions({ kind: 'rom', target: 'amiga', candidates: ['amiga', 'neogeo'] }, systems);
  assert.deepEqual(guessed, [{ value: 'amiga', label: 'Amiga' }, { value: 'neogeo', label: 'Neo Geo' }]);
  assert.equal(machineOptions({ kind: 'rom', target: null, candidates: ['amiga'] }, systems)[0].value, '');
});

test('T34 sélection : cochés d\'avance seulement si la machine est connue ; sans machine, pas téléchargé et signalé', () => {
  const files = [{ url: 'u1', target: 'amiga' }, { url: 'u2', target: null }, { url: 'u3', target: 'bios' }];
  const choices = initialChoices(files);
  assert.deepEqual(choices.map((c) => c.checked), [true, false, true]);
  assert.deepEqual(selectedItems(files, choices), [{ url: 'u1', target: 'amiga' }, { url: 'u3', target: 'bios' }]);
  choices[1].checked = true;
  assert.equal(missingMachines(choices), 1);
  assert.equal(selectedItems(files, choices).length, 2);
  assert.equal(downloadLabel(2), 'Télécharger la sélection (2)');
  assert.equal(downloadLabel(0), 'Télécharger la sélection');
  assert.match(describeFound(0, false), /Aucun fichier/);
  assert.equal(describeFound(3, true), '3 fichiers trouvés (liste limitée aux premiers)');
  assert.equal(describeLinksProgress({ done: 0, total: 2, name: 'amiga/a.adf' }), 'Téléchargement : 1 sur 2 (amiga/a.adf)...');
});

test('T34 source Mac : analyse par api/links/scan (en-tête X-Clone90, adresse seule), message d\'erreur du serveur repris', async () => {
  const calls = [];
  const fetchFn = async (url, init) => {
    calls.push({ url, init });
    const { url: page } = JSON.parse(init.body);
    return page.includes('prive') ? response(200, { status: 'error', message: 'refusé' }) : response(200, { status: 'ok', url: page, files: [], truncated: false });
  };
  const source = createMacLinkSource({ fetchFn });
  assert.equal((await source.scan('https://a.org/')).status, 'ok');
  assert.deepEqual(await source.scan('http://prive/'), { status: 'error', message: 'refusé' });
  assert.equal(calls[0].url, 'api/links/scan');
  assert.equal(calls[0].init.headers['X-Clone90'], '1');
  assert.deepEqual(JSON.parse(calls[0].init.body), { url: 'https://a.org/' });
  const down = createMacLinkSource({ fetchFn: async () => { throw new TypeError('x'); } });
  assert.match((await down.scan('https://a.org/')).message, /Impossible de joindre Clone90/);
});

test('T34 source Mac : téléchargement lancé puis suivi jusqu\'à la fin, avancement transmis', async () => {
  const states = [{ status: 'running', progress: { done: 0, total: 1 } }, { status: 'done', found: 1, lines: ['Fichiers téléchargés : 1'] }];
  const fetchFn = async (url, init) => (init?.method === 'POST' ? response(202, { status: 'started' }) : response(200, states.shift()));
  const progress = [];
  const result = await createMacLinkSource({ fetchFn, wait: async () => {} }).download([{ url: 'u', target: 'amiga' }], (p) => progress.push(p));
  assert.deepEqual(result, { status: 'done', found: 1, lines: ['Fichiers téléchargés : 1'] });
  assert.deepEqual(progress, [{ done: 0, total: 1 }]);
  const busy = createMacLinkSource({ fetchFn: async () => response(409, { status: 'busy', message: 'occupé' }) });
  assert.deepEqual(await busy.download([]), { status: 'error', message: 'occupé' });
});

test('T34 téléphone : site qui refuse la lecture depuis un navigateur (CORS) : message clair qui renvoie vers le Mac', async () => {
  const source = createBrowserLinkSource({ systems, openLibrary: async () => ({}), fetchFn: async () => { throw new TypeError('Failed to fetch'); } });
  assert.deepEqual(await source.scan('https://a.org/'), { status: 'blocked', message: BLOCKED_TEXT });
  assert.match(BLOCKED_TEXT, /depuis Clone90 sur le Mac/);
  assert.equal((await source.scan('ftp://a.org/')).status, 'error');
});

test('T34 téléphone : page lisible : fichiers trouvés, puis rangés dans « Mes fichiers » (roms/<machine>/, bios/), déjà présents sautés', async () => {
  const stored = new Map([['roms/amiga/deja.adf', 1]]);
  const library = { list: async () => [...stored.keys()].map((path) => ({ path })), put: async (path, blob) => { stored.set(path, blob); } };
  const sent = [];
  const fetchFn = async (url, init) => {
    sent.push(init);
    if (url.endsWith('/page')) return response(200, '<a href="a.adf">a</a><a href="deja.adf">d</a><a href="neogeo.zip">b</a><a href="refus.adf">r</a>', { url: 'https://a.org/page' });
    if (url.endsWith('refus.adf')) throw new TypeError('cors');
    return response(200, null, { blob: async () => ({ size: 3 }) });
  };
  const source = createBrowserLinkSource({ systems, openLibrary: async () => library, fetchFn });
  const scan = await source.scan('a.org/page');
  assert.deepEqual(scan.files.map((f) => [f.name, f.target]), [['a.adf', 'amiga'], ['deja.adf', 'amiga'], ['neogeo.zip', 'bios'], ['refus.adf', 'amiga']]);
  const result = await source.download(scan.files.map((f) => ({ url: f.url, target: f.target })));
  assert.equal(result.found, 2);
  assert.deepEqual(result.lines.slice(0, 3), ['Fichiers téléchargés : 2', 'Déjà présents : 1', 'Échecs : 1']);
  assert.match(result.lines[3], /refuse la lecture depuis un navigateur/);
  assert.ok(stored.has('roms/amiga/a.adf') && stored.has('bios/neogeo.zip'));
  assert.ok(sent.every((i) => i.credentials === 'omit' && i.referrerPolicy === 'no-referrer'), 'aucun cookie ni référent');
});
