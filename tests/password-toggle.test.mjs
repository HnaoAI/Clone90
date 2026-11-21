// Tests T52 : bouton « Afficher le mot de passe » (œil), masqué par défaut, sur le téléphone (association au Mac) et sur le Mac
// (« Partager avec le téléphone »). Demandé par Hicham le 2026-11-21 (« oui je le veux »).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPasswordToggle, PASSWORD_TOGGLE_LABELS } from '../js/ui/password-toggle.js';
import { renderSyncSection, SYNC_NAV } from '../js/ui/sync-section.js';
import { createSyncPanel, SYNC_PASSWORD_ID } from '../js/ui/sync-panel.js';

class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; this.classList = { add() {}, remove() {}, toggle() {} }; this.style = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return this.attrs[k] ?? null; }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...items) { for (const i of items) this.children.push(i); }
  replaceChildren(...items) { this.children = [...items]; }
  addEventListener(t, f) { this.listeners[t] = f; }
  removeEventListener(t) { delete this.listeners[t]; }
  querySelector() { return null; }
  querySelectorAll() { return []; }
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
const all = (nodes) => [nodes].flat().flatMap((n) => walk(n));

test('T52 œil : masqué par défaut ; un appui affiche le mot de passe, un second le masque ; état dit aux lecteurs d\'écran', () => {
  const doc = fakeDoc();
  const input = doc.createElement('input');
  input.setAttribute('type', 'password');
  const eye = createPasswordToggle(input, { navId: 'x', controls: 'champ' }, doc);
  assert.equal(eye.attrs.type, 'button', 'ne valide pas le formulaire');
  assert.equal(eye.attrs['aria-pressed'], 'false');
  assert.equal(eye.attrs['aria-label'], PASSWORD_TOGGLE_LABELS.show);
  assert.equal(eye.attrs['aria-controls'], 'champ');
  assert.equal(eye.dataset.navId, 'x');
  eye.listeners.click();
  assert.equal(input.attrs.type, 'text');
  assert.equal(eye.attrs['aria-pressed'], 'true');
  assert.equal(eye.attrs['aria-label'], 'Masquer le mot de passe');
  eye.listeners.click();
  assert.equal(input.attrs.type, 'password');
  assert.equal(eye.attrs['aria-label'], 'Afficher le mot de passe');
});

test('T52 téléphone : « Associer » a l\'œil à côté du mot de passe (clavier et manette), désactivé avec le reste', () => {
  const nodes = renderSyncSection({ pairing: null, onPair() {}, onSyncNow() {}, onForget() {} }, fakeDoc());
  const password = all(nodes).find((n) => n.attrs?.id === 'sync-password');
  const eye = all(nodes).find((n) => n.dataset?.navId === SYNC_NAV.showPassword);
  assert.equal(password.attrs.type, 'password', 'masqué par défaut');
  assert.equal(eye.dataset.nav, '');
  eye.listeners.click();
  assert.equal(password.attrs.type, 'text');
  const busy = renderSyncSection({ pairing: null, disabled: true, onPair() {}, onSyncNow() {}, onForget() {} }, fakeDoc());
  assert.equal(all(busy).find((n) => n.dataset?.navId === SYNC_NAV.showPassword).attrs.disabled, '');
});

test('T52 Mac : « Partager avec le téléphone » a l\'œil à côté du mot de passe des téléphones', () => {
  const doc = fakeDoc();
  const panel = createSyncPanel({ fetchFn: async () => ({ ok: true, status: 200, json: async () => ({}) }), initial: { enabled: false, running: false, addresses: [], devices: 0, hasPassword: false } }, doc);
  assert.equal(panel.passwordInput.attrs.type, 'password');
  panel.open(doc.body);
  const eye = all(doc.body).find((n) => n.attrs?.['aria-controls'] === SYNC_PASSWORD_ID);
  assert.ok(eye, 'bouton œil présent');
  eye.listeners.click();
  assert.equal(panel.passwordInput.attrs.type, 'text');
});
