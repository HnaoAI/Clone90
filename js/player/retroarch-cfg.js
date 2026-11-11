// Fabrique le retroarch.cfg que le lanceur pose à la place de celui d'EmulatorJS (T14). Aucune dépendance. Utilisé par launcher.js seulement.
// Pourquoi : (A) avec "Direct Keyboard Input" actif (Amiga), RetroArch lit le clavier du document et ses raccourcis par défaut se
// déclenchent (F1 menu, Échap quitter, F9 muet, Espace avance rapide, P pause...) ; (B) il faut des lignes d'erreur du chargeur de contenu
// pour détecter qu'un cœur a refusé le jeu (ejs-start-watch.js).
// INVARIANT : les lignes d'origine ci-dessous sont celles de getRetroArchCfg() d'EmulatorJS 4.2.3 (GameManager.js l.139-152), SANS les
// 2 lignes de rembobinage ni les `retroarchOpts` du core.json (vides pour puae et fbneo, vérifié). À relire à chaque changement de
// EJS_CDN_VERSION (tests/retroarch-cfg.test.mjs garde une copie).
// Sources lues (RetroArch d'EmulatorJS, branche master) : clés `input_<base>` = préfixe "input" + base de la table input_config_bind_map
// (configuration.c l.298-419 ; input_config_get_prefix et config_read_keybinds_conf dans input/input_driver.c) ; valeur "nul" = RETROK_UNKNOWN
// (input/input_keymaps.c) ; `log_verbosity`, `frontend_log_level`, `libretro_log_level` (configuration.c l.2351-2352 et 3549-3562).

/** Chemin où EmulatorJS 4.2.3 écrit son retroarch.cfg (GameManager.js l.38) ; notre fichier le remplace via EJS_externalFiles. */
export const RETROARCH_CFG_PATH = '/home/web_user/.config/retroarch/retroarch.cfg';

const ORIGINAL_LINES = [
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

// Erreurs seulement (niveau 3 = ERROR) : ce qu'il faut pour voir "[ERROR] [Content]: Failed to load content" sans bruit ni coût.
const ERROR_LOG_LINES = ['log_verbosity = true', 'frontend_log_level = 3', 'libretro_log_level = 3'];

/**
 * Toutes les actions de raccourci de RetroArch ("meta binds" de input_config_bind_map), sauf enable_hotkey (lié à rien par défaut).
 * Liste complète, pas seulement celles qui ont une touche par défaut : une version un peu différente du binaire ne réveille rien.
 * Les boutons du jeu (b, a, start, up...) et les clés `input_player<N>_*` n'y sont JAMAIS : le clavier du jeu reste intact.
 */
export const RETROARCH_HOTKEYS = [
  'menu_toggle', 'exit_emulator', 'close_content', 'reset', 'toggle_fast_forward', 'hold_fast_forward', 'toggle_slowmotion',
  'hold_slowmotion', 'rewind', 'pause_toggle', 'frame_advance', 'audio_mute', 'volume_up', 'volume_down', 'load_state', 'save_state',
  'state_slot_increase', 'state_slot_decrease', 'play_replay', 'record_replay', 'halt_replay', 'replay_slot_increase',
  'replay_slot_decrease', 'disk_eject_toggle', 'disk_next', 'disk_prev', 'shader_toggle', 'shader_next', 'shader_prev', 'cheat_toggle',
  'cheat_index_plus', 'cheat_index_minus', 'screenshot', 'recording_toggle', 'streaming_toggle', 'grab_mouse_toggle',
  'game_focus_toggle', 'toggle_fullscreen', 'desktop_menu_toggle', 'toggle_vrr_runloop', 'runahead_toggle', 'preempt_toggle',
  'fps_toggle', 'toggle_statistics', 'ai_service', 'netplay_ping_toggle', 'netplay_host_toggle', 'netplay_game_watch',
  'netplay_player_chat', 'netplay_fade_chat_toggle', 'overlay_next', 'osk_toggle',
];

/**
 * Texte du retroarch.cfg.
 * @param {{disableHotkeys?: boolean}} [options] disableHotkeys : met tous les raccourcis de RetroArch à "nul" (champ `disableRetroArchHotkeys` de systems.json)
 * @returns {string} lignes terminées par un retour à la ligne
 */
export function buildRetroArchCfg({ disableHotkeys = false } = {}) {
  const hotkeyLines = disableHotkeys ? RETROARCH_HOTKEYS.map((name) => `input_${name} = "nul"`) : [];
  return `${[...ORIGINAL_LINES, ...ERROR_LOG_LINES, ...hotkeyLines].join('\n')}\n`;
}
