// Tests de js/player/retroarch-cfg.js (T14) : contenu du retroarch.cfg généré, lignes d'origine d'EmulatorJS 4.2.3 conservées.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRetroArchCfg, RETROARCH_CFG_PATH, RETROARCH_HOTKEYS } from '../js/player/retroarch-cfg.js';

// Copie de getRetroArchCfg() d'EmulatorJS 4.2.3 (GameManager.js l.139-152), SANS rembobinage. Volontairement dupliquée ici : si le code
// change, ce test échoue et force à relire la différence.
const ORIGINAL_4_2_3 = [
  'autosave_interval = 60',
  'screenshot_directory = "/"',
  'block_sram_overwrite = false',
  'video_gpu_screenshot = false',
  'audio_latency = 64',
  'video_top_portrait_viewport = true',
  'video_vsync = true',
  'video_smooth = false',
  'fastforward_ratio = 3.0',
  'slowmotion_ratio = 3.0',
  'savefile_directory = "/data/saves"',
];
const linesOf = (text) => text.split('\n').filter(Boolean);

test('retroarch.cfg : le chemin est celui où EmulatorJS 4.2.3 écrit son fichier', () => {
  assert.equal(RETROARCH_CFG_PATH, '/home/web_user/.config/retroarch/retroarch.cfg');
});

test('retroarch.cfg : les lignes d\'origine d\'EmulatorJS 4.2.3 sont conservées à l\'identique et dans l\'ordre', () => {
  for (const options of [{}, { disableHotkeys: true }]) {
    const lines = linesOf(buildRetroArchCfg(options));
    assert.deepEqual(lines.slice(0, ORIGINAL_4_2_3.length), ORIGINAL_4_2_3);
  }
});

test('retroarch.cfg : se termine par un retour à la ligne et n\'a aucune ligne vide ni doublon de clé', () => {
  const text = buildRetroArchCfg({ disableHotkeys: true });
  assert.ok(text.endsWith('\n'));
  assert.ok(!text.includes('\n\n'));
  const keys = linesOf(text).map((l) => l.split(' = ')[0]);
  assert.equal(new Set(keys).size, keys.length, 'une clé en double serait ambiguë pour RetroArch');
});

test('retroarch.cfg : sans disableHotkeys, aucun raccourci n\'est touché (Neo Geo, arcade)', () => {
  assert.ok(!buildRetroArchCfg({}).includes('input_'));
  assert.ok(!buildRetroArchCfg().includes('input_'));
});

test('retroarch.cfg : avec disableHotkeys, chaque raccourci est à "nul" et rien d\'autre ne commence par input_', () => {
  const lines = linesOf(buildRetroArchCfg({ disableHotkeys: true }));
  const inputLines = lines.filter((l) => l.startsWith('input_'));
  assert.deepEqual(inputLines, RETROARCH_HOTKEYS.map((name) => `input_${name} = "nul"`));
});

test('retroarch.cfg : les raccourcis qui gênent l\'Amiga sont tous neutralisés (menu F1, Échap, F9 muet, Espace, P, F, H...)', () => {
  const text = buildRetroArchCfg({ disableHotkeys: true });
  const mustHave = [
    'menu_toggle', 'exit_emulator', 'audio_mute', 'toggle_fast_forward', 'hold_fast_forward', 'pause_toggle', 'toggle_fullscreen',
    'reset', 'save_state', 'load_state', 'fps_toggle', 'screenshot', 'grab_mouse_toggle', 'game_focus_toggle', 'rewind', 'frame_advance',
    'hold_slowmotion', 'volume_up', 'volume_down', 'shader_next', 'cheat_toggle', 'desktop_menu_toggle',
  ];
  for (const name of mustHave) assert.ok(text.includes(`input_${name} = "nul"\n`), `input_${name} manque`);
});

test('retroarch.cfg : jamais les touches du jeu ni les boutons de la manette (b, a, start, up, left, l_x_plus...)', () => {
  const text = buildRetroArchCfg({ disableHotkeys: true });
  assert.ok(!/^input_(player\d+_|b |a |start|select|up|down|left|right|l_|r_)/m.test(text));
  assert.ok(!text.includes('input_enable_hotkey'), 'enable_hotkey n\'est lié à rien par défaut : inutile de le toucher');
});

test('retroarch.cfg : noms de raccourcis sans doublon, en minuscules et underscores', () => {
  assert.equal(new Set(RETROARCH_HOTKEYS).size, RETROARCH_HOTKEYS.length);
  for (const name of RETROARCH_HOTKEYS) assert.match(name, /^[a-z]+(_[a-z]+)*$/);
});

test('retroarch.cfg : journal limité aux erreurs (utile à la détection d\'échec, T14 partie B)', () => {
  const lines = linesOf(buildRetroArchCfg({}));
  assert.ok(lines.includes('log_verbosity = true'));
  assert.ok(lines.includes('frontend_log_level = 3'));
  assert.ok(lines.includes('libretro_log_level = 3'));
});
