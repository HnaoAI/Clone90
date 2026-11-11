// Journal du mode diagnostic (T16) : logique pure, sans DOM ni EmulatorJS. Utilisé par player-main.js et diagnostic-panel.js.
// Mode actif seulement avec `debug=1` dans l'adresse de player.html ; le journal reste en mémoire (copié à la main par la personne), rien n'est envoyé.

/** Nombre maximal de lignes gardées (les plus anciennes sont jetées). */
export const MAX_EVENTS = 200;
export const MAX_CORE_LINES = 40;
const MAX_LINE_LENGTH = 300;

/** Vrai si l'adresse demande le diagnostic (`?...&debug=1`). @param {string} [search] valeur de location.search */
export const isDebugRequested = (search = '') => new URLSearchParams(search).get('debug') === '1';

const pad = (n, size = 2) => String(n).padStart(size, '0');

/** Heure locale HH:MM:SS.mmm. @param {number} ms horodatage (Date.now) */
export function formatClock(ms) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

const shorten = (text) => String(text).replace(/\s+/g, ' ').trim().slice(0, MAX_LINE_LENGTH);
const errorText = (error) => shorten(error?.message ?? error ?? 'erreur inconnue');
const diskName = (index) => `index ${index} (disquette ${Number(index) + 1})`;
const stateText = (state) => (state ? `disque ${state.index + 1} / ${state.count} (index ${state.index})` : 'indisponible');

/**
 * Texte d'un évènement de changement de disquette émis par launcher.js (createDiskMenuGuard).
 * @param {{type: string, source?: string, value?: string, current?: number, ok?: boolean, error?: unknown, delayMs?: number, state?: {index: number, count: number}|null}} event
 * @returns {string}
 */
export function describeDiskTrace(event) {
  switch (event.type) {
    case 'request': return `Changement demandé [${event.source}] : ${diskName(event.value)}, disque courant : ${event.current ?? 'inconnu'}`;
    case 'ignored': return `Ignoré (démarrage, disque déjà en place) : ${diskName(event.value)}`;
    case 'first-call': return `1er appel : ${event.ok ? 'ok' : errorText(event.error)}`;
    case 'second-call': return `2e appel : ${event.ok ? 'ok' : `échec (${errorText(event.error)})`}`;
    case 'restore': return `Rétablissement du disque ${diskName(event.value)} : ${event.ok ? 'ok' : 'échec'}`;
    case 'state': return `État du cœur à +${event.delayMs / 1000} s : ${stateText(event.state)}`;
    default: return `Évènement inconnu : ${event.type}`;
  }
}

/**
 * Fiche d'identité du diagnostic (version, machine, jeu, disquettes), sans saut de ligne final.
 * @param {{version: string, date?: string, machine?: string, game?: string, disks?: {index: number, count: number}|null}} snapshot
 */
export function snapshotText(snapshot) {
  return [
    `Version : ${snapshot.version}${snapshot.date ? ` (${snapshot.date})` : ''}`,
    `Machine : ${snapshot.machine ?? 'inconnue'}`,
    `Jeu : ${snapshot.game ?? 'inconnu'}`,
    `Disquettes : ${snapshot.disks ? `${snapshot.disks.count}, courante ${snapshot.disks.index + 1} (index ${snapshot.disks.index})` : 'indisponible'}`,
  ].join('\n');
}

/**
 * Journal en mémoire : évènements horodatés et dernières lignes du cœur.
 * @param {{now?: () => number, maxEvents?: number, maxCoreLines?: number}} [options]
 */
export function createDiagnosticLog({ now = Date.now, maxEvents = MAX_EVENTS, maxCoreLines = MAX_CORE_LINES } = {}) {
  const events = [];
  const core = [];
  const listeners = new Set();
  const push = (list, item, max) => { list.push(item); if (list.length > max) list.shift(); listeners.forEach((fn) => { try { fn(); } catch { /* un écouteur ne casse pas le journal */ } }); };
  return {
    /** Ajoute une ligne horodatée. */
    addEvent: (text) => push(events, { time: now(), text: shorten(text) }, maxEvents),
    /** Ajoute une ligne de sortie du cœur (print/printErr). Les lignes vides sont ignorées. */
    addCoreLine(line) { if (typeof line === 'string' && line.trim()) push(core, shorten(line), maxCoreLines); },
    events: () => events.map((e) => ({ ...e })),
    coreLines: () => [...core],
    /** @param {() => void} fn appelé à chaque ajout ; @returns {() => void} désabonnement */
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    /**
     * Texte complet à copier : fiche (snapshotText), évènements, lignes du cœur. @param {Parameters<typeof snapshotText>[0]} snapshot
     */
    toText(snapshot) {
      return [
        'Clone90 - journal de diagnostic',
        snapshotText(snapshot),
        '',
        '== Évènements ==',
        ...(events.length ? events.map((e) => `${formatClock(e.time)} ${e.text}`) : ['(aucun)']),
        '',
        '== Dernières lignes du cœur ==',
        ...(core.length ? core : ['(aucune)']),
        '',
      ].join('\n');
    },
  };
}
