// T51 : le téléphone cherche le Mac sur le Wi-Fi, sans que la personne saisisse d'adresse : il essaie d'abord les adresses connues
// (dernière adresse, nom .local), une par une, puis balaie le réseau local en parallèle. Chaque essai est `GET /sync/hello` (sans jeton) sur le
// port du partage, en HTTPS : seul un Mac Clone90 dont le certificat est installé sur le téléphone peut répondre.
// Dépend de sync-plan.js (readHello, SYNC_ROUTES). `fetchFn` injectable (tests).
// INVARIANT (CLAUDE.md règle 5, exception e) : rien n'est envoyé à ces adresses (pas de cookie, pas de jeton, pas d'adresse du site) ;
//   seulement des adresses privées ou .local données par discoveryCandidates.
import { readHello, SYNC_ROUTES } from './sync-plan.js';

/** Attente d'une adresse pendant le balayage (une adresse vide du Wi-Fi ne répond jamais). */
export const PROBE_TIMEOUT_MS = 2500;
/**
 * Attente du tout premier essai : Chrome peut d'abord demander « Autoriser l'accès aux appareils de votre réseau local ? »
 * (Local Network Access) ; l'essai attend la réponse de la personne au lieu d'échouer au bout de 2,5 s.
 */
export const FIRST_PROBE_TIMEOUT_MS = 60000;
/** Essais en même temps pendant le balayage. */
export const SCAN_CONCURRENCY = 32;

/**
 * Essaie une adresse. @returns {Promise<{url: string, name: string|null}|null>} ne lève jamais
 * @param {string} url origine `https://<adresse>:<port>` @param {{fetchFn: typeof fetch, timeoutMs: number}} options
 */
export async function probeMac(url, { fetchFn = globalThis.fetch, timeoutMs = PROBE_TIMEOUT_MS } = {}) {
  const controller = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = setTimeout(() => controller?.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${url}${SYNC_ROUTES.hello}`, { credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store', signal: controller?.signal });
    const hello = res.ok ? readHello(await res.json().catch(() => null)) : null;
    return hello ? { url, name: hello.name } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Cherche le Mac : adresses prioritaires une par une, puis balayage en parallèle ; s'arrête au premier Mac Clone90 trouvé.
 * @param {{priority: string[], scan?: string[], fetchFn?: typeof fetch, timeoutMs?: number, firstTimeoutMs?: number, concurrency?: number,
 *   onProgress?: (p: {done: number, total: number}) => void}} input
 * @returns {Promise<{url: string, name: string|null}|null>} null si aucun Mac n'a répondu ; ne lève jamais
 */
export async function findMac({ priority, scan = [], fetchFn = globalThis.fetch, timeoutMs = PROBE_TIMEOUT_MS, firstTimeoutMs = FIRST_PROBE_TIMEOUT_MS,
  concurrency = SCAN_CONCURRENCY, onProgress = () => {} }) {
  const all = [...priority, ...scan];
  let done = 0;
  const step = () => { done += 1; onProgress({ done, total: all.length }); };
  for (const url of priority) {
    const found = await probeMac(url, { fetchFn, timeoutMs: done === 0 ? firstTimeoutMs : timeoutMs });
    step();
    if (found) return found;
  }
  if (!scan.length) return null;
  if (!priority.length) {
    // Premier essai seul : laisse à la personne le temps de répondre à la demande d'accès au réseau local de Chrome.
    const found = await probeMac(scan[0], { fetchFn, timeoutMs: firstTimeoutMs });
    step();
    if (found) return found;
  }
  const queue = priority.length ? [...scan] : scan.slice(1);
  let result = null;
  const worker = async () => {
    while (!result && queue.length) {
      const found = await probeMac(queue.shift(), { fetchFn, timeoutMs });
      step();
      if (found && !result) result = found;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, queue.length)) }, worker));
  return result;
}
