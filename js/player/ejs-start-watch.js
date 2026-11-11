// Détection d'un contenu refusé par le cœur (T14, partie B). Lit la sortie du cœur (print/printErr d'EmulatorJS). Aucune dépendance.
// Utilisé par launcher.js seulement (INVARIANT : seul le lanceur connaît EmulatorJS, CLAUDE.md règle 4).
// Pourquoi : EJS_onGameStart est appelé dès que callMain retourne, même si le cœur refuse le jeu (RetroArch retombe alors sur son menu natif).
// Signal retenu : la ligne "[ERROR] [Content]: ..." du chargeur de contenu de RetroArch (tasks/task_content.c, RARCH_ERR("[Content]: %s")),
// écrite seulement quand core_load_game a échoué. Preuve positive : aucun minuteur ne décide d'un échec, donc pas de faux positif sur un
// chargement lent. Elle n'apparaît que grâce à `log_verbosity = true` du retroarch.cfg (retroarch-cfg.js) ; sans elle, rien n'est détecté
// (l'état d'avant T14), jamais un faux échec. HYPOTHÈSE à vérifier par un vrai faux jeu : print/printErr reçoivent bien ces lignes.

/** Durée d'écoute après EJS_onGameStart (ms). Passé ce délai, une erreur de contenu serait sans rapport avec le démarrage. */
export const START_WATCH_MS = 15000;

const MAX_CORE_MESSAGES = 8;
const MAX_MESSAGE_LENGTH = 300;
const CONTENT_ERROR = /\[ERROR\].*\[Content\]:/;
const CORE_ERROR = /\[libretro ERROR\]\s*(.*)$/;

/** Vrai si la ligne est une erreur du chargeur de contenu de RetroArch. @param {unknown} line */
export const isContentFailureLine = (line) => typeof line === 'string' && CONTENT_ERROR.test(line);

/**
 * Surveillance de l'échec de démarrage.
 * @param {{onFailure: (info: {line: string, coreMessages: string[]}) => void, windowMs?: number, setTimer?: Function, clearTimer?: Function}} options
 *   onFailure est appelé au plus une fois ; coreMessages : dernières erreurs "[libretro ERROR]" (ex. FBNeo "ROM ... is missing")
 * @returns {{feed: (line: string) => void, started: () => void, stop: () => void}}
 *   feed : une ligne de sortie du cœur ; started : EJS_onGameStart reçu (démarre le délai d'écoute) ; stop : arrête tout
 */
export function createStartFailureWatch({ onFailure, windowMs = START_WATCH_MS, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let done = false;
  let timer = null;
  const coreMessages = [];
  const stop = () => { done = true; if (timer !== null) clearTimer(timer); timer = null; };
  return {
    feed(line) {
      if (done || typeof line !== 'string') return;
      if (isContentFailureLine(line)) {
        stop();
        try { onFailure({ line: line.trim().slice(0, MAX_MESSAGE_LENGTH), coreMessages: [...coreMessages] }); } catch { /* ne jamais interrompre la sortie du cœur */ }
        return;
      }
      const match = CORE_ERROR.exec(line);
      if (match && match[1].trim()) {
        coreMessages.push(match[1].trim().slice(0, MAX_MESSAGE_LENGTH));
        if (coreMessages.length > MAX_CORE_MESSAGES) coreMessages.shift();
      }
    },
    started() {
      if (done || timer !== null) return;
      timer = setTimer(stop, windowMs);
    },
    stop,
  };
}

/** Enveloppe EJS_Runtime : print/printErr passent par `onLine` puis par la fonction d'origine. Même objet d'options (emscripten en fait son Module). */
function wrapRuntime(factory, onLine) {
  return function wrappedRuntime(options = {}, ...rest) {
    for (const name of ['print', 'printErr']) {
      const original = options[name];
      options[name] = (message, ...args) => {
        try { onLine(message); } catch { /* ne jamais interrompre la sortie du cœur */ }
        return typeof original === 'function' ? original(message, ...args) : undefined;
      };
    }
    return factory.call(this, options, ...rest);
  };
}

/**
 * Intercepte la sortie du cœur. Le script du cœur fait `var EJS_Runtime = ...` ; EmulatorJS l'appelle ensuite avec print/printErr
 * (emulator.js initModule) et emscripten les lit au démarrage. Un accesseur sur `win.EJS_Runtime` enveloppe donc la valeur posée.
 * @param {Window} win @param {(line: string) => void} onLine
 */
export function hookCoreOutput(win, onLine) {
  let runtime = typeof win.EJS_Runtime === 'function' ? wrapRuntime(win.EJS_Runtime, onLine) : win.EJS_Runtime;
  Object.defineProperty(win, 'EJS_Runtime', {
    configurable: true,
    get: () => runtime,
    set: (value) => { runtime = typeof value === 'function' ? wrapRuntime(value, onLine) : value; },
  });
}
