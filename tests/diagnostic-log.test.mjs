// Tests de js/player/diagnostic-log.js (T16) : debug=1, horloge, textes des évènements de disquette, journal borné, texte à copier.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isDebugRequested, formatClock, describeDiskTrace, createDiagnosticLog, snapshotText } from '../js/player/diagnostic-log.js';

test('isDebugRequested : seulement debug=1 exactement', () => {
  assert.equal(isDebugRequested('?system=amiga&game=x&debug=1'), true);
  assert.equal(isDebugRequested('?debug=1'), true);
  for (const search of ['', '?system=amiga', '?debug=0', '?debug=true', '?debug=', '?debug=11', '?xdebug=1']) assert.equal(isDebugRequested(search), false, search);
  assert.equal(isDebugRequested(), false);
});

test('formatClock : HH:MM:SS.mmm en heure locale', () => {
  assert.equal(formatClock(new Date(2026, 10, 11, 9, 5, 3, 7).getTime()), '09:05:03.007');
});

test('describeDiskTrace : une phrase par évènement, disquettes numérotées à partir de 1', () => {
  assert.equal(describeDiskTrace({ type: 'request', source: 'F9', value: '1', current: 0 }), 'Changement demandé [F9] : index 1 (disquette 2), disque courant : 0');
  assert.equal(describeDiskTrace({ type: 'ignored', value: '0' }), 'Ignoré (démarrage, disque déjà en place) : index 0 (disquette 1)');
  assert.equal(describeDiskTrace({ type: 'first-call', ok: true }), '1er appel : ok');
  assert.equal(describeDiskTrace({ type: 'first-call', ok: false, error: new Error('unreachable') }), '1er appel : unreachable');
  assert.equal(describeDiskTrace({ type: 'second-call', ok: true }), '2e appel : ok');
  assert.equal(describeDiskTrace({ type: 'second-call', ok: false, error: new Error('unreachable') }), '2e appel : échec (unreachable)');
  assert.equal(describeDiskTrace({ type: 'restore', value: '0', ok: false }), 'Rétablissement du disque index 0 (disquette 1) : échec');
  assert.equal(describeDiskTrace({ type: 'state', delayMs: 500, state: { index: 1, count: 3 } }), 'État du cœur à +0.5 s : disque 2 / 3 (index 1)');
  assert.equal(describeDiskTrace({ type: 'state', delayMs: 2000, state: null }), 'État du cœur à +2 s : indisponible');
  assert.match(describeDiskTrace({ type: 'zzz' }), /inconnu/);
});

test('journal : évènements horodatés, lignes du cœur, lignes vides et non textuelles ignorées', () => {
  let t = 1000;
  const log = createDiagnosticLog({ now: () => t });
  log.addEvent('a'); t = 2000; log.addEvent('b\n  sur  deux lignes');
  log.addCoreLine('[INFO] Disk (2) inserted in drive DF0'); log.addCoreLine('   '); log.addCoreLine(42); log.addCoreLine(undefined);
  assert.deepEqual(log.events(), [{ time: 1000, text: 'a' }, { time: 2000, text: 'b sur deux lignes' }]);
  assert.deepEqual(log.coreLines(), ['[INFO] Disk (2) inserted in drive DF0']);
});

test('journal : borné (les plus anciens sont jetés) et lignes très longues coupées', () => {
  const log = createDiagnosticLog({ maxEvents: 3, maxCoreLines: 2 });
  for (let i = 0; i < 10; i++) { log.addEvent(`e${i}`); log.addCoreLine(`c${i}`); }
  assert.deepEqual(log.events().map((e) => e.text), ['e7', 'e8', 'e9']);
  assert.deepEqual(log.coreLines(), ['c8', 'c9']);
  log.addEvent('x'.repeat(5000));
  assert.equal(log.events().at(-1).text.length, 300);
});

test('journal : events() renvoie des copies, un écouteur qui lève ne casse rien, désabonnement', () => {
  const log = createDiagnosticLog();
  let calls = 0;
  const off = log.onChange(() => { calls += 1; throw new Error('boum'); });
  log.addEvent('a'); log.addCoreLine('b');
  assert.equal(calls, 2);
  off(); log.addEvent('c');
  assert.equal(calls, 2);
  log.events()[0].text = 'modifié';
  assert.equal(log.events()[0].text, 'a');
});

test('toText : fiche, évènements horodatés et lignes du cœur, caractères spéciaux conservés', () => {
  const log = createDiagnosticLog({ now: () => new Date(2026, 10, 11, 10, 0, 0, 0).getTime() });
  log.addEvent('Changement demandé [F9]');
  log.addCoreLine("[INFO] Leander (1991)(Psygnosis) 'é' <b>");
  const text = log.toText({ version: '0.16.0', date: '2026-11-11', machine: 'Amiga', game: 'Leander', disks: { index: 1, count: 3 } });
  assert.match(text, /^Clone90 - journal de diagnostic\nVersion : 0\.16\.0 \(2026-11-11\)\nMachine : Amiga\nJeu : Leander\nDisquettes : 3, courante 2 \(index 1\)\n/);
  assert.match(text, /10:00:00\.000 Changement demandé \[F9\]/);
  assert.match(text, /\[INFO\] Leander \(1991\)\(Psygnosis\) 'é' <b>/);
  assert.ok(!text.includes('\u2014'));
});

test('toText et snapshotText : valeurs absentes = inconnue / indisponible / (aucun)', () => {
  assert.equal(snapshotText({ version: '0.16.0' }), 'Version : 0.16.0\nMachine : inconnue\nJeu : inconnu\nDisquettes : indisponible');
  const text = createDiagnosticLog().toText({ version: '1' });
  assert.match(text, /\(aucun\)/);
  assert.match(text, /\(aucune\)/);
});
