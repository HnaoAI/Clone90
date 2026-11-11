// Tests de js/player/diagnostic-panel.js (T16) : panneau absent sans debug=1, repliable, copie, pas de vol de focus, document factice.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/serve.mjs';
import { mountDiagnostic, createDiagnosticPanel, copyText } from '../js/player/diagnostic-panel.js';
import { createDiagnosticLog } from '../js/player/diagnostic-log.js';

class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.listeners = {}; this.textContent = ''; this.dataset = {}; this.removed = false; this.style = {}; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...items) { this.children.push(...items); }
  addEventListener(t, f) { this.listeners[t] = f; }
  remove() { this.removed = true; }
  walk(fn) { fn(this); this.children.forEach((c) => c.walk?.(fn)); }
}
const doc = { createElement: (t) => new FakeNode(t), createTextNode: (s) => ({ text: s }) };
const find = (root, cls) => { const out = []; root.walk((n) => (n.attrs?.class ?? '').split(' ').includes(cls) && out.push(n)); return out[0]; };
const snapshot = () => ({ version: '0.16.0', machine: 'Amiga', game: 'Leander', disks: { index: 1, count: 3 } });

function mount(extra = {}) {
  const host = new FakeNode('body');
  const timers = [];
  const result = mountDiagnostic({ search: '?system=amiga&debug=1', host, getSnapshot: snapshot, doc, ...extra });
  return { host, result, timers };
}

test('sans debug=1 : aucun panneau, aucun journal, rien ajouté à la page', () => {
  for (const search of ['', '?system=amiga&game=x', '?debug=0', '?debug=true']) {
    const host = new FakeNode('body');
    assert.equal(mountDiagnostic({ search, host, getSnapshot: snapshot, doc }), null, search);
    assert.equal(host.children.length, 0);
  }
});

test('avec debug=1 : un panneau est ajouté, replié au départ, pastille avec la version', () => {
  const { host, result } = mount();
  assert.equal(host.children.length, 1);
  const body = find(result.panel.element, 'diag-body');
  assert.equal('hidden' in body.attrs, true);
  assert.equal(result.panel.isOpen(), false);
  assert.equal(find(result.panel.element, 'diag-toggle').textContent, 'Diag v0.16.0');
});

test('panneau repliable : ouvrir affiche fiche, évènements et lignes du cœur ; replier masque', () => {
  const { result } = mount();
  result.log.addEvent('Changement demandé [F9]');
  result.log.addCoreLine('[INFO] Disk (2) inserted in drive DF0');
  result.panel.toggle();
  const el = result.panel.element;
  assert.equal(result.panel.isOpen(), true);
  assert.equal('hidden' in find(el, 'diag-body').attrs, false);
  assert.equal(find(el, 'diag-toggle').attrs['aria-expanded'], 'true');
  assert.match(find(el, 'diag-summary').textContent, /Version : 0\.16\.0\nMachine : Amiga\nJeu : Leander\nDisquettes : 3, courante 2/);
  assert.match(find(el, 'diag-events').textContent, /\d\d:\d\d:\d\d\.\d{3} Changement demandé \[F9\]/);
  assert.equal(find(el, 'diag-core').textContent, '[INFO] Disk (2) inserted in drive DF0');
  result.panel.toggle();
  assert.equal('hidden' in find(el, 'diag-body').attrs, true);
});

test('rafraîchissement : un ajout au journal ouvert est affiché après le délai, regroupé en un seul minuteur', () => {
  const log = createDiagnosticLog();
  const timers = [];
  const panel = createDiagnosticPanel({ log, getSnapshot: snapshot, doc, setTimer: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimer: () => {} });
  panel.toggle();
  log.addEvent('un'); log.addEvent('deux'); log.addCoreLine('c');
  assert.equal(timers.length, 1);
  timers[0].fn();
  assert.match(find(panel.element, 'diag-events').textContent, /un\n.*deux/);
});

test('rafraîchissement : panneau replié = aucun minuteur', () => {
  const log = createDiagnosticLog();
  const timers = [];
  createDiagnosticPanel({ log, getSnapshot: snapshot, doc, setTimer: (fn) => timers.push(fn) });
  log.addEvent('x');
  assert.equal(timers.length, 0);
});

test('« Copier le journal » : copie le texte complet puis prévient (copié / impossible)', async () => {
  const copied = [];
  const notes = [];
  const { result } = mount({ copy: async (text) => { copied.push(text); return true; }, notify: (t) => notes.push(t) });
  result.log.addEvent('Changement demandé [Select+RB]');
  await find(result.panel.element, 'diag-button').listeners.click();
  assert.equal(copied.length, 1);
  assert.match(copied[0], /Version : 0\.16\.0/);
  assert.match(copied[0], /Changement demandé \[Select\+RB\]/);
  assert.deepEqual(notes, ['Journal copié']);
  const failing = mount({ copy: async () => false, notify: (t) => notes.push(t) });
  await find(failing.result.panel.element, 'diag-button').listeners.click();
  assert.match(notes.at(-1), /Copie impossible/);
});

test('focus du jeu : un clic sur le panneau ne prend pas le focus (mousedown annulé), boutons hors tabulation, aucun appel à focus()', () => {
  const { result } = mount();
  const el = result.panel.element;
  let prevented = 0;
  el.listeners.mousedown({ preventDefault: () => { prevented += 1; } });
  el.listeners.pointerdown({ preventDefault: () => { prevented += 1; } });
  assert.equal(prevented, 2);
  assert.equal(find(el, 'diag-toggle').attrs.tabindex, '-1');
  assert.equal(find(el, 'diag-button').attrs.tabindex, '-1');
  const source = readFileSync(join(PROJECT_ROOT, 'js/player/diagnostic-panel.js'), 'utf8');
  assert.ok(!/\.focus\(/.test(source));
});

test('mise en page : replié en haut à droite, ouvert sous le bouton Menu (haut gauche), 360 px sans débordement', () => {
  const css = readFileSync(join(PROJECT_ROOT, 'css/player.css'), 'utf8');
  const closed = /\.diag \{[^}]*\}/.exec(css)[0];
  assert.match(closed, /right: calc\(16px/);
  assert.match(closed, /max-width: calc\(100vw - 32px\)/);
  const open = /\.diag\.is-open \{[^}]*\}/.exec(css)[0];
  assert.match(open, /top: calc\(88px/); // le bouton Menu (T24) occupe 16 à 64 px en haut à gauche, anneau et cadre compris jusqu'à 80 px
  assert.match(open, /left: calc\(16px/);
  assert.match(css, /\.diag-body \{[^}]*overflow-y: auto/);
});

test('copyText : API moderne, sinon repli execCommand, sinon false', async () => {
  const written = [];
  assert.equal(await copyText('abc', { nav: { clipboard: { writeText: async (t) => { written.push(t); } } }, doc }), true);
  assert.deepEqual(written, ['abc']);
  const body = new FakeNode('body');
  const execDoc = { createElement: () => Object.assign(new FakeNode('textarea'), { select() {} }), body, execCommand: (c) => c === 'copy' };
  assert.equal(await copyText('abc', { nav: { clipboard: { writeText: async () => { throw new Error('refusé'); } } }, doc: execDoc }), true);
  assert.equal(body.children[0].removed, true);
  assert.equal(await copyText('abc', { nav: {}, doc: { ...execDoc, execCommand: () => false } }), false);
  assert.equal(await copyText('abc', { nav: {}, doc: {} }), false);
});

test('player.html et le panneau : rien d\'envoyé sur le réseau (pas de fetch, XHR, sendBeacon ni WebSocket dans les modules de diagnostic)', () => {
  for (const file of ['js/player/diagnostic-panel.js', 'js/player/diagnostic-log.js']) {
    assert.ok(!/fetch\(|XMLHttpRequest|sendBeacon|WebSocket|new Image/.test(readFileSync(join(PROJECT_ROOT, file), 'utf8')), file);
  }
});
