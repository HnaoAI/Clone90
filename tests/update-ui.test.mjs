// Tests T35 côté page : sources de mise à jour (Mac par l'API locale, navigateur par js/version.js) et fenêtre de mise à jour
// (compte à rebours de 5 s, « Plus tard », « Mettre à jour maintenant », retour bloqué pendant la mise à jour, erreur, rechargement).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMacUpdateSource, createBrowserUpdateSource, RESTART_TIMEOUT_MS } from '../js/update-check.js';
import { openUpdateDialog, describeUpdate, countdownText, stepText, COUNTDOWN_SECONDS, NOW_LABEL, LATER_LABEL } from '../js/ui/update-dialog.js';
import { APP_VERSION } from '../js/version.js';

const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
const text = (body) => ({ ok: true, status: 200, text: async () => body });
const versionFile = (v) => `export const APP_VERSION = '${v}';`;

test('T35 source Mac : check passe par api/update/check (POST, X-Clone90) ; réponse inattendue ou serveur absent : erreur', async () => {
  const calls = [];
  const available = { status: 'available', current: '0.34.1', latest: '0.35.0', canApply: true };
  const src = createMacUpdateSource({ fetchFn: async (url, init) => { calls.push({ url, init }); return json(200, available); } });
  assert.equal(src.kind, 'mac');
  assert.deepEqual(await src.check(), available);
  assert.equal(calls[0].url, 'api/update/check');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers['X-Clone90'], '1');
  assert.equal((await createMacUpdateSource({ fetchFn: async () => json(200, ['x']) }).check()).status, 'error');
  assert.equal((await createMacUpdateSource({ fetchFn: async () => { throw new TypeError('x'); } }).check()).status, 'error');
});

/** Faux serveur pour apply : états successifs de api/update, puis versions servies après le redémarrage. */
function macServer({ start = 202, states, served }) {
  const s = { states: [...states], served: [...served] };
  return async (url) => {
    if (url === 'api/update/apply') return json(start, start === 202 ? { status: 'running' } : { message: 'Une mise à jour est en cours.' });
    if (url === 'api/update') { const st = s.states.length > 1 ? s.states.shift() : s.states[0]; if (st instanceof Error) throw st; return json(200, st); }
    if (url.startsWith('js/version.js?t=')) { const v = s.served.length > 1 ? s.served.shift() : s.served[0]; if (!v) throw new TypeError('refusé'); return text(versionFile(v)); }
    throw new Error(url);
  };
}

test('T35 source Mac : apply suit les étapes (en cours, redémarrage) et attend que la nouvelle version soit servie', async () => {
  const steps = [];
  const fetchFn = macServer({ states: [{ status: 'running' }, { status: 'done', version: '0.35.0' }], served: [null, APP_VERSION, '0.35.0'] });
  const r = await createMacUpdateSource({ fetchFn, wait: async () => {} }).apply((s) => steps.push(s));
  assert.deepEqual(r, { status: 'ready' });
  assert.deepEqual(steps, ['updating', 'restarting']);
});

test('T35 source Mac : refus au lancement, échec du pull (message du serveur), redémarrage trop long : erreur', async () => {
  const busy = await createMacUpdateSource({ fetchFn: macServer({ start: 409, states: [], served: [] }) }).apply();
  assert.deepEqual(busy, { status: 'error', message: 'Une mise à jour est en cours.' });
  const failed = await createMacUpdateSource({ fetchFn: macServer({ states: [{ status: 'error', message: 'Rien n\'a été changé.' }], served: [] }), wait: async () => {} }).apply();
  assert.deepEqual(failed, { status: 'error', message: 'Rien n\'a été changé.' });
  let t = 0;
  const slow = await createMacUpdateSource({ fetchFn: macServer({ states: [new TypeError('coupé')], served: [null] }), wait: async () => {}, now: () => { t += 10_000; return t; } }).apply();
  assert.equal(slow.status, 'error');
  assert.match(slow.message, /Relance Clone90/);
  assert.ok(RESTART_TIMEOUT_MS >= 60_000);
});

test('T35 source navigateur : version du site relue sans cache, plus récente : disponible ; égale : à jour ; illisible : erreur ; appliquer = recharger', async () => {
  const calls = [];
  const src = createBrowserUpdateSource({ current: '0.34.1', fetchFn: async (url, init) => { calls.push({ url, init }); return text(versionFile('0.35.0')); } });
  assert.deepEqual(await src.check(), { status: 'available', current: '0.34.1', latest: '0.35.0', canApply: true });
  assert.match(calls[0].url, /^js\/version\.js\?t=\d+$/);
  assert.equal(calls[0].init.cache, 'no-store');
  assert.equal((await createBrowserUpdateSource({ current: '0.35.0', fetchFn: async () => text(versionFile('0.35.0')) }).check()).status, 'uptodate');
  assert.equal((await createBrowserUpdateSource({ fetchFn: async () => text('<html>') }).check()).status, 'error');
  assert.deepEqual(await src.apply(), { status: 'ready' });
});

test('T35 textes de la fenêtre : versions, ce qui se passe, jeux non touchés ; compte à rebours au singulier et au pluriel', () => {
  const u = { current: '0.34.1', latest: '0.35.0', canApply: true };
  assert.match(describeUpdate(u, 'mac'), /v0\.35\.0.*v0\.34\.1.*redémarrer.*jeux, BIOS et réglages ne sont pas touchés/);
  assert.match(describeUpdate(u, 'browser'), /v0\.35\.0/);
  assert.match(describeUpdate({ ...u, canApply: false, message: 'Tape « git pull ».' }, 'mac'), /ne peut pas se mettre à jour tout seul\. Tape « git pull »\.$/);
  assert.equal(countdownText(5, 'mac'), 'La mise à jour commence dans 5 secondes.');
  assert.equal(countdownText(1, 'browser'), 'La page se recharge dans 1 seconde.');
  assert.match(stepText('updating'), /ne ferme pas/);
  assert.match(stepText('restarting'), /recharger/);
  assert.equal(COUNTDOWN_SECONDS, 5);
});

// --- Document factice (comme tests/folders-panel.test.mjs) ---
class FakeNode {
  constructor(tag) { this.tag = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.listeners = {}; this.textContent = ''; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  removeAttribute(k) { delete this.attrs[k]; }
  append(...items) { for (const i of items) this.children.push(i); }
  replaceChildren(...items) { this.children = [...items]; }
  addEventListener(t, f) { (this.listeners[t] ??= []).push(f); }
}
function fakeDoc() {
  const d = { activeElement: null, body: new FakeNode('body') };
  d.addEventListener = () => {};
  d.removeEventListener = () => {};
  d.createTextNode = (s) => ({ text: s });
  d.createElement = (t) => { const n = new FakeNode(t); n.focus = () => { d.activeElement = n; }; n.remove = () => { n.removed = true; }; return n; };
  return d;
}
const walk = (node, out = []) => { out.push(node); for (const c of node.children ?? []) walk(c, out); return out; };
const statusOf = (node) => walk(node).find((n) => n.attrs?.role === 'status');
const click = (node) => { for (const f of node.listeners.click ?? []) f({ target: node, stopImmediatePropagation() {} }); };
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Horloge manuelle : chaque attente d'une seconde se résout à `second()`. */
function manualClock() {
  const pending = [];
  return { wait: () => new Promise((r) => pending.push(r)), second: async () => { pending.shift()?.(); await tick(); }, get pending() { return pending.length; } };
}
const UPDATE = { current: '0.34.1', latest: '0.35.0', canApply: true };
function open({ update = UPDATE, apply = async () => ({ status: 'ready' }), kind = 'mac' } = {}) {
  const doc = fakeDoc();
  const clock = manualClock();
  const calls = { apply: 0, reload: 0 };
  const source = { kind, apply: async (onStep) => { calls.apply += 1; return apply(onStep); } };
  const r = openUpdateDialog({ update, source, parent: doc.body, wait: clock.wait, reload: () => { calls.reload += 1; } }, doc);
  return { ...r, doc, clock, calls, status: statusOf(r.dialog.element) };
}

test('T35 fenêtre : s\'ouvre AVANT la mise à jour, compte 5, 4, 3, 2, 1, puis la lance seule et recharge la page', async () => {
  const w = open();
  assert.deepEqual(w.dialog.buttons.map((b) => b.textContent), [NOW_LABEL, LATER_LABEL]);
  const seen = [];
  for (let s = 0; s < COUNTDOWN_SECONDS; s++) { seen.push(w.status.textContent); assert.equal(w.calls.apply, 0); await w.clock.second(); }
  assert.deepEqual(seen, [5, 4, 3, 2, 1].map((s) => countdownText(s, 'mac')));
  assert.equal(await w.done, 'reloaded');
  assert.equal(w.calls.apply, 1);
  assert.equal(w.calls.reload, 1);
});

test('T35 fenêtre : « Plus tard » (bouton ou retour) annule pour cette ouverture, rien n\'est lancé, même à la fin du compte', async () => {
  const w = open();
  await w.clock.second();
  click(w.dialog.buttons[1]);
  assert.equal(await w.done, 'later');
  for (let s = 0; s < 6; s++) await w.clock.second();
  assert.equal(w.calls.apply, 0);
  const b = open();
  assert.equal(b.dialog.handleAction('back'), true);
  assert.equal(await b.done, 'later');
  assert.equal(b.calls.apply, 0);
});

test('T35 fenêtre : « Mettre à jour maintenant » démarre sans attendre ; pendant la mise à jour, retour et confirmation ne ferment rien', async () => {
  let finish;
  const steps = [];
  const w = open({ apply: (onStep) => new Promise((r) => { finish = () => { onStep('restarting'); steps.push(w.status.textContent); r({ status: 'ready' }); }; }) });
  w.dialog.handleAction('confirm');
  await tick();
  assert.equal(w.calls.apply, 1);
  assert.equal(w.status.textContent, stepText('updating'));
  assert.ok(w.dialog.buttons.every((btn) => 'hidden' in btn.attrs), 'boutons cachés');
  assert.equal(w.dialog.handleAction('back'), true);
  assert.equal(w.dialog.handleAction('confirm'), true);
  click(w.dialog.buttons[1]);
  assert.equal(w.dialog.element.removed, undefined, 'toujours ouverte');
  finish();
  assert.equal(await w.done, 'reloaded');
  assert.deepEqual(steps, [stepText('restarting')]);
  assert.equal(w.calls.apply, 1, 'une seule mise à jour même si le compte à rebours finit');
});

test('T35 fenêtre : échec : message d\'erreur en français, bouton « Fermer » visible et focalisé, pas de rechargement', async () => {
  const w = open({ apply: async () => ({ status: 'error', message: 'Pas de connexion à Internet. Rien n\'a été changé.' }) });
  w.dialog.handleAction('confirm');
  await tick(); await tick();
  assert.equal(w.status.textContent, 'Pas de connexion à Internet. Rien n\'a été changé.');
  assert.match(w.status.attrs.class, /is-error/);
  const last = w.dialog.buttons.at(-1);
  assert.equal(last.textContent, 'Fermer');
  assert.equal('hidden' in last.attrs, false);
  assert.equal(w.doc.activeElement, last);
  w.dialog.handleAction('confirm');
  assert.equal(await w.done, 'error');
  assert.equal(w.calls.reload, 0);
});

test('T35 fenêtre : mise à jour impossible toute seule (dossier modifié...) : raison affichée, seulement « Fermer », aucun compte à rebours', async () => {
  const w = open({ update: { ...UPDATE, canApply: false, message: 'Tape « git pull ».' } });
  assert.deepEqual(w.dialog.buttons.map((b) => b.textContent), ['Fermer']);
  assert.equal(w.clock.pending, 0);
  assert.equal(w.status.textContent, '');
  w.dialog.handleAction('confirm');
  assert.equal(await w.done, 'closed');
  assert.equal(w.calls.apply, 0);
});
