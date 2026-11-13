// Tests T37 « réglette de taille de l'image » : bornes (40 à 100 %, pas de 5), mémorisation par machine, réglette (souris seulement),
// curseur, double-clic qui remet à 100 %, focus rendu au jeu après un réglage à la souris, CSS de #game.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/project-root.mjs';
import {
  clampScale, readScale, saveScale, scaleLabel, canShowScaleControl, createScaleControl, SCALE_MIN, SCALE_MAX, SCALE_STEP, SCALE_STORAGE_KEY,
} from '../js/player/game-scale.js';

const memoryStorage = (initial = {}) => {
  const data = { ...initial };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); } };
};

test('T37 plage de taille : 40 % à 100 % par pas de 5 ; valeurs invalides, vides ou hors bornes ramenées dans la plage (100 % par défaut)', () => {
  assert.deepEqual([SCALE_MIN, SCALE_MAX, SCALE_STEP], [40, 100, 5]);
  assert.equal(clampScale(75), 75);
  assert.equal(clampScale('60'), 60);
  assert.equal(clampScale(73), 75);
  assert.equal(clampScale(10), 40);
  assert.equal(clampScale(250), 100);
  assert.equal(clampScale(-5), 40);
  for (const bad of [undefined, null, '', 'abc', NaN, Infinity, {}]) assert.equal(clampScale(bad), 100, String(bad));
});

test('T37 mémorisation : une taille par machine, retrouvée au jeu suivant ; les autres machines gardent la leur', () => {
  const storage = memoryStorage();
  assert.equal(readScale(storage, 'amiga'), 100, 'rien de gardé : 100 %');
  assert.equal(saveScale(storage, 'amiga', 60), 60);
  assert.equal(saveScale(storage, 'neogeo', 85), 85);
  assert.equal(readScale(storage, 'amiga'), 60);
  assert.equal(readScale(storage, 'neogeo'), 85);
  assert.equal(readScale(storage, 'nes'), 100);
  assert.deepEqual(JSON.parse(storage.data[SCALE_STORAGE_KEY]), { amiga: 60, neogeo: 85 });
  assert.equal(saveScale(storage, 'amiga', 7), 40, 'valeur enregistrée bornée');
});

test('T37 mémorisation : stockage absent, refusé ou abîmé : 100 %, jamais d\'erreur', () => {
  assert.equal(readScale(null, 'amiga'), 100);
  assert.equal(saveScale(null, 'amiga', 50), 50);
  const throwing = { getItem: () => { throw new Error('refusé'); }, setItem: () => { throw new Error('plein'); } };
  assert.equal(readScale(throwing, 'amiga'), 100);
  assert.equal(saveScale(throwing, 'amiga', 50), 50);
  for (const raw of ['{pas du json', '[1,2]', '"x"', '{"amiga":"énorme"}', 'null']) assert.equal(readScale(memoryStorage({ [SCALE_STORAGE_KEY]: raw }), 'amiga'), 100, raw);
  const broken = memoryStorage({ [SCALE_STORAGE_KEY]: '{pas du json' });
  saveScale(broken, 'nes', 70);
  assert.deepEqual(JSON.parse(broken.data[SCALE_STORAGE_KEY]), { nes: 70 });
  assert.equal(readScale(memoryStorage(), '__proto__'), 100);
});

test('T37 affichage : « 75 % » ; réglette seulement avec une souris (ordinateur), jamais en tactile', () => {
  assert.equal(scaleLabel(75), '75 %');
  assert.equal(scaleLabel(3), '40 %');
  const media = (fine) => (q) => ({ matches: q === '(hover: hover) and (pointer: fine)' ? fine : false });
  assert.equal(canShowScaleControl(media(true)), true);
  assert.equal(canShowScaleControl(media(false)), false);
  assert.equal(canShowScaleControl(undefined), false);
});

// --- Document factice ---
class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; this.value = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...items) { for (const i of items) this.children.push(i); }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
  emit(t) { for (const f of this.listeners[t] ?? []) f({ target: this }); }
  blur() { this.blurred = (this.blurred ?? 0) + 1; }
}
const fakeDoc = () => ({ createElement: (t) => new FakeNode(t), createTextNode: (s) => ({ text: s }) });

test('T37 réglette : curseur 40 à 100 par pas de 5, nom accessible, valeur affichée ; déplacer le curseur règle et prévient', () => {
  const changes = [];
  const c = createScaleControl({ value: 70, onChange: (v) => changes.push(v) }, fakeDoc());
  assert.equal(c.input.attrs.type, 'range');
  assert.deepEqual([c.input.attrs.min, c.input.attrs.max, c.input.attrs.step], ['40', '100', '5']);
  assert.equal(c.input.attrs['aria-label'], 'Taille de l\'image du jeu');
  assert.equal(c.input.value, '70');
  assert.equal(c.label.textContent, '70 %');
  assert.equal(c.input.attrs['aria-valuetext'], '70 %');
  c.input.value = '45';
  c.input.emit('input');
  assert.deepEqual(changes, [45]);
  assert.equal(c.label.textContent, '45 %');
});

test('T37 réglette : double-clic remet à 100 % ; après un réglage à la souris, le focus est rendu au jeu (les flèches restent au jeu)', () => {
  const changes = [];
  const c = createScaleControl({ value: 50, onChange: (v) => changes.push(v) }, fakeDoc());
  c.element.emit('dblclick');
  assert.deepEqual(changes, [100]);
  assert.equal(c.input.value, '100');
  c.input.emit('pointerup');
  assert.equal(c.input.blurred, 1);
  c.set(20);
  assert.equal(c.input.value, '40');
});

test('T37 CSS : #game réduit et centré par --game-scale seulement avec la réglette (rien ne change sans elle) ; réglette sur le bord droit, cachée au repos', () => {
  const css = readFileSync(join(PROJECT_ROOT, 'css', 'player.css'), 'utf8');
  const scaled = /body\.has-game-scale #game \{([^}]*)\}/.exec(css)[1];
  assert.match(scaled, /transform: scale\(var\(--game-scale\)\)/);
  assert.match(scaled, /transform-origin: 50% 50%/);
  assert.match(readFileSync(join(PROJECT_ROOT, 'css', 'base.css'), 'utf8'), /--game-scale: 1;/);
  assert.match(css, /\.scale-wrap \{[^}]*right:/);
  assert.match(css, /\.is-idle \.scale-wrap:not\(:focus-within\)[^{]*\{[^}]*opacity: 0/);
});
