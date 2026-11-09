// Tests de js/ui/dom.js (T3) : helpers de création d'éléments, avec un document factice (pas de DOM réel).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { el, clear } from '../js/ui/dom.js';

class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  append(...items) { for (const i of items) this.children.push(i); }
  replaceChildren(...items) { this.children = [...items]; }
  addEventListener(t, f) { this.listeners[t] = f; }
}
const doc = { createElement: (t) => new FakeNode(t), createTextNode: (s) => ({ text: s }) };

test('el : crée l\'élément avec classe, attributs, dataset et texte', () => {
  const n = el('button', { class: 'tile', text: 'Jouer', attrs: { type: 'button', 'aria-label': 'x' }, dataset: { nav: '' } }, [], doc);
  assert.equal(n.tag, 'button');
  assert.equal(n.attrs.class, 'tile');
  assert.equal(n.textContent, 'Jouer');
  assert.equal(n.attrs.type, 'button');
  assert.equal(n.attrs['aria-label'], 'x');
  assert.equal(n.dataset.nav, '');
});

test('el : le texte n\'est jamais interprété comme du HTML (textContent, pas innerHTML)', () => {
  const n = el('p', { text: '<img src=x onerror=alert(1)>' }, [], doc);
  assert.equal(n.textContent, '<img src=x onerror=alert(1)>');
  assert.equal(n.innerHTML, undefined);
});

test('el : enfants éléments ou chaînes, null et false ignorés', () => {
  const child = el('span', {}, [], doc);
  const n = el('div', {}, [child, 'texte', null, false, undefined], doc);
  assert.equal(n.children.length, 2);
  assert.equal(n.children[0], child);
  assert.deepEqual(n.children[1], { text: 'texte' });
});

test('el : on:{evt: fn} branche les écouteurs', () => {
  const fn = () => {};
  const n = el('a', { on: { click: fn } }, [], doc);
  assert.equal(n.listeners.click, fn);
});

test('el : sans props ni enfants', () => {
  const n = el('div', undefined, undefined, doc);
  assert.equal(n.tag, 'div');
  assert.equal(n.children.length, 0);
});

test('clear : vide un conteneur', () => {
  const n = el('div', {}, ['a', 'b'], doc);
  clear(n);
  assert.equal(n.children.length, 0);
});
