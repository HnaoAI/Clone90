// Tests de js/player/retroarch-cfg.js (T14) : lignes ajoutées au retroarch.cfg d'EmulatorJS 4.2.3, surcharge de getRetroArchCfg.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRetroArchCfgExtra, appendRetroArchCfg, RETROARCH_HOTKEYS } from '../js/player/retroarch-cfg.js';

const linesOf = (text) => text.split('\n').filter(Boolean);

/** Faux EJS_GameManager : le constructeur écrit le cfg comme GameManager.js l.38. */
function fakeWin(cfg = 'autosave_interval = 60\nrewind_enable = true\ncoreopt = 1\n') {
  class FakeGameManager {
    constructor() { this.written = this.getRetroArchCfg(); }
    getRetroArchCfg() { return cfg; }
  }
  return { win: { EJS_GameManager: FakeGameManager }, FakeGameManager, cfg };
}

test('retroarch.cfg ajouts : journal limité aux erreurs (utile à la détection d\'échec, T14 partie B)', () => {
  const lines = linesOf(buildRetroArchCfgExtra({}));
  assert.deepEqual(lines, ['log_verbosity = true', 'frontend_log_level = 3', 'libretro_log_level = 3']);
});

test('retroarch.cfg ajouts : sans disableHotkeys, aucun raccourci n\'est touché (Neo Geo, arcade)', () => {
  assert.ok(!buildRetroArchCfgExtra({}).includes('input_'));
  assert.ok(!buildRetroArchCfgExtra().includes('input_'));
});

test('retroarch.cfg ajouts : avec disableHotkeys, chaque raccourci est à "nul" et rien d\'autre ne commence par input_', () => {
  const inputLines = linesOf(buildRetroArchCfgExtra({ disableHotkeys: true })).filter((l) => l.startsWith('input_'));
  assert.deepEqual(inputLines, RETROARCH_HOTKEYS.map((name) => `input_${name} = "nul"`));
});

test('retroarch.cfg ajouts : les raccourcis qui gênent l\'Amiga sont tous neutralisés (menu F1, Échap, F9 muet, Espace, P, F, H...)', () => {
  const text = buildRetroArchCfgExtra({ disableHotkeys: true });
  const mustHave = [
    'menu_toggle', 'exit_emulator', 'audio_mute', 'toggle_fast_forward', 'hold_fast_forward', 'pause_toggle', 'toggle_fullscreen',
    'reset', 'save_state', 'load_state', 'fps_toggle', 'screenshot', 'grab_mouse_toggle', 'game_focus_toggle', 'rewind', 'frame_advance',
    'hold_slowmotion', 'volume_up', 'volume_down', 'shader_next', 'cheat_toggle', 'desktop_menu_toggle',
  ];
  for (const name of mustHave) assert.ok(text.includes(`input_${name} = "nul"\n`), `input_${name} manque`);
});

test('retroarch.cfg ajouts : jamais les touches du jeu ni les boutons de la manette (b, a, start, up, left, l_x_plus...)', () => {
  const text = buildRetroArchCfgExtra({ disableHotkeys: true });
  assert.ok(!/^input_(player\d+_|b |a |start|select|up|down|left|right|l_|r_)/m.test(text));
  assert.ok(!text.includes('input_enable_hotkey'), 'enable_hotkey n\'est lié à rien par défaut : inutile de le toucher');
});

test('retroarch.cfg ajouts : noms sans doublon, minuscules et underscores, retour à la ligne final, pas de ligne vide', () => {
  assert.equal(new Set(RETROARCH_HOTKEYS).size, RETROARCH_HOTKEYS.length);
  for (const name of RETROARCH_HOTKEYS) assert.match(name, /^[a-z]+(_[a-z]+)*$/);
  const text = buildRetroArchCfgExtra({ disableHotkeys: true });
  assert.ok(text.endsWith('\n'));
  assert.ok(!text.includes('\n\n'));
  const keys = linesOf(text).map((l) => l.split(' = ')[0]);
  assert.equal(new Set(keys).size, keys.length);
});

test('appendRetroArchCfg : le cfg d\'EmulatorJS est conservé à l\'identique, nos lignes sont ajoutées à la fin', () => {
  const { win, FakeGameManager, cfg } = fakeWin();
  const extra = buildRetroArchCfgExtra({ disableHotkeys: true });
  assert.equal(appendRetroArchCfg(win, extra), true);
  const written = new FakeGameManager().written;
  assert.ok(written.startsWith(cfg), 'rembobinage et options du cœur d\'EmulatorJS gardés tels quels');
  assert.equal(written, cfg + extra);
});

test('appendRetroArchCfg : appelé deux fois, l\'ajout n\'est pas doublé', () => {
  const { win, FakeGameManager, cfg } = fakeWin();
  appendRetroArchCfg(win, 'a = 1\n');
  appendRetroArchCfg(win, 'a = 1\n');
  assert.equal(new FakeGameManager().written, `${cfg}a = 1\n`);
});

test('appendRetroArchCfg : la méthode est surchargée sur le prototype (donc avant le constructeur qui écrit le cfg)', () => {
  const { win, FakeGameManager } = fakeWin();
  const before = new FakeGameManager().written;
  appendRetroArchCfg(win, 'x = 1\n');
  assert.notEqual(new FakeGameManager().written, before);
});

test('appendRetroArchCfg : classe ou méthode absente, ne lève pas et renvoie faux', () => {
  const warn = console.warn; console.warn = () => {};
  try {
    assert.equal(appendRetroArchCfg({}, 'x\n'), false);
    assert.equal(appendRetroArchCfg({ EJS_GameManager: class {} }, 'x\n'), false);
  } finally { console.warn = warn; }
});
