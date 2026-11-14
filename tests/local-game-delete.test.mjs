// Tests de js/local-game-delete.js (T39) : fichiers d'un jeu importé, textes de la confirmation, suppression confirmée ou refusée.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canDeleteGame, localGameFiles, deleteGameDialogOptions, deleteLocalGame, confirmAndDeleteGame, DELETE_LABEL,
} from '../js/local-game-delete.js';

/** Fausse bibliothèque locale (mêmes méthodes que openLocalLibrary). */
const fakeLibrary = (files, { failOn = [] } = {}) => {
  const store = new Map(Object.entries(files));
  return {
    store,
    readText: async (p) => store.get(p) ?? '',
    remove: async (p) => { if (failOn.includes(p)) throw new Error('refus'); store.delete(p); },
  };
};
/** Fausse boîte de confirmation : répond `answer` et garde les options reçues. */
const fakeConfirm = (answer) => {
  const calls = [];
  return { calls, confirm: async (options) => { calls.push(options); return answer; } };
};

test('canDeleteGame : seulement un jeu importé dans « Mes fichiers » (local), jamais un jeu du disque du Mac', () => {
  assert.equal(canDeleteGame({ local: true, file: 'roms/nes/a.nes' }), true);
  assert.equal(canDeleteGame({ file: 'roms/nes/a.nes' }), false);
  assert.equal(canDeleteGame({ local: 'true', file: 'roms/nes/a.nes' }), false);
  assert.equal(canDeleteGame(null), false);
});

test('localGameFiles : le fichier du jeu et sa jaquette', () => {
  assert.deepEqual(localGameFiles({ local: true, file: 'roms/nes/Zelda.nes', cover: 'roms/nes/Zelda.png' }), ['roms/nes/Zelda.nes', 'roms/nes/Zelda.png']);
  assert.deepEqual(localGameFiles({ local: true, file: 'roms/nes/Zelda.nes', cover: null }), ['roms/nes/Zelda.nes']);
});

test('localGameFiles : toutes les disquettes, sans doublon', () => {
  const game = { local: true, file: 'roms/amiga/Leander (Disk 1 of 3).adf', disks: ['roms/amiga/Leander (Disk 1 of 3).adf', 'roms/amiga/Leander (Disk 2 of 3).adf', 'roms/amiga/Leander (Disk 3 of 3).adf'] };
  assert.deepEqual(localGameFiles(game), game.disks);
});

test('localGameFiles : pistes d\'un .cue et disques cités par un .m3u', () => {
  assert.deepEqual(localGameFiles({ local: true, file: 'roms/megacd/Sonic CD.cue', extraFiles: [{ file: 'roms/megacd/Sonic CD.bin', as: 'Sonic CD.bin' }] }),
    ['roms/megacd/Sonic CD.cue', 'roms/megacd/Sonic CD.bin']);
  assert.deepEqual(localGameFiles({ local: true, file: 'roms/amiga/Gods.m3u' }, { m3uText: '﻿# liste\nGods-1.adf\r\n\nGods-2.adf\n' }),
    ['roms/amiga/Gods.m3u', 'roms/amiga/Gods-1.adf', 'roms/amiga/Gods-2.adf']);
});

test('localGameFiles : cas limites (chemins hors de roms/<machine>/, .m3u qui remonte, jeu non local, caractères spéciaux)', () => {
  assert.deepEqual(localGameFiles({ local: true, file: 'roms/amiga/a.m3u' }, { m3uText: '../../bios/kick40068.A1200\n/etc/passwd\nsous/b.adf\nb.adf' }),
    ['roms/amiga/a.m3u', 'roms/amiga/b.adf']);
  assert.deepEqual(localGameFiles({ local: true, file: 'roms/nes/a.nes', cover: 'bios/x.png', extraFiles: [{ file: 'roms/../bios/neogeo.zip' }] }), ['roms/nes/a.nes']);
  assert.deepEqual(localGameFiles({ file: 'roms/nes/a.nes' }), []);
  assert.deepEqual(localGameFiles({ local: true, file: 'roms/nes/L\'été #1 ? (fr).nes' }), ['roms/nes/L\'été #1 ? (fr).nes']);
  assert.deepEqual(localGameFiles({ local: true }), []);
});

test('deleteGameDialogOptions : affiche le nom du jeu et dit que la suppression est définitive ; focus sur Annuler', () => {
  const o = deleteGameDialogOptions('Metal Slug', 1);
  assert.equal(o.title, 'Supprimer Metal Slug ?');
  assert.match(o.message, /définitive/);
  assert.match(o.message, /Metal Slug/);
  assert.equal(o.cancelLabel, 'Annuler');
  assert.equal(o.confirmLabel, 'Supprimer');
  assert.match(deleteGameDialogOptions('Leander', 3).message, /3 fichiers/);
  assert.equal(DELETE_LABEL, 'Supprimer le fichier');
});

test('deleteLocalGame : retire tous les fichiers du jeu de la bibliothèque, et rien d\'autre', async () => {
  const library = fakeLibrary({ 'roms/amiga/Gods.m3u': 'Gods-1.adf\nGods-2.adf', 'roms/amiga/Gods-1.adf': 'A', 'roms/amiga/Gods-2.adf': 'B', 'roms/amiga/Autre.adf': 'C', 'bios/kick40068.A1200': 'K' });
  const result = await deleteLocalGame(library, { local: true, file: 'roms/amiga/Gods.m3u' });
  assert.deepEqual(result, { removed: 3, failed: [] });
  assert.deepEqual([...library.store.keys()].sort(), ['bios/kick40068.A1200', 'roms/amiga/Autre.adf']);
});

test('deleteLocalGame : un fichier refusé est signalé, les autres sont quand même retirés', async () => {
  const library = fakeLibrary({ 'roms/nes/a.nes': 'A', 'roms/nes/a.png': 'P' }, { failOn: ['roms/nes/a.png'] });
  const result = await deleteLocalGame(library, { local: true, file: 'roms/nes/a.nes', cover: 'roms/nes/a.png' });
  assert.deepEqual(result, { removed: 1, failed: ['roms/nes/a.png'] });
  assert.equal(library.store.has('roms/nes/a.nes'), false);
});

test('suppression confirmée : la confirmation montre le nom du jeu, puis le fichier est retiré', async () => {
  const library = fakeLibrary({ 'roms/nes/Zelda.nes': 'Z', 'roms/nes/Mario.nes': 'M' });
  const dialog = fakeConfirm(true);
  const result = await confirmAndDeleteGame({ game: { local: true, title: 'Zelda', file: 'roms/nes/Zelda.nes' }, library, confirm: dialog.confirm });
  assert.equal(dialog.calls.length, 1);
  assert.equal(dialog.calls[0].title, 'Supprimer Zelda ?');
  assert.deepEqual(result, { status: 'deleted', removed: 1, failed: [] });
  assert.deepEqual([...library.store.keys()], ['roms/nes/Mario.nes']);
});

test('suppression refusée : aucun fichier n\'est supprimé', async () => {
  const library = fakeLibrary({ 'roms/nes/Zelda.nes': 'Z' });
  const dialog = fakeConfirm(false);
  const result = await confirmAndDeleteGame({ game: { local: true, title: 'Zelda', file: 'roms/nes/Zelda.nes' }, library, confirm: dialog.confirm });
  assert.deepEqual(result, { status: 'cancelled' });
  assert.deepEqual([...library.store.keys()], ['roms/nes/Zelda.nes']);
});

test('jeu du disque du Mac : ni confirmation ni suppression', async () => {
  const library = fakeLibrary({ 'roms/nes/Zelda.nes': 'Z' });
  const dialog = fakeConfirm(true);
  const result = await confirmAndDeleteGame({ game: { title: 'Zelda', file: 'roms/nes/Zelda.nes' }, library, confirm: dialog.confirm });
  assert.deepEqual(result, { status: 'unsupported' });
  assert.equal(dialog.calls.length, 0);
  assert.equal(library.store.size, 1);
});

test('erreur de la bibliothèque : statut error, sans lever', async () => {
  const library = { readText: async () => '', remove: async () => { throw new Error('IndexedDB fermé'); } };
  const result = await confirmAndDeleteGame({ game: { local: true, title: 'Zelda', file: 'roms/nes/Zelda.nes' }, library, confirm: async () => true });
  assert.equal(result.status, 'error');
});
