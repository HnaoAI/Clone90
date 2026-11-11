// Tests de systems.json (T1) : source de vérité des machines, schéma de docs/architecture.md section 6.1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const raw = readFileSync(new URL('../systems.json', import.meta.url), 'utf8');
const config = JSON.parse(raw);
const systems = config.systems;
const byId = (id) => systems.find((s) => s.id === id);

const EXPECTED_IDS = [
  'amiga', 'neogeo', 'arcade', 'mastersystem', 'megadrive', 'gamegear', 'megacd',
  '32x', 'nes', 'snes', 'gameboy', 'gameboycolor',
];

test('systems.json : version 1 et liste de machines non vide', () => {
  assert.equal(config.version, 1);
  assert.ok(Array.isArray(systems) && systems.length > 0);
});

test('systems.json : contient les 12 machines du tableau de la section 2', () => {
  // NB : l'architecture parle de 13 machines mais son tableau en liste 12 (voir rapport T1).
  assert.deepEqual([...systems.map((s) => s.id)].sort(), [...EXPECTED_IDS].sort());
});

test('systems.json : les ids sont uniques et utilisables comme nom de dossier', () => {
  const ids = systems.map((s) => s.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^[a-z0-9]+$/);
});

test('systems.json : les valeurs de order sont des entiers uniques', () => {
  const orders = systems.map((s) => s.order);
  assert.ok(orders.every(Number.isInteger));
  assert.equal(new Set(orders).size, orders.length);
});

test('systems.json : chaque machine a nom affiché, core, extensions et bios', () => {
  for (const s of systems) {
    assert.equal(typeof s.name, 'string', `${s.id} : name`);
    assert.ok(s.name.trim().length > 0, `${s.id} : name vide`);
    assert.equal(typeof s.emulatorjsCore, 'string', `${s.id} : emulatorjsCore`);
    assert.ok(s.emulatorjsCore.length > 0, `${s.id} : emulatorjsCore vide`);
    assert.ok(Array.isArray(s.extensions) && s.extensions.length > 0, `${s.id} : extensions`);
    assert.ok(Array.isArray(s.bios), `${s.id} : bios doit être une liste (éventuellement vide)`);
  }
});

test('systems.json : extensions en minuscules, sans point, sans doublon', () => {
  for (const s of systems) {
    for (const ext of s.extensions) {
      assert.match(ext, /^[a-z0-9]+$/, `${s.id} : extension invalide "${ext}"`);
    }
    assert.equal(new Set(s.extensions).size, s.extensions.length, `${s.id} : doublon`);
  }
});

test('systems.json : chaque entrée bios a file, required, role et note valides', () => {
  for (const s of systems) {
    for (const b of s.bios) {
      assert.equal(typeof b.file, 'string');
      assert.ok(b.file.length > 0 && !b.file.startsWith('/') && !b.file.includes('..'),
        `${s.id} : chemin bios non relatif "${b.file}"`);
      assert.equal(typeof b.required, 'boolean');
      assert.ok(['default', 'optional'].includes(b.role), `${s.id} : role "${b.role}"`);
      assert.equal(typeof b.note, 'string');
    }
    const defaults = s.bios.filter((b) => b.role === 'default');
    assert.ok(defaults.length <= 1, `${s.id} : au plus un BIOS par défaut`);
  }
});

test('systems.json : wave vaut 1 ou 2, logo relatif, accent en variable CSS', () => {
  for (const s of systems) {
    assert.ok([1, 2].includes(s.wave), `${s.id} : wave`);
    assert.match(s.logo, /^assets\/logos\/[a-z0-9]+\.svg$/, `${s.id} : logo`);
    assert.match(s.accent, /^--m-[a-z0-9]+$/, `${s.id} : accent`);
  }
});

test('systems.json : amiga est complète (puae, Kickstart 3.1 imposé, wave 1)', () => {
  const amiga = byId('amiga');
  assert.ok(amiga, 'amiga absente');
  assert.equal(amiga.name, 'Amiga');
  assert.equal(amiga.emulatorjsCore, 'amiga');
  assert.equal(amiga.wave, 1);
  for (const ext of ['adf', 'adz', 'dms', 'ipf', 'hdf', 'hdz', 'lha', 'zip', 'm3u']) {
    assert.ok(amiga.extensions.includes(ext), `extension ${ext}`);
  }
  assert.deepEqual(amiga.bios.map((b) => [b.file, b.required, b.role]),
    [['kick40068.A1200', true, 'default']]);
  assert.deepEqual(amiga.coreOptions, { puae_model: 'A1200', puae_floppy_multidrive: 'disabled' }, 'puae_model : sans cela puae prend A500 (T0) ; multidrive coupé : les cracks mono-lecteur demandent le disque 2 dans DF0 (T14)');
});

test('systems.json : neogeo est complète (alias arcade, neogeo.zip, wave 1)', () => {
  const neogeo = byId('neogeo');
  assert.ok(neogeo, 'neogeo absente');
  assert.equal(neogeo.name, 'Neo Geo');
  assert.equal(neogeo.emulatorjsCore, 'arcade');
  assert.equal(neogeo.wave, 1);
  assert.deepEqual(neogeo.extensions, ['zip']);
  assert.deepEqual(neogeo.bios.map((b) => [b.file, b.required, b.role]),
    [['neogeo.zip', true, 'default']]);
  assert.equal(neogeo.bios[0].keepZipped, true, 'fbneo veut neogeo.zip entier (T0)');
});

test('systems.json : neogeo.zip est déclaré de la même façon partout (keepZipped), neogeo et arcade ne divergent pas', () => {
  const entries = systems.flatMap((s) => s.bios.filter((b) => b.file === 'neogeo.zip').map((b) => [s.id, b]));
  assert.deepEqual(entries.map(([id]) => id).sort(), ['arcade', 'neogeo']);
  for (const [id, b] of entries) assert.equal(b.role, 'default', `${id} : neogeo.zip doit être le BIOS par défaut (sinon jamais fourni au cœur)`);
  for (const [id, b] of entries) assert.equal(b.keepZipped, true, `${id} : neogeo.zip doit être keepZipped (fbneo veut le zip entier)`);
});

test('systems.json : keepZipped ne figure que sur neogeo.zip (booléen)', () => {
  const flagged = systems.flatMap((s) => s.bios.filter((b) => 'keepZipped' in b).map((b) => `${s.id}/${b.file}/${b.keepZipped}`));
  assert.deepEqual(flagged.sort(), ['arcade/neogeo.zip/true', 'neogeo/neogeo.zip/true']);
});

test('systems.json : les autres machines sont marquées wave 2', () => {
  for (const s of systems.filter((x) => !['amiga', 'neogeo'].includes(x.id))) {
    assert.equal(s.wave, 2, `${s.id} doit être wave 2`);
  }
});

test('systems.json : cores EmulatorJS conformes au tableau (alias sans neogeo ni gbc)', () => {
  const cores = Object.fromEntries(systems.map((s) => [s.id, s.emulatorjsCore]));
  assert.deepEqual(cores, {
    amiga: 'amiga', neogeo: 'arcade', arcade: 'arcade', mastersystem: 'segaMS',
    megadrive: 'segaMD', gamegear: 'segaGG', megacd: 'segaCD', '32x': 'sega32x',
    nes: 'nes', snes: 'snes', gameboy: 'gb', gameboycolor: 'gb',
  });
});

test('systems.json : BIOS Mega-CD en trois entrées optionnelles', () => {
  const files = byId('megacd').bios.map((b) => b.file).sort();
  assert.deepEqual(files, ['bios_CD_E.bin', 'bios_CD_J.bin', 'bios_CD_U.bin']);
  assert.ok(byId('megacd').bios.every((b) => !b.required && b.role === 'optional'));
});

test('systems.json : aucun BIOS requis hors amiga et neogeo', () => {
  for (const s of systems.filter((x) => !['amiga', 'neogeo'].includes(x.id))) {
    assert.ok(s.bios.every((b) => b.required === false), `${s.id}`);
  }
});
