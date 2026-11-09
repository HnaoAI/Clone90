// Outils communs de la recette T9 : navigateur Playwright, manette simulée, faux EmulatorJS, collecte des verdicts.
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
export const pw = require(process.env.PLAYWRIGHT_PATH ?? join(homedir(), 'node_modules', 'playwright'));
export const BASE = process.env.BASE ?? 'http://localhost:8765';

export const results = [];
/** Enregistre un verdict : 'PASSE' | 'ECHOUE' | 'NON VERIFIABLE'. */
export function verdict(id, ok, detail = '', viewport = '') {
  const v = ok === null ? 'NON VERIFIABLE' : ok ? 'PASSE' : 'ECHOUE';
  results.push({ id, viewport, verdict: v, detail });
  console.log(JSON.stringify({ id, viewport, verdict: v, detail }));
}

/** Script injecté avant la page : Gamepad API simulée pilotée par window.__pad(...). */
const GAMEPAD_INIT = () => {
  const mk = () => ({ id: 'Simulated Xbox (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
    axes: [0, 0, 0, 0], buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })) });
  let pad = null;
  navigator.getGamepads = () => [pad, null, null, null];
  window.__padConnect = () => { pad = mk(); };
  window.__padDisconnect = () => { pad = null; };
  window.__padSet = (buttons, axes) => {
    if (!pad) pad = mk();
    pad.buttons.forEach((b, i) => { b.pressed = buttons.includes(i); b.value = b.pressed ? 1 : 0; });
    pad.axes = axes ?? [0, 0, 0, 0];
  };
};

/** Faux loader.js d'EmulatorJS : expose EJS_emulator.pause/play et appelle EJS_onGameStart. Compte les pauses. */
const FAKE_LOADER = `
window.__ejs = { paused: false, pauses: 0, plays: 0, globals: {} };
for (const k of Object.keys(window)) if (k.startsWith('EJS_')) window.__ejs.globals[k] = window[k];
window.EJS_emulator = { pause() { window.__ejs.paused = true; window.__ejs.pauses++; }, play() { window.__ejs.paused = false; window.__ejs.plays++; } };
const c = document.createElement('canvas'); c.id = 'fake-canvas'; document.getElementById('game').append(c);
setTimeout(() => window.EJS_onGameStart && window.EJS_onGameStart(), 200);
`;

/** Intercepte le CDN EmulatorJS (faux loader, ou échec réseau si mode 'fail'). */
export async function mockCdn(context, mode = 'ok') {
  await context.route(/cdn\.emulatorjs\.org/, (route) => (mode === 'fail'
    ? route.abort('connectionrefused')
    : route.fulfill({ status: 200, contentType: 'text/javascript', body: FAKE_LOADER })));
}

/**
 * Ouvre un contexte navigateur.
 * @param {{browser?: string, width?: number, height?: number, touch?: boolean, reducedMotion?: boolean, cdn?: string, base?: string}} o
 */
export async function open(o = {}) {
  const type = pw[o.browser ?? 'chromium'];
  const browser = await type.launch();
  const context = await browser.newContext({
    viewport: { width: o.width ?? 1280, height: o.height ?? 720 },
    hasTouch: o.touch ?? false, isMobile: o.touch ?? false,
    reducedMotion: o.reducedMotion ? 'reduce' : 'no-preference',
    serviceWorkers: 'block', // sauf recette PWA : le SW ne doit pas fausser les autres tests
    ...(o.contextOptions ?? {}),
  });
  await context.addInitScript(GAMEPAD_INIT);
  await mockCdn(context, o.cdn ?? 'ok');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  return { browser, context, page, errors, close: () => browser.close() };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Appui manette simulé : maintient les boutons `buttons` pendant `ms`, puis relâche. */
export async function padPress(page, buttons, ms = 120, axes) {
  await page.evaluate(([b, a]) => window.__padSet(b, a), [buttons, axes]);
  await sleep(ms);
  await page.evaluate(() => window.__padSet([], [0, 0, 0, 0]));
  await sleep(80);
}
/** Réveille la manette (le 1er appui est avalé, docs/ux.md 4.2). */
export async function padWake(page) { await padPress(page, [0], 150); await sleep(150); }

export const PAD = { A: 0, B: 1, SELECT: 8, START: 9, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

/** Description de l'élément focusé : { tag, navId, text }. */
export const focused = (page) => page.evaluate(() => {
  const a = document.activeElement;
  return a && a !== document.body ? { tag: a.tagName, navId: a.dataset?.navId ?? null, text: (a.textContent ?? '').trim().slice(0, 60), cls: a.className } : null;
});
