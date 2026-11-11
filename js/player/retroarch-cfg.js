// Lignes AJOUTÉES au retroarch.cfg qu'EmulatorJS 4.2.3 fabrique (T14). Aucune dépendance. Utilisé par launcher.js seulement.
// Pourquoi : (A) avec "Direct Keyboard Input" actif (Amiga), RetroArch lit le clavier du document et ses raccourcis par défaut se
// déclenchent (F1 menu, Échap quitter, F9 muet, Espace avance rapide, P pause...) ; (B) il faut des lignes d'erreur du chargeur de contenu
// pour détecter qu'un cœur a refusé le jeu (ejs-start-watch.js).
// Méthode : on enveloppe EJS_GameManager.prototype.getRetroArchCfg (GameManager.js l.139, appelée par le constructeur l.38) et on AJOUTE nos
// lignes à son résultat. Rien d'EmulatorJS n'est recopié (rembobinage et retroarchOpts des cœurs conservés). Une clé en double est possible
// seulement si EmulatorJS écrit lui-même une de nos clés, ce qu'il ne fait pas en 4.2.3.
// Sources lues (RetroArch d'EmulatorJS, branche master) : clés `input_<base>` = préfixe "input" + base de la table input_config_bind_map
// (configuration.c l.298-419 ; input_config_get_prefix et config_read_keybinds_conf dans input/input_driver.c) ; valeur "nul" = RETROK_UNKNOWN
// (input/input_keymaps.c) ; `log_verbosity`, `frontend_log_level`, `libretro_log_level` (configuration.c l.2351-2352 et 3549-3562).

// Erreurs seulement (niveau 3 = ERROR) : ce qu'il faut pour voir "[ERROR] [Content]: Failed to load content" sans bruit ni coût.
// Mode diagnostic (T16, `debug=1`) : niveau 1 (info) pour voir les lignes du cœur du type « Disk (2) inserted in drive DF0 ».
const logLines = (level) => ['log_verbosity = true', `frontend_log_level = ${level}`, `libretro_log_level = ${level}`];
export const ERROR_LOG_LEVEL = 3;
export const DEBUG_LOG_LEVEL = 1;

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
 * Lignes à ajouter au retroarch.cfg d'EmulatorJS.
 * @param {{disableHotkeys?: boolean, debug?: boolean}} [options] disableHotkeys : met tous les raccourcis de RetroArch à "nul" (champ `disableRetroArchHotkeys` de systems.json) ;
 *   debug : journal du cœur au niveau info (mode diagnostic) au lieu de erreurs seulement
 * @returns {string} lignes terminées par un retour à la ligne
 */
export function buildRetroArchCfgExtra({ disableHotkeys = false, debug = false } = {}) {
  const hotkeyLines = disableHotkeys ? RETROARCH_HOTKEYS.map((name) => `input_${name} = "nul"`) : [];
  return `${[...logLines(debug ? DEBUG_LOG_LEVEL : ERROR_LOG_LEVEL), ...hotkeyLines].join('\n')}\n`;
}

/**
 * Fait ajouter `extra` au cfg produit par EmulatorJS. À appeler après le chargement de GameManager.js et avant la création du GameManager.
 * Idempotent (un second appel ne double pas l'ajout). Si la classe ou la méthode manque, ne fait rien et le signale (jamais d'exception).
 * @param {Window} win @param {string} extra
 * @returns {boolean} vrai si la surcharge est en place
 */
export function appendRetroArchCfg(win, extra) {
  const proto = win.EJS_GameManager?.prototype;
  const original = proto?.getRetroArchCfg;
  if (typeof original !== 'function') { console.warn('retroarch.cfg : EJS_GameManager.getRetroArchCfg introuvable, lignes T14 non ajoutées.'); return false; }
  if (original.clone90Extra !== undefined) return true;
  const patched = function getRetroArchCfgWithClone90() { return original.call(this) + extra; };
  patched.clone90Extra = extra;
  proto.getRetroArchCfg = patched;
  return true;
}
