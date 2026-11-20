// Tests T46 : rubrique « Jouer sans réseau » de « Mes fichiers » et message du lecteur quand le moteur manque. Faux DOM minimal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderLibrary, PREPARE_OFFLINE_NAV_ID, OFFLINE_LIBRARY_INFO } from '../js/ui/library-screen.js';
import { loadEmulator, buildLaunchPlan } from '../js/player/launcher.js';

class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...items) { this.children.push(...items); }
  addEventListener(t, f) { this.listeners[t] = f; }
  walk(fn) { fn(this); this.children.forEach((c) => c.walk?.(fn)); }
}
const doc = { createElement: (t) => new FakeNode(t), createTextNode: (s) => ({ text: s }) };
const find = (root, pred) => { const out = []; root.walk((n) => pred(n) && out.push(n)); return out; };
const nes = { id: 'nes', name: 'NES', emulatorjsCore: 'nes', extensions: ['nes'] };
const base = { systems: [nes], entries: [], supported: true, onAddGames() {}, onAddBios() {}, onRemove() {} };
const offlineButton = (root) => find(root, (n) => n.tag === 'button' && n.dataset.navId === PREPARE_OFFLINE_NAV_ID)[0];

test('T46 « Mes fichiers » : bouton « Préparer le jeu hors ligne » navigable, qui lance la préparation', () => {
  const calls = [];
  const root = renderLibrary({ ...base, offlineSupported: true, onPrepareOffline: () => calls.push('offline') }, doc);
  const button = offlineButton(root);
  assert.equal(button.textContent, 'Préparer le jeu hors ligne');
  assert.equal(button.dataset.nav, '');
  assert.ok(!('disabled' in button.attrs));
  button.listeners.click();
  assert.deepEqual(calls, ['offline']);
  const texts = find(root, (n) => n.textContent).map((n) => n.textContent);
  assert.ok(texts.includes('Jouer sans réseau'));
  assert.ok(texts.includes(OFFLINE_LIBRARY_INFO));
  assert.match(OFFLINE_LIBRARY_INFO, /cdn\.emulatorjs\.org/);
  assert.match(OFFLINE_LIBRARY_INFO, /première partie/);
  assert.ok(!texts.some((t) => /Il faut internet seulement pour le moteur/.test(t)), 'l\'introduction ne dit plus qu\'internet est toujours nécessaire');
});

test('T46 « Mes fichiers » : bouton désactivé pendant une copie, sans bibliothèque, ou sans Cache Storage (phrase à la place)', () => {
  for (const model of [{ busy: true, offlineSupported: true }, { supported: false, offlineSupported: true }]) {
    assert.ok('disabled' in offlineButton(renderLibrary({ ...base, ...model }, doc)).attrs, JSON.stringify(model));
  }
  const root = renderLibrary({ ...base, offlineSupported: false }, doc);
  assert.equal(offlineButton(root), undefined);
  assert.ok(find(root, (n) => /ne peut pas garder le moteur/.test(n.textContent)).length === 1);
});

test('T46 critère 5 : sans réseau et moteur non préparé, le lecteur cite « Préparer le jeu hors ligne »', async () => {
  const head = { append: (s) => setTimeout(() => s.onerror?.(), 0) };
  const docP = { getElementById: () => ({}), createElement: () => ({}), head };
  const plan = buildLaunchPlan({ system: { id: 'nes', name: 'NES', emulatorjsCore: 'nes' }, game: { id: 'nes/t', title: 'T', file: 'roms/nes/t.nes' } });
  await assert.rejects(loadEmulator(plan, { win: {}, doc: docP, getBytes: async () => new Uint8Array() }), /Préparer le jeu hors ligne/);
});
