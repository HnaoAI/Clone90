// Tests des parties pures de l'écran de jeu (T7) : rappel de sortie, textes, anneau de progression, mode d'entrée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exitHintText, shouldShowExitHint, EXIT_HINT_MAX_LAUNCHES, EXIT_HINT_STORAGE_KEY } from '../js/player/exit-hint.js';
import { exitDialogOptions, ringDashOffset, describeLoadError, playScreenModel } from '../js/player/player-ui.js';
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
