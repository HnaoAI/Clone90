// Tests de js/posix-path.js (T27) : mêmes résultats que node:path posix sur les cas utiles au générateur de jeux.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { posix } from 'node:path';
import * as shim from '../js/posix-path.js';

const SAMPLES = ['', '.', '/', 'a', 'a/', '/a', 'a/b', 'a//b', 'a/./b', 'a/../b', '../a', 'a/../../b', '/../a', 'a/b/', 'a.adf',
  'dir/Leander (Disk 1 of 3).adf', '.hidden', 'dir/.hidden', 'a.b.c', 'a.', 'sous dossier/jeu.cue', 'x/y/../../..', './a'];

test('T27 posix-path : normalize, dirname, basename, extname, isAbsolute identiques à node:path posix', () => {
  for (const p of SAMPLES) {
    for (const fn of ['normalize', 'dirname', 'basename', 'extname', 'isAbsolute']) {
      assert.deepEqual(shim[fn](p), posix[fn](p), `${fn}(${JSON.stringify(p)})`);
    }
  }
});

test('T27 posix-path : join et basename avec extension identiques à node:path posix', () => {
  for (const a of SAMPLES) {
    for (const b of ['', 'b', '../b', 'b.bios', '/c']) assert.equal(shim.join(a, b), posix.join(a, b), `join(${JSON.stringify(a)}, ${JSON.stringify(b)})`);
    assert.equal(shim.basename(a, posix.extname(a)), posix.basename(a, posix.extname(a)), `basename(${JSON.stringify(a)}, ext)`);
  }
  assert.equal(shim.join(), posix.join());
});
