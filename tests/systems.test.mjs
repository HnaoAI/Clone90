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

// --- T15 : les 10 machines de la vague 2, vérifiées contre EmulatorJS 4.2.3 ---
// Copie de getCores() (https://cdn.emulatorjs.org/4.2.3/data/src/emulator.js l.2-44) pour les machines de systems.json : alias -> cœurs, le premier est le cœur par défaut.
const EJS_423_CORES = {
  arcade: ['fbneo', 'fbalpha2012_cps1', 'fbalpha2012_cps2'], segaMS: ['smsplus', 'genesis_plus_gx', 'picodrive'],
  segaMD: ['genesis_plus_gx', 'picodrive'], segaGG: ['genesis_plus_gx'], segaCD: ['genesis_plus_gx', 'picodrive'],
  sega32x: ['picodrive'], nes: ['fceumm', 'nestopia'], snes: ['snes9x'], gb: ['gambatte'], amiga: ['puae'],
};
// "extensions" du core.json de chaque cœur par défaut (cores/<cœur>-wasm.data du CDN 4.2.3, lu le 2026-11-11).
const CORE_JSON_EXTENSIONS = {
  fbneo: ['zip', '7z'],
  smsplus: ['m3u', 'mdx', 'md', 'smd', 'gen', 'bin', 'cue', 'iso', 'chd', 'bms', 'sms', 'gg', 'sg', '68k', 'sgd'],
  genesis_plus_gx: ['m3u', 'mdx', 'md', 'smd', 'gen', 'bin', 'cue', 'iso', 'chd', 'bms', 'sms', 'gg', 'sg', '68k', 'sgd'],
  picodrive: ['bin', 'gen', 'smd', 'md', '32x', 'cue', 'iso', 'sms', '68k', 'chd'],
  fceumm: ['fds', 'nes', 'unif', 'unf'], snes9x: ['smc', 'sfc', 'swc', 'fig', 'bs', 'st'], gambatte: ['gb', 'gbc', 'dmg'],
};
const WAVE_2 = ['arcade', 'mastersystem', 'megadrive', 'gamegear', 'megacd', '32x', 'nes', 'snes', 'gameboy', 'gameboycolor'];
const WAVE_2_SYSTEMS = WAVE_2.map(byId);

test('T15 chaque machine de la vague 2 a un alias de cœur connu d\'EmulatorJS 4.2.3', () => {
  for (const s of WAVE_2_SYSTEMS) assert.ok(EJS_423_CORES[s.emulatorjsCore], `${s.id} : alias ${s.emulatorjsCore} inconnu`);
});

test('T15 chaque extension de la vague 2 est acceptée par le cœur par défaut (core.json 4.2.3) ou est une archive zip', () => {
  for (const s of WAVE_2_SYSTEMS) {
    const core = EJS_423_CORES[s.emulatorjsCore][0];
    for (const ext of s.extensions) {
      assert.ok(ext === 'zip' || CORE_JSON_EXTENSIONS[core].includes(ext), `${s.id} : "${ext}" n'est pas une extension de ${core}`);
    }
  }
});

test('T15 aucune machine en double (id, nom affiché, logo)', () => {
  for (const key of ['id', 'name', 'logo', 'accent']) {
    const values = systems.map((s) => s[key]);
    assert.equal(new Set(values).size, values.length, `doublon sur ${key}`);
  }
});

test('T15 Mega-CD : cue, iso, chd et zip ; ni bin ni m3u (un bin seul ou un m3u seul ne peut pas démarrer, T15)', () => {
  assert.deepEqual(byId('megacd').extensions, ['cue', 'iso', 'chd', 'zip']);
});

test('T15 Mega-CD : les trois BIOS régionaux sont posés (preload) quand ils existent, aucun n\'est passé à EJS_biosUrl', () => {
  for (const b of byId('megacd').bios) {
    assert.equal(b.preload, true, b.file);
    assert.notEqual(b.role, 'default', `${b.file} : un BIOS preload ne passe pas par EJS_biosUrl`);
  }
});

test('T15 preload : seulement les BIOS dont le cœur se sert vraiment (Mega-CD, Game Boy, Game Boy Color, NES disksys.rom)', () => {
  const preloaded = systems.flatMap((s) => s.bios.filter((b) => b.preload).map((b) => `${s.id}/${b.file}`)).sort();
  assert.deepEqual(preloaded, [
    'gameboy/gb_bios.bin', 'gameboycolor/gbc_bios.bin', 'megacd/bios_CD_E.bin', 'megacd/bios_CD_J.bin', 'megacd/bios_CD_U.bin', 'nes/disksys.rom',
  ]);
  for (const s of systems) for (const b of s.bios) if ('preload' in b) assert.equal(typeof b.preload, 'boolean');
});

test('T15 disableRetroArchHotkeys : jamais à false dans systems.json (le défaut du lanceur protège toutes les machines)', () => {
  for (const s of systems) assert.notEqual(s.disableRetroArchHotkeys, false, s.id);
});

test('T15 Mega-CD : biosAtLeastOne (au moins un des trois BIOS est nécessaire), absent ailleurs', () => {
  assert.equal(byId('megacd').biosAtLeastOne, true);
  for (const s of systems.filter((x) => x.id !== 'megacd')) assert.equal('biosAtLeastOne' in s, false, s.id);
});

test('T15 config : MAX_VISIBLE_WAVE vaut 2 et couvre la vague la plus haute de systems.json', async () => {
  const { MAX_VISIBLE_WAVE } = await import('../js/config.js');
  assert.equal(MAX_VISIBLE_WAVE, 2);
  assert.ok(systems.every((s) => s.wave <= MAX_VISIBLE_WAVE));
});

test('T18 diskSets : true sur l\'Amiga seule (jeux à plusieurs disquettes), absent ailleurs', () => {
  assert.equal(byId('amiga').diskSets, true);
  for (const s of systems.filter((x) => x.id !== 'amiga')) assert.equal('diskSets' in s, false, s.id);
});

test('T21 ejsVersion : facultatif, format x.y.z, uniquement sur l\'Amiga (4.2.1), jamais stable ni nightly', () => {
  for (const s of systems) {
    if ('ejsVersion' in s) assert.match(s.ejsVersion, /^\d+\.\d+\.\d+$/, s.id);
  }
  assert.equal(byId('amiga').ejsVersion, '4.2.1');
  for (const s of systems.filter((x) => x.id !== 'amiga')) assert.equal('ejsVersion' in s, false, s.id);
});

test('T21 ejsVersion : l\'URL du CDN de chaque machine du vrai systems.json (Amiga 4.2.1, Neo Geo et le reste 4.2.3)', async () => {
  const { ejsDataUrl, EJS_CDN_VERSION } = await import('../js/config.js');
  assert.equal(EJS_CDN_VERSION, '4.2.3');
  assert.equal(ejsDataUrl(byId('amiga').ejsVersion), 'https://cdn.emulatorjs.org/4.2.1/data/');
  assert.equal(ejsDataUrl(byId('neogeo').ejsVersion), 'https://cdn.emulatorjs.org/4.2.3/data/');
});

test('systems.json : chaque machine a un thumbnailsRepo (dépôt libretro-thumbnails des pochettes, T28), nom sûr pour une adresse', () => {
  for (const s of systems) assert.match(s.thumbnailsRepo ?? '', /^[A-Za-z0-9._-]+$/, `${s.id} : thumbnailsRepo`);
});
