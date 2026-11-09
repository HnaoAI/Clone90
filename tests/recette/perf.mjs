// Recette T9, performance : coût d'une flèche avec N tuiles Amiga fausses (games.json simulé par interception, aucun fichier).
// Usage : node tests/recette/perf.mjs [N=3000]. Chiffres : latence keydown -> focus, coût du calcul de voisinage, rendu initial.
import { open, verdict, sleep, BASE } from './lib.mjs';

const N = Number(process.argv[2] ?? 3000);
const stats = (a) => { const s = [...a].sort((x, y) => x - y); const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))]; return { n: s.length, min: +s[0].toFixed(1), median: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +s[s.length - 1].toFixed(1) }; };

async function run(label, vp, throttle) {
  const env = await open({ browser: 'chromium', ...vp });
  const { page, context } = env;
  await page.route('**/games.json', async (route) => {
    const games = Array.from({ length: N }, (_, i) => ({ id: `amiga/jeu_${String(i).padStart(5, '0')}`, system: 'amiga', title: `Jeu numéro ${String(i).padStart(5, '0')}`, file: `roms/amiga/jeu${i}.adf`, cover: null }));
    await route.fulfill({ json: { version: 1, games } });
  });
  const cdp = await context.newCDPSession(page);
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const t0 = Date.now();
  await page.goto(`${BASE}/index.html#/amiga`);
  await page.waitForSelector('.game-tile');
  const render = await page.evaluate(() => ({ tiles: document.querySelectorAll('.game-tile').length, nav: performance.getEntriesByType('navigation')[0].domContentLoadedEventEnd }));
  const wall = Date.now() - t0;
  await sleep(500);
  // Instrumentation : latence keydown -> focusin, et tâches longues.
  await page.evaluate(() => {
    window.__lat = []; window.__long = [];
    let t = 0;
    window.addEventListener('keydown', () => { t = performance.now(); }, true);
    document.addEventListener('focusin', () => { if (t) { window.__lat.push(performance.now() - t); t = 0; } }, true);
    new PerformanceObserver((l) => l.getEntries().forEach((e) => window.__long.push(e.duration))).observe({ entryTypes: ['longtask'] });
  });
  const keys = [];
  for (let i = 0; i < 40; i++) keys.push(['ArrowDown', 'ArrowRight', 'ArrowDown', 'ArrowLeft'][i % 4]);
  for (const k of keys) { await page.keyboard.press(k); await sleep(130); }
  const m = await page.evaluate(() => ({ lat: window.__lat, long: window.__long, focus: document.activeElement.dataset.navId }));
  // Coût brut du calcul de voisinage (reproduit items() + rects de focus-nav.js, sans le focus).
  const raw = await page.evaluate(() => {
    const out = { items: [], rects: [] };
    for (let i = 0; i < 20; i++) {
      document.activeElement.blur?.();
      let a = performance.now();
      const list = [...document.querySelectorAll('[data-nav]')].filter((e) => { if (e.disabled || e.hidden) return false; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      out.items.push(performance.now() - a);
      a = performance.now();
      list.map((e) => e.getBoundingClientRect());
      out.rects.push(performance.now() - a);
    }
    return out;
  });
  // Même mesure quand le layout est invalidé juste avant (défilement + focus modifient le style : anneau, scale 1.05).
  const dirty = await page.evaluate(() => {
    const res = [];
    const list = [...document.querySelectorAll('[data-nav]')];
    for (let i = 0; i < 15; i++) {
      list[i + 1].focus({ preventScroll: true }); // style :focus-visible -> layout sale (transform scale)
      const a = performance.now();
      list.forEach((e) => e.getBoundingClientRect());
      res.push(performance.now() - a);
    }
    return res;
  });
  verdict(`PERF ${label} (N=${N})`, null, JSON.stringify({ tuilesRendues: render.tiles, chargementMs: wall, latenceKeydownFocusMs: stats(m.lat), tachesLonguesMs: m.long.map((x) => +x.toFixed(0)), itemsFilterMs: stats(raw.items), rectsMs: stats(raw.rects), rectsApresFocusMs: stats(dirty) }), vp.name ?? '');
  await env.close();
}

(async () => {
  await run('desktop 1280x720, CPU x1', { width: 1280, height: 720, name: 'desktop' }, 1);
  await run('desktop 1280x720, CPU x4 (téléphone milieu de gamme)', { width: 1280, height: 720, name: 'desktop' }, 4);
  await run('tel 360x740, CPU x4', { width: 360, height: 740, touch: true, name: 'tel' }, 4);
  await run('desktop, CPU x6 (bas de gamme / TV)', { width: 1280, height: 720, name: 'desktop' }, 6);
})();
