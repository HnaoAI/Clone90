// Tests des parties pures de l'écran de jeu (T7) : rappel de sortie, textes, anneau de progression, mode d'entrée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exitHintText, shouldShowExitHint, EXIT_HINT_MAX_LAUNCHES, EXIT_HINT_STORAGE_KEY } from '../js/player/exit-hint.js';
import { exitDialogOptions, ringDashOffset, describeLoadError, playScreenModel, renderPlayScreen, READY_LABEL } from '../js/player/player-ui.js';
import { setGamepadMode, watchPointer } from '../js/ui/input-mode.js';

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { getItem: (k) => data[k] ?? null, setItem: (k, v) => { data[k] = String(v); }, data };
};

test('shouldShowExitHint : montré aux 3 premiers lancements seulement', () => {
  const storage = memoryStorage();
  const results = Array.from({ length: 5 }, () => shouldShowExitHint(storage));
  assert.deepEqual(results, [true, true, true, false, false]);
  assert.equal(EXIT_HINT_MAX_LAUNCHES, 3);
});

test('shouldShowExitHint : compteur illisible ou négatif repart de zéro', () => {
  assert.equal(shouldShowExitHint(memoryStorage({ [EXIT_HINT_STORAGE_KEY]: 'abc' })), true);
  assert.equal(shouldShowExitHint(memoryStorage({ [EXIT_HINT_STORAGE_KEY]: '-4' })), true);
});

test('shouldShowExitHint : stockage absent ou qui lève (navigation privée) donne true sans planter', () => {
  assert.equal(shouldShowExitHint(null), true);
  assert.equal(shouldShowExitHint({ getItem: () => { throw new Error('SecurityError'); }, setItem: () => {} }), true);
});

test('exitDialogOptions : titre avec le jeu, boutons Continuer / Quitter (docs/ux.md 3.4)', () => {
  const o = exitDialogOptions('Metal Slug');
  assert.equal(o.title, 'Quitter Metal Slug ?');
  assert.equal(o.cancelLabel, 'Continuer');
  assert.equal(o.confirmLabel, 'Quitter');
  assert.match(o.message, /perdue/);
});

test('ringDashOffset : 0 = anneau vide (100), 1 = plein (0), valeurs hors bornes ramenées', () => {
  assert.equal(ringDashOffset(0), 100);
  assert.equal(ringDashOffset(0.25), 75);
  assert.equal(ringDashOffset(1), 0);
  assert.equal(ringDashOffset(7), 0);
  assert.equal(ringDashOffset(-1), 100);
  assert.equal(ringDashOffset(Number.NaN), 100);
});

test('describeLoadError : jeu ou machine inconnus, games.json absent, erreur de données', () => {
  assert.match(describeLoadError({ reason: 'no-params' }).detail, /liste/);
  assert.equal(describeLoadError({ reason: 'unknown-game' }).title, 'Jeu introuvable');
  assert.match(describeLoadError({ reason: 'no-games', gamesStatus: 'absent' }).detail, /generate-games/);
  assert.match(describeLoadError({ reason: 'data', message: 'systems.json : HTTP 404' }).detail, /systems\.json/);
  assert.ok(describeLoadError({ reason: 'autre' }).title);
});

test('playScreenModel : titre, nom de la machine, libellé du bouton (CA-J7)', () => {
  const m = playScreenModel({ name: 'Neo Geo' }, { title: 'Metal Slug' });
  assert.deepEqual(m, { title: 'Metal Slug', machineName: 'Neo Geo', playLabel: 'Jouer' });
});

test('setGamepadMode / watchPointer : la souris coupe le mode manette', () => {
  const classes = new Set();
  const doc = { body: { classList: { toggle: (c, on) => (on ? classes.add(c) : classes.delete(c)) } } };
  const handlers = {};
  const win = { document: doc, addEventListener: (t, f) => { handlers[t] = f; } };
  setGamepadMode(true, doc);
  assert.ok(classes.has('input-gamepad'));
  watchPointer(win);
  handlers.pointerdown();
  assert.ok(!classes.has('input-gamepad'));
});

test('exitHintText : texte court sur tactile sans manette, complet sinon', () => {
  assert.equal(exitHintText(true), 'Quitter : bouton Menu');
  assert.match(exitHintText(false), /Select \+ Start.*F10.*Menu/);
});

// T11 / A2
import { exitDecision } from '../js/player/player-ui.js';

test('exitDecision A2 : en erreur (moteur non chargé) le Menu et la sortie quittent directement', () => {
  assert.equal(exitDecision('error'), 'leave');
  assert.equal(exitDecision('ready'), 'leave');
  assert.equal(exitDecision('dialog'), 'leave');
});

test('exitDecision : pendant le jeu on demande confirmation ; au démarrage ou phase inconnue, rien', () => {
  assert.equal(exitDecision('playing'), 'confirm');
  assert.equal(exitDecision('boot'), 'none');
  assert.equal(exitDecision(undefined), 'none');
});

// T11 / A6
test('describeLoadError A6 : liste des jeux injoignable (hors ligne) n\'accuse pas un jeu déplacé', () => {
  const e = describeLoadError({ reason: 'no-games', gamesStatus: 'offline' });
  assert.match(e.title + e.detail, /hors ligne|connexion|serveur/i);
  assert.doesNotMatch(e.title, /introuvable/i);
});

// --- T14 : écran d'échec de démarrage ---
import { describeStartFailure, renderPlayerMessage } from '../js/player/player-ui.js';

test('T14 describeStartFailure : titre en français et raison "manquant ou incorrect" quand le cœur le dit', () => {
  const { title, details } = describeStartFailure({ coreMessages: ['[FBNeo] ROM sp-s3.sp1 is missing'] });
  assert.equal(title, "Ce jeu n'a pas pu démarrer");
  assert.match(details[0], /manquant ou incorrect/);
  assert.match(details.at(-1), /Détail technique : \[FBNeo\] ROM sp-s3\.sp1 is missing/);
});

test('T14 describeStartFailure : raison inconnue, message générique sans détail technique ; sans argument ne plante pas', () => {
  for (const info of [{ coreMessages: [] }, {}, undefined]) {
    const { title, details } = describeStartFailure(info);
    assert.equal(title, "Ce jeu n'a pas pu démarrer");
    assert.match(details[0], /refusé/);
    assert.ok(!details.some((d) => d.startsWith('Détail technique')));
  }
});

test('T14 describeStartFailure : texte hostile du cœur laissé tel quel (affiché en texte, jamais en HTML)', () => {
  const { details } = describeStartFailure({ coreMessages: ['<img src=x onerror=alert(1)> is missing'] });
  assert.ok(details.at(-1).includes('<img'));
});

test('T14 écran d\'échec : message en role=alert avec un bouton, et la phase error quitte en un appui', () => {
  const made = [];
  const doc = { createElement: (tag) => { const e = { tag, children: [], attrs: {}, dataset: {}, classList: { add() {} }, append(...c) { this.children.push(...c); }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {} }; made.push(e); return e; }, createTextNode: (t) => ({ text: t }) };
  const { title, details } = describeStartFailure({ coreMessages: [] });
  assert.doesNotThrow(() => renderPlayerMessage({ title, details, actionLabel: 'Revenir à la liste', onAction: () => {} }, doc));
  assert.equal(exitDecision('error'), 'leave');
});

// --- T18 : IPF non pris en charge par le cœur puae d'EmulatorJS 4.2.3 (capsimg.so introuvable, dlopen désactivé) ---
test('T18 describeStartFailure : un échec sur un jeu .ipf explique le format et propose ADF', () => {
  const { details } = describeStartFailure({ coreMessages: [], gameFiles: ['roms/Amiga/Leander/Leander_Disk1.ipf'] });
  assert.match(details[0], /IPF/);
  assert.match(details[0], /ADF/);
});

test('T18 describeStartFailure : un message du cœur sur le plugin C.A.P.S. / capsimg est expliqué même sans fichier .ipf connu', () => {
  for (const msg of ['CAPS library capsimg.so not found!', 'This disk image needs the C.A.P.S. plugin which is available from http://www.softpres.org/download']) {
    const { details } = describeStartFailure({ coreMessages: [msg] });
    assert.match(details[0], /IPF/, msg);
    assert.match(details.at(-1), /Détail technique/);
  }
});

test('T18 describeStartFailure : un jeu ADF qui échoue ne parle pas d\'IPF', () => {
  const { details } = describeStartFailure({ coreMessages: [], gameFiles: ['roms/amiga/a.adf'] });
  assert.ok(!details.some((d) => /IPF/.test(d)));
});

// --- T24 : mention « PRÊT ? » de l'écran Jouer ---
test('T24 écran Jouer : « PRÊT ? » décoratif (aria-hidden) avant le bouton Jouer, titre et bouton inchangés', () => {
  const doc = { createElement: (tag) => ({ tag, children: [], attrs: {}, dataset: {}, textContent: '', append(...c) { this.children.push(...c); }, setAttribute(k, v) { this.attrs[k] = v; }, addEventListener() {} }), createTextNode: (t) => ({ text: t }) };
  const screen = renderPlayScreen({ machine: { id: 'neogeo', name: 'Neo Geo', accent: '--m-neogeo' }, game: { id: 'neogeo/x', title: 'Star Courier' }, onPlay() {} }, doc);
  const kids = screen.children;
  const ready = kids.find((c) => c.attrs.class === 'ready');
  assert.equal(READY_LABEL, 'PRÊT ?');
  assert.equal(ready.textContent, READY_LABEL);
  assert.equal(ready.attrs['aria-hidden'], 'true');
  assert.equal(kids.at(-1).textContent, 'Jouer', 'le bouton Jouer reste le dernier élément (focus initial inchangé)');
  assert.ok(kids.indexOf(ready) < kids.length - 1);
  assert.equal(kids.find((c) => c.tag === 'h1').textContent, 'Star Courier');
});
