// Tests de js/update-schedule.js (T47) : revérifier les mises à jour au retour sur l'onglet si la dernière vérification a plus de 5 h.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { UPDATE_RECHECK_MS, UPDATE_CHECKED_KEY, readLastCheck, markChecked, isCheckDue, canCheckNow } from '../js/update-schedule.js';

const HOUR = 60 * 60 * 1000;
const memory = (init = {}) => { const m = new Map(Object.entries(init)); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };

test('le délai entre deux vérifications est de 5 heures (choix de Hicham)', () => {
  assert.equal(UPDATE_RECHECK_MS, 5 * HOUR);
});

test('jamais vérifié dans cet onglet : vérification due', () => {
  assert.equal(isCheckDue({ lastCheckedAt: null, now: 1_000 }), true);
});

test('moins de 5 h après la dernière vérification : pas de nouvelle vérification', () => {
  const t = Date.UTC(2026, 10, 21, 8);
  assert.equal(isCheckDue({ lastCheckedAt: t, now: t }), false);
  assert.equal(isCheckDue({ lastCheckedAt: t, now: t + 5 * HOUR - 1 }), false);
});

test('5 h ou plus après la dernière vérification : nouvelle vérification due', () => {
  const t = Date.UTC(2026, 10, 21, 8);
  assert.equal(isCheckDue({ lastCheckedAt: t, now: t + 5 * HOUR }), true);
  assert.equal(isCheckDue({ lastCheckedAt: t, now: t + 8 * 24 * HOUR }), true, 'onglet ouvert 8 jours');
});

test('horloge reculée (heure changée) : vérification due, on ne bloque pas', () => {
  assert.equal(isCheckDue({ lastCheckedAt: 10 * HOUR, now: 2 * HOUR }), true);
});

test('délai personnalisable et valeur illisible', () => {
  assert.equal(isCheckDue({ lastCheckedAt: 0, now: 10, recheckMs: 10 }), true);
  assert.equal(isCheckDue({ lastCheckedAt: Number.NaN, now: 10 }), true);
});

test('markChecked puis readLastCheck : l\'heure est gardée dans le stockage de l\'onglet', () => {
  const s = memory();
  markChecked(s, 1_700_000_000_123.7);
  assert.equal(s.m.get(UPDATE_CHECKED_KEY), '1700000000123');
  assert.equal(readLastCheck(s), 1_700_000_000_123);
});

test('readLastCheck : vide, texte ou nombre abîmé = jamais vérifié ; ancienne marque T35 « 1 » = très ancienne', () => {
  assert.equal(readLastCheck(memory()), null);
  assert.equal(readLastCheck(memory({ [UPDATE_CHECKED_KEY]: '' })), null);
  assert.equal(readLastCheck(memory({ [UPDATE_CHECKED_KEY]: 'oui' })), null);
  assert.equal(readLastCheck(memory({ [UPDATE_CHECKED_KEY]: '-5' })), null);
  assert.equal(readLastCheck(memory({ [UPDATE_CHECKED_KEY]: '12.5' })), null);
  const old = readLastCheck(memory({ [UPDATE_CHECKED_KEY]: '1' }));
  assert.equal(old, 1);
  assert.equal(isCheckDue({ lastCheckedAt: old, now: Date.now() }), true);
});

test('stockage refusé ou absent : ni readLastCheck ni markChecked ne lèvent', () => {
  const broken = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceeded'); } };
  assert.equal(readLastCheck(broken), null);
  assert.doesNotThrow(() => markChecked(broken, 1));
  assert.equal(readLastCheck(undefined), null);
  assert.doesNotThrow(() => markChecked(null, 1));
});

test('page cachée : on attend le retour sur l\'onglet', () => {
  assert.equal(canCheckNow({ hidden: true, dialogOpen: false, panelOpen: false, pending: false }), false);
});

test('fenêtre de mise à jour ou panneau ouvert, ou vérification déjà prévue : pas de deuxième vérification', () => {
  assert.equal(canCheckNow({ hidden: false, dialogOpen: true, panelOpen: false, pending: false }), false);
  assert.equal(canCheckNow({ hidden: false, dialogOpen: false, panelOpen: true, pending: false }), false);
  assert.equal(canCheckNow({ hidden: false, dialogOpen: false, panelOpen: false, pending: true }), false);
  assert.equal(canCheckNow({ hidden: false, dialogOpen: false, panelOpen: false, pending: false }), true);
});
