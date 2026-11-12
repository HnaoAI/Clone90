// Tests du bouton « Dossiers des jeux » (T25) : client de l'API locale, panneau, bouton de l'accueil, boîte générique, service worker.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/project-root.mjs';
import { fetchFolderSettings, requestFolderChoice, requestCoversDownload, fetchCoversStatus } from '../js/folders-client.js';
import {
  createFoldersPanel, describeFolderLines, describeChoiceResult, describeCoversProgress, describeCoversState, coversAnnounceKey, FOLDER_CHOICES, PENDING_TEXT, COVERS_LABEL, COVERS_INFO,
} from '../js/ui/folders-panel.js';
import { renderHome } from '../js/ui/machine-grid.js';
import { createDialog, nextButtonIndex, resolveDialogAction } from '../js/ui/dialog.js';

// --- Document factice (focus suivi à la main) ---
class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...items) { for (const i of items) this.children.push(i); }
  replaceChildren(...items) { this.children = [...items]; }
  addEventListener(t, f) { this.listeners[t] = f; }
}
function fakeDoc() {
  const d = { activeElement: null, listeners: {}, body: new FakeNode('body') };
  d.addEventListener = (t, f) => { d.listeners[t] = f; };
  d.removeEventListener = (t) => { delete d.listeners[t]; };
  d.createTextNode = (s) => ({ text: s });
  d.createElement = (t) => { const n = new FakeNode(t); n.focus = () => { d.activeElement = n; }; n.remove = () => { n.removed = true; }; return n; };
  return d;
}
const walk = (node, out = []) => { out.push(node); for (const c of node.children ?? []) walk(c, out); return out; };
const textOf = (node) => walk(node).map((n) => n.textContent || n.text || '').join(' ');
const buttonsOf = (node) => walk(node).filter((n) => n.tag === 'button');
const statusOf = (node) => walk(node).find((n) => n.attrs?.role === 'status');
const SETTINGS = { romsDir: '/Users/moi/Jeux/ROMs', biosDir: '/projet/bios', romsIsDefault: false, biosIsDefault: true };
const tick = () => new Promise((r) => setTimeout(r, 0));

// --- Client ---
const fakeFetch = (status, body, record) => async (url, init) => {
  record?.push({ url, init });
  if (body instanceof Error) throw body;
  return { ok: status >= 200 && status < 300, status, json: async () => { if (typeof body === 'string') throw new SyntaxError('x'); return body; } };
};

test('client : fetchFolderSettings renvoie les dossiers quand l\'API répond (adresse relative, sans cache)', async () => {
  const calls = [];
  assert.deepEqual(await fetchFolderSettings(fakeFetch(200, SETTINGS, calls)), SETTINGS);
  assert.equal(calls[0].url, 'api/settings');
  assert.equal(calls[0].init.cache, 'no-store');
});

test('client : fetchFolderSettings renvoie null sans API (404 GitHub Pages, 403, réseau coupé, JSON ou forme invalides)', async () => {
  for (const f of [fakeFetch(404, { message: 'x' }), fakeFetch(403, {}), fakeFetch(200, new Error('réseau')), fakeFetch(200, 'pas du json'),
    fakeFetch(200, { romsDir: 1 }), fakeFetch(200, null), fakeFetch(200, [])]) {
    assert.equal(await fetchFolderSettings(f), null);
  }
});

test('client : requestFolderChoice envoie seulement le type, avec X-Clone90 et JSON, jamais de chemin', async () => {
  const calls = [];
  const out = await requestFolderChoice('roms', fakeFetch(200, { status: 'ok', settings: SETTINGS }, calls));
  assert.equal(out.status, 'ok');
  assert.equal(calls[0].url, 'api/settings/choose');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['X-Clone90'], '1');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(calls[0].init.body), { kind: 'roms' });
});

test('client : requestFolderChoice transforme un refus HTTP, un réseau coupé ou une réponse illisible en statut error avec message français', async () => {
  const refused = await requestFolderChoice('bios', fakeFetch(403, { message: 'Hôte refusé' }));
  assert.equal(refused.status, 'error');
  assert.match(refused.message, /\S/);
  for (const f of [fakeFetch(200, new Error('réseau')), fakeFetch(500, 'pas du json'), fakeFetch(200, [])]) {
    const r = await requestFolderChoice('roms', f);
    assert.equal(r.status, 'error');
    assert.match(r.message, /Impossible|réponse/i);
  }
  const busy = await requestFolderChoice('roms', fakeFetch(409, { status: 'busy', message: 'Une fenêtre de choix est déjà ouverte sur votre Mac.' }));
  assert.equal(busy.status, 'busy');
});

// --- Textes du panneau (purs) ---
test('panneau : describeFolderLines indique le dossier du projet ou le dossier choisi', () => {
  const lines = describeFolderLines(SETTINGS);
  assert.deepEqual(lines.map((l) => [l.label, l.path, l.note]), [['ROMs', '/Users/moi/Jeux/ROMs', 'dossier choisi'], ['BIOS', '/projet/bios', 'dossier du projet']]);
});

test('panneau : quatre choix dans l\'ordre, textes français', () => {
  assert.deepEqual(FOLDER_CHOICES.map((c) => [c.kind, c.label]),
    [['roms', 'Choisir le dossier des ROMs'], ['bios', 'Choisir le dossier des BIOS'], ['roms-default', 'Utiliser les ROMs du projet'], ['bios-default', 'Utiliser les BIOS du projet']]);
});

test('panneau : describeChoiceResult couvre ok, annulé, refusé, erreur, occupé', () => {
  assert.match(describeChoiceResult({ status: 'ok' }).text, /enregistrés/);
  assert.match(describeChoiceResult({ status: 'cancelled' }).text, /Aucun changement/);
  assert.equal(describeChoiceResult({ status: 'refused', message: 'Trop large' }).text, 'Trop large');
  assert.equal(describeChoiceResult({ status: 'error', message: 'Raté' }).text, 'Raté');
  assert.match(describeChoiceResult({ status: 'busy' }).text, /déjà ouverte/);
  assert.match(describeChoiceResult({ status: 'inconnu' }).text, /\S/);
  assert.equal(describeChoiceResult({ status: 'refused', message: 'x' }).tone, 'error');
  assert.equal(describeChoiceResult({ status: 'ok' }).tone, 'ok');
});

// --- Panneau ---
function openPanel({ choose, onChanged = () => {} } = {}) {
  const doc = fakeDoc();
  const panel = createFoldersPanel({ settings: SETTINGS, choose, onChanged }, doc);
  panel.open(doc.body);
  return { doc, panel };
}

test('panneau : role dialog modal, dossiers actuels affichés, zone d\'état aria-live, focus sur le premier choix', () => {
  const { doc, panel } = openPanel({ choose: async () => ({ status: 'cancelled' }) });
  assert.equal(panel.element.attrs.role, 'dialog');
  assert.equal(panel.element.attrs['aria-modal'], 'true');
  const text = textOf(panel.element);
  assert.match(text, /Dossiers des jeux/);
  assert.match(text, /\/Users\/moi\/Jeux\/ROMs/);
  assert.match(text, /\/projet\/bios/);
  assert.equal(statusOf(panel.element).attrs['aria-live'], 'polite');
  assert.deepEqual(buttonsOf(panel.element).map((b) => b.textContent), ['Choisir le dossier des ROMs', 'Choisir le dossier des BIOS', 'Utiliser les ROMs du projet', 'Utiliser les BIOS du projet', 'Fermer']);
  assert.equal(doc.activeElement.textContent, 'Choisir le dossier des ROMs');
  assert.ok(buttonsOf(panel.element).every((b) => b.dataset.nav === ''), 'tous navigables par la couche d\'entrée');
});

test('panneau : pendant le choix, message « Une fenêtre de choix s\'est ouverte sur votre Mac » et appuis ignorés', async () => {
  let resolveChoice;
  const asked = [];
  const { panel } = openPanel({ choose: (kind) => { asked.push(kind); return new Promise((r) => { resolveChoice = r; }); } });
  panel.handleAction('confirm');
  assert.deepEqual(asked, ['roms']);
  assert.equal(PENDING_TEXT, 'Une fenêtre de choix s\'est ouverte sur votre Mac.');
  assert.equal(statusOf(panel.element).textContent, PENDING_TEXT);
  panel.handleAction('down');
  panel.handleAction('confirm');
  assert.deepEqual(asked, ['roms'], 'une seule demande à la fois');
  assert.equal(buttonsOf(panel.element)[0].attrs['aria-disabled'], 'true');
  resolveChoice({ status: 'cancelled', settings: SETTINGS });
  await tick();
  assert.equal(buttonsOf(panel.element)[0].attrs['aria-disabled'], 'false');
});

test('panneau : succès = dossiers mis à jour, message de réussite, onChanged appelé une fois', async () => {
  let changed = 0;
  const newSettings = { ...SETTINGS, biosDir: '/Users/moi/BIOS', biosIsDefault: false };
  const { panel } = openPanel({ choose: async () => ({ status: 'ok', settings: newSettings }), onChanged: () => { changed += 1; } });
  panel.handleAction('down');
  panel.handleAction('confirm');
  await tick();
  assert.equal(changed, 1);
  assert.match(textOf(panel.element), /\/Users\/moi\/BIOS/);
  assert.match(statusOf(panel.element).textContent, /enregistrés/);
});

test('panneau : annulé, refusé ou en erreur = message, dossiers inchangés, onChanged non appelé', async () => {
  for (const result of [{ status: 'cancelled', settings: SETTINGS }, { status: 'refused', message: 'Ce dossier est trop large.', settings: SETTINGS },
    { status: 'error', message: 'Impossible de joindre Clone90.' }]) {
    let changed = 0;
    const { panel } = openPanel({ choose: async () => result, onChanged: () => { changed += 1; } });
    panel.handleAction('confirm');
    await tick();
    assert.equal(changed, 0);
    assert.match(textOf(panel.element), /\/projet\/bios/);
    assert.equal(statusOf(panel.element).textContent, describeChoiceResult(result).text);
  }
});

test('panneau : Fermer et retour ferment, le panneau capte toutes les actions tant qu\'il est ouvert', async () => {
  const a = openPanel({ choose: async () => ({ status: 'cancelled' }) });
  assert.equal(a.panel.handleAction('left'), true);
  for (let i = 0; i < 4; i += 1) a.panel.handleAction('down');
  assert.equal(a.doc.activeElement.textContent, 'Fermer');
  a.panel.handleAction('down');
  assert.equal(a.doc.activeElement.textContent, 'Fermer', 'pas de bouclage');
  a.panel.handleAction('confirm');
  await a.panel.result;
  assert.equal(a.panel.element.removed, true);
  assert.equal(a.panel.handleAction('up'), false);
  const b = openPanel({ choose: async () => ({ status: 'cancelled' }) });
  b.panel.handleAction('back');
  await b.panel.result;
  assert.equal(b.panel.element.removed, true);
});

test('panneau : un échec inattendu de choose est affiché sans planter', async () => {
  const { panel } = openPanel({ choose: async () => { throw new Error('boum'); } });
  panel.handleAction('confirm');
  await tick();
  assert.match(statusOf(panel.element).textContent, /\S/);
  assert.ok(!statusOf(panel.element).textContent.includes('boum'));
});

// --- Bouton de l'accueil ---
const home = (extra = {}) => renderHome({ tiles: [], gamesStatus: 'ok', ...extra }, fakeDoc());

test('accueil : le bouton « Dossiers des jeux » n\'apparaît que si onOpenFolders est fourni (jamais sans API)', () => {
  assert.equal(buttonsOf(home()).length, 0);
  const withButton = buttonsOf(home({ onOpenFolders: () => {} }));
  assert.equal(withButton.length, 1);
  assert.equal(withButton[0].textContent, 'Dossiers des jeux');
  assert.equal(withButton[0].dataset.nav, '');
  assert.equal(withButton[0].dataset.navId, 'folders');
  assert.match(withButton[0].attrs.class, /\bbutton\b/);
});

test('accueil : cliquer sur le bouton appelle onOpenFolders', () => {
  let opened = 0;
  const [button] = buttonsOf(home({ onOpenFolders: () => { opened += 1; } }));
  button.listeners.click();
  assert.equal(opened, 1);
});

// --- Boîte générique ---
test('dialogue : navigation verticale (haut/bas) pour une colonne de boutons, sans bouclage', () => {
  assert.equal(nextButtonIndex(0, 'down', 4, true), 1);
  assert.equal(nextButtonIndex(3, 'down', 4, true), 3);
  assert.equal(nextButtonIndex(1, 'up', 4, true), 0);
  assert.equal(nextButtonIndex(1, 'right', 4, true), 1);
  assert.deepEqual(resolveDialogAction('down', 0, 3, true), { type: 'focus', index: 1 });
});

test('dialogue : createDialog résout la valeur transmise à close, valeur d\'annulation sur retour', async () => {
  const doc = fakeDoc();
  const a = createDialog({ title: 't', buttons: [{ label: 'A' }, { label: 'B' }], onPress: (i, { close }) => close(`bouton-${i}`) }, doc);
  a.open(doc.body);
  a.handleAction('right');
  a.handleAction('confirm');
  assert.equal(await a.result, 'bouton-1');
  const b = createDialog({ title: 't', buttons: [{ label: 'A' }], onPress: () => {}, cancelValue: 'annulé' }, doc);
  b.open(doc.body);
  b.handleAction('back');
  assert.equal(await b.result, 'annulé');
});

// --- Pochettes (T28) ---
test('client pochettes : requestCoversDownload envoie POST {} avec X-Clone90 et JSON, adresse relative, sans paramètre', async () => {
  const calls = [];
  assert.deepEqual(await requestCoversDownload(fakeFetch(202, { status: 'started' }, calls)), { status: 'started' });
  assert.equal(calls[0].url, 'api/covers/download');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['X-Clone90'], '1');
  assert.equal(calls[0].init.headers['Content-Type'], 'application/json');
  assert.equal(calls[0].init.body, '{}');
});

test('client pochettes : déjà en cours (409), refus, réseau coupé ou réponse illisible = statut busy ou error avec message français', async () => {
  const busy = await requestCoversDownload(fakeFetch(409, { status: 'busy', message: 'Le téléchargement des pochettes est en cours.' }));
  assert.deepEqual([busy.status, busy.message], ['busy', 'Le téléchargement des pochettes est en cours.']);
  for (const f of [fakeFetch(403, { message: 'Hôte refusé' }), fakeFetch(200, new Error('réseau')), fakeFetch(500, 'pas du json'), fakeFetch(202, [])]) {
    const r = await requestCoversDownload(f);
    assert.equal(r.status, 'error');
    assert.match(r.message, /\S/);
  }
});

test('client pochettes : fetchCoversStatus lit api/covers sans cache ; null si invalide ou injoignable', async () => {
  const calls = [];
  const state = { status: 'running', progress: { phase: 'listing', done: 0, total: 3 } };
  assert.deepEqual(await fetchCoversStatus(fakeFetch(200, state, calls)), state);
  assert.equal(calls[0].url, 'api/covers');
  assert.equal(calls[0].init.cache, 'no-store');
  for (const f of [fakeFetch(404, {}), fakeFetch(200, new Error('x')), fakeFetch(200, { status: 'bizarre' }), fakeFetch(200, [])]) assert.equal(await fetchCoversStatus(f), null);
});

test('pochettes : describeCoversProgress dit la liste lue, puis « n sur total » ; rien d\'autre ne change', () => {
  assert.match(describeCoversProgress({ phase: 'listing', system: 'Amiga', done: 0, total: 5 }), /liste.*Amiga/i);
  assert.match(describeCoversProgress({ phase: 'downloading', done: 12, total: 80 }), /12 sur 80/);
  assert.match(describeCoversProgress(undefined), /\S/);
});

test('pochettes : describeCoversState couvre terminé (avec ou sans nouveautés), erreur, inactif ; une ligne par résultat', () => {
  const done = describeCoversState({ status: 'done', found: 3, lines: ['Pochettes téléchargées : 3', 'Déjà présentes : 1'] });
  assert.equal(done.tone, 'ok');
  assert.equal(done.finished, true);
  assert.equal(done.text, 'Pochettes téléchargées : 3\nDéjà présentes : 1');
  assert.equal(describeCoversState({ status: 'done', found: 0, lines: ['Introuvables : 4'] }).tone, 'info');
  assert.deepEqual([describeCoversState({ status: 'error', message: 'Raté' }).text, describeCoversState({ status: 'error', message: 'Raté' }).tone], ['Raté', 'error']);
  assert.equal(describeCoversState({ status: 'running', progress: { phase: 'downloading', done: 1, total: 2 } }).finished, false);
});

test('pochettes : coversAnnounceKey change à chaque phase ou machine, puis tous les 10 % seulement', () => {
  assert.notEqual(coversAnnounceKey({ phase: 'listing', system: 'Amiga' }), coversAnnounceKey({ phase: 'listing', system: 'Neo Geo' }));
  const key = (done) => coversAnnounceKey({ phase: 'downloading', done, total: 100 });
  assert.equal(key(0), key(9));
  assert.notEqual(key(9), key(10));
  assert.equal(key(10), key(19));
  assert.notEqual(coversAnnounceKey({ phase: 'listing', system: 'Amiga' }), key(0));
  assert.equal(new Set(Array.from({ length: 101 }, (_, i) => key(i))).size, 11);
});

function openCoversPanel({ states = [], start = async () => ({ status: 'started' }), coversRunning = false, onChanged = () => {}, onCoversDone = () => {}, wait = async () => {} } = {}) {
  const doc = fakeDoc();
  const polled = [];
  const covers = { start, status: async () => { polled.push(1); return states.shift() ?? { status: 'idle' }; } };
  const panel = createFoldersPanel({ settings: SETTINGS, choose: async () => ({ status: 'cancelled' }), onChanged, onCoversDone, covers, coversRunning, wait }, doc);
  panel.open(doc.body);
  return { doc, panel, polled };
}
const pressCovers = (panel) => { for (let i = 0; i < 4; i += 1) panel.handleAction('down'); panel.handleAction('confirm'); };
const settle = async () => { for (let i = 0; i < 10; i += 1) await tick(); };
const barOf = (panel) => walk(panel.element).find((n) => n.tag === 'progress');
const running = (done, total = 100) => ({ status: 'running', progress: { phase: 'downloading', done, total } });

test('panneau pochettes : le bouton « Télécharger les pochettes » est entre les quatre choix et Fermer, séparé visuellement, seulement si l\'API des pochettes est fournie', () => {
  assert.equal(COVERS_LABEL, 'Télécharger les pochettes');
  const { panel } = openCoversPanel();
  const buttons = buttonsOf(panel.element);
  assert.deepEqual(buttons.map((b) => b.textContent), [...FOLDER_CHOICES.map((c) => c.label), COVERS_LABEL, 'Fermer']);
  assert.ok(buttons.every((b) => b.dataset.nav === ''));
  assert.match(buttons[4].attrs.class, /\bis-separated\b/);
  assert.ok(buttons.slice(0, 4).every((b) => !/is-separated/.test(b.attrs.class)));
  const plain = openPanel({ choose: async () => ({ status: 'cancelled' }) });
  assert.ok(!buttonsOf(plain.panel.element).some((b) => b.textContent === COVERS_LABEL));
  assert.ok(!buttonsOf(plain.panel.element).some((b) => /is-separated/.test(b.attrs.class)));
});

test('panneau pochettes : le texte dit que Clone90 contacte github.com uniquement au clic, que GitHub voit l\'adresse IP et les noms des jeux cherchés, et que rien d\'autre n\'est envoyé', () => {
  assert.match(COVERS_INFO, /se connecte à Internet \(github\.com/);
  assert.match(COVERS_INFO, /uniquement quand vous cliquez sur ce bouton/);
  assert.match(COVERS_INFO, /GitHub voit votre adresse IP et les noms des jeux cherchés/);
  assert.match(COVERS_INFO, /rien d'autre n'est envoyé/);
  assert.match(COVERS_INFO, /usage personnel/);
  const { panel } = openCoversPanel();
  assert.match(textOf(panel.element), /uniquement quand vous cliquez sur ce bouton/);
});

test('panneau pochettes : aria-describedby relie la boîte à son texte d\'introduction et au texte sur Internet (et seulement à ceux qui existent)', () => {
  const { panel } = openCoversPanel();
  const ids = panel.element.attrs['aria-describedby'].split(' ');
  assert.deepEqual(ids, ['folders-intro', 'folders-covers-info']);
  const present = new Set(walk(panel.element).map((n) => n.attrs?.id));
  assert.ok(ids.every((id) => present.has(id)));
  const plain = openPanel({ choose: async () => ({ status: 'cancelled' }) });
  assert.equal(plain.panel.element.attrs['aria-describedby'], 'folders-intro');
});

test('panneau pochettes : la zone role=status n\'est mise à jour qu\'au changement de phase puis tous les 10 %, la barre visuelle (aria-hidden, hors zone) à chaque lecture', async () => {
  const { panel } = openCoversPanel({
    states: [{ status: 'running', progress: { phase: 'listing', system: 'Amiga', done: 0, total: 50 } }, running(1, 50), running(4, 50), running(5, 50), running(9, 50),
      running(10, 50), { status: 'done', found: 2, lines: ['Pochettes téléchargées : 2'] }],
  });
  const status = statusOf(panel.element);
  const writes = [];
  let text = '';
  Object.defineProperty(status, 'textContent', { get: () => text, set: (v) => { text = v; writes.push(v); } });
  const values = [];
  const bar = barOf(panel);
  const setAttr = bar.setAttribute.bind(bar);
  bar.setAttribute = (k, v) => { if (k === 'value') values.push(v); setAttr(k, v); };
  pressCovers(panel);
  await settle();
  assert.equal(bar.attrs['aria-hidden'], 'true');
  assert.ok(!walk(status).includes(bar) && !status.children.includes(bar), 'la barre n\'est pas dans la zone annoncée');
  // Annonces : recherche initiale, liste Amiga, 2 % (tranche 0 de 10), 10 % (5/50), 20 % (10/50), résumé.
  assert.deepEqual(writes, ['Recherche des pochettes en cours...', 'Lecture de la liste des pochettes (Amiga)...', 'Téléchargement des pochettes : 1 sur 50...',
    'Téléchargement des pochettes : 5 sur 50...', 'Téléchargement des pochettes : 10 sur 50...', 'Pochettes téléchargées : 2']);
  assert.deepEqual(values, ['2', '8', '10', '18', '20']);
  assert.ok(barOf(panel).attrs.hidden !== undefined, 'barre masquée à la fin');
});

test('panneau pochettes : résumé final en lignes séparées, onCoversDone appelé une fois avec l\'état, onChanged (dossiers) non appelé', async () => {
  const done = { id: 7, status: 'done', found: 2, lines: ['Pochettes téléchargées : 2', 'Déjà présentes : 1', 'Introuvables : 1'] };
  const finished = [];
  let changed = 0;
  const { panel } = openCoversPanel({ states: [running(1), done], onCoversDone: (st) => finished.push(st), onChanged: () => { changed += 1; } });
  pressCovers(panel);
  await settle();
  assert.equal(statusOf(panel.element).textContent, 'Pochettes téléchargées : 2\nDéjà présentes : 1\nIntrouvables : 1');
  assert.deepEqual(finished, [done]);
  assert.equal(changed, 0);
  assert.ok(buttonsOf(panel.element).every((b) => b.attrs['aria-disabled'] !== 'true'), 'boutons réactivés');
});

test('panneau pochettes : pendant le téléchargement, les autres choix sont désactivés et les appuis ignorés', async () => {
  const startCalls = [];
  const { panel } = openCoversPanel({ start: async () => { startCalls.push(1); return { status: 'started' }; }, states: [running(1, 9)] });
  pressCovers(panel);
  assert.equal(buttonsOf(panel.element)[0].attrs['aria-disabled'], 'true');
  assert.equal(buttonsOf(panel.element)[4].attrs['aria-disabled'], 'true');
  panel.handleAction('confirm');
  await tick();
  assert.equal(startCalls.length, 1, 'une seule demande');
});

test('panneau pochettes : erreur du travail = onCoversDone avec l\'erreur ; déjà en cours ou refus au lancement = message seulement', async () => {
  for (const [start, states, expected, notified] of [
    [async () => ({ status: 'started' }), [{ status: 'error', message: 'Le téléchargement des pochettes a échoué.' }], /a échoué/, 1],
    [async () => ({ status: 'busy', message: 'Le téléchargement des pochettes est en cours.' }), [], /est en cours/, 0],
    [async () => ({ status: 'error', message: 'Impossible de joindre Clone90.' }), [], /Impossible/, 0],
  ]) {
    const finished = [];
    const { panel } = openCoversPanel({ start, states, onCoversDone: (st) => finished.push(st) });
    pressCovers(panel);
    await settle();
    assert.match(statusOf(panel.element).textContent, expected);
    assert.equal(finished.length, notified);
  }
});

test('panneau pochettes : le serveur ne répond plus pendant le suivi = message d\'erreur et boutons réactivés (pas de boucle infinie)', async () => {
  const doc = fakeDoc();
  const covers = { start: async () => ({ status: 'started' }), status: async () => null };
  const panel = createFoldersPanel({ settings: SETTINGS, choose: async () => ({ status: 'cancelled' }), onChanged: () => {}, covers, wait: async () => {} }, doc);
  panel.open(doc.body);
  pressCovers(panel);
  await settle();
  assert.match(statusOf(panel.element).textContent, /Impossible de joindre/);
  assert.notEqual(buttonsOf(panel.element)[0].attrs['aria-disabled'], 'true');
});

test('panneau pochettes : rouvert pendant un téléchargement, le suivi reprend sans en relancer un', async () => {
  const startCalls = [];
  const finished = [];
  const { panel, polled } = openCoversPanel({ coversRunning: true, start: async () => { startCalls.push(1); return { status: 'started' }; },
    states: [{ id: 3, status: 'done', found: 1, lines: ['Pochettes téléchargées : 1'] }], onCoversDone: (st) => finished.push(st.id) });
  await settle();
  assert.equal(startCalls.length, 0);
  assert.ok(polled.length >= 1);
  assert.deepEqual(finished, [3]);
});

test('panneau pochettes : fermer le panneau ne coupe pas le suivi, onCoversDone est appelé à la fin (accueil rechargé et message par l\'hôte)', async () => {
  const finished = [];
  const states = [running(1), running(2), running(3), { id: 1, status: 'done', found: 4, lines: ['Pochettes téléchargées : 4'] }];
  let release;
  const gate = new Promise((r) => { release = r; });
  const { panel } = openCoversPanel({ states, onCoversDone: (st) => finished.push(st.found), wait: () => gate });
  pressCovers(panel);
  await tick();
  panel.handleAction('back');
  await panel.result;
  assert.deepEqual(finished, [], 'pas encore fini');
  release();
  await settle();
  assert.deepEqual(finished, [4]);
});

// --- Service worker ---
test('service worker : /api/ n\'est jamais pris en charge ni mis en cache (règle 6, réseau direct)', () => {
  const sandbox = { URL, decodeURIComponent, self: null };
  sandbox.self = { addEventListener: () => {}, location: new URL('https://exemple.test/sw.js?v=1') };
  vm.runInNewContext(readFileSync(join(PROJECT_ROOT, 'sw.js'), 'utf8'), sandbox);
  const sw = sandbox.self.Clone90SW;
  const scope = 'http://localhost:8080/';
  for (const path of ['api/settings', 'api/settings/choose', 'api/', 'api/settings?x=1']) {
    assert.equal(sw.shouldHandle('GET', `${scope}${path}`, scope), false, path);
    assert.equal(sw.shouldHandle('POST', `${scope}${path}`, scope), false, `POST ${path}`);
    assert.equal(sw.isNeverCached(path.split('?')[0]), true, `NEVER_CACHED ${path}`);
  }
  assert.equal(sw.shouldHandle('GET', `${scope}api/settings`, scope, ['api/settings']), false, 'même listé comme logo');
  assert.ok(sw.SHELL_FILES.includes('js/folders-client.js') && sw.SHELL_FILES.includes('js/ui/folders-panel.js'), 'nouveaux modules dans la coquille');
});
