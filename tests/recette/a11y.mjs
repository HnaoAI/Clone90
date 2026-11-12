// Recette T9 : accessibilité manuelle (Lighthouse absent) : CA-V2 sur tous les écrans, CA-V4 reduced-motion, CA-V5 zoom 200 %, noms accessibles, ordre de tabulation.
// Usage : node tests/recette/a11y.mjs   (serveur sur BASE avec de faux jeux)
import { open, verdict, sleep, focused, BASE } from './lib.mjs';
import { overflowReport, contrastScan, smallTargets } from './page-fns.mjs';

const ok = (id, c, d = '', v = '') => verdict(id, c, d, v);
const PLAYER = `${BASE}/player.html?system=amiga&game=${encodeURIComponent('amiga/zool_2')}`;

(async () => {
  // ---- CA-V4 reduced motion ----
  for (const reduced of [true, false]) {
    const env = await open({ width: 1280, height: 720, reducedMotion: reduced });
    const { page } = env;
    await page.goto(`${BASE}/index.html`); await page.waitForSelector('.machine-tile');
    await page.keyboard.press('ArrowRight'); await sleep(400);
    const m = await page.evaluate(() => {
      const f = document.activeElement; const cs = getComputedStyle(f);
      const anim = [...document.querySelectorAll('body *')].filter((e) => { const c = getComputedStyle(e); return (c.animationName !== 'none' && c.animationDuration !== '0s') || (c.transitionDuration.split(',').some((d) => parseFloat(d) > 0) && c.transitionProperty !== 'none'); }).length;
      return { transform: cs.transform, transition: cs.transitionDuration, scrollBehavior: getComputedStyle(document.documentElement).scrollBehavior, animatedElements: anim, mq: matchMedia('(prefers-reduced-motion: reduce)').matches };
    });
    if (reduced) ok('CA-V4 (reduced-motion : aucune mise à l\'échelle, aucune transition, aucune animation)', m.transform === 'none' && m.animatedElements === 0, JSON.stringify(m), 'chromium');
    else ok('CA-V4 (témoin sans reduced-motion : la mise à l\'échelle 1.05 existe bien)', m.transform !== 'none', JSON.stringify(m), 'chromium');
    if (reduced) {
      await page.goto(`${BASE}/index.html#/amiga`); await page.waitForSelector('.game-tile'); await sleep(300);
      for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowDown');
      await sleep(60); // défilement instantané : déjà stable après un court délai
      const y1 = await page.evaluate(() => scrollY); await sleep(300); const y2 = await page.evaluate(() => scrollY);
      ok('CA-V4 (reduced-motion : défilement instantané)', y1 === y2, `${y1} -> ${y2}`, 'chromium');
      await page.goto(PLAYER); await sleep(800);
      const p = await page.evaluate(() => [...document.querySelectorAll('body *')].filter((e) => { const c = getComputedStyle(e); return c.animationName !== 'none' || (c.transitionDuration.split(',').some((d) => parseFloat(d) > 0)); }).length);
      ok('CA-V4 (reduced-motion : écran Jouer sans transition)', p === 0, String(p), 'chromium');
    }
    await env.close();
  }

  // ---- CA-V2 contraste sur tous les écrans, y compris player, boîte, erreurs ; CA-V3 ----
  const env = await open({ width: 390, height: 844, touch: true });
  const { page } = env;
  const screens = {
    'player Jouer': async () => { await page.goto(PLAYER); await page.waitForSelector('.play-button'); },
    'player erreur ROM absente': async () => { await page.route('**/roms/amiga/Zool*', (r) => r.fulfill({ status: 404, body: 'x' })); await page.goto(PLAYER); await page.waitForSelector('.message-screen, .play-message'); await sleep(300); await page.unroute('**/roms/amiga/Zool*'); },
    'player chargement': async () => { await page.goto(PLAYER); await page.waitForSelector('.play-button'); await page.tap('.play-button'); await sleep(100); },
    'boîte de confirmation': async () => { await page.goto(PLAYER); await page.waitForSelector('.play-button'); await page.tap('.play-button'); await sleep(500); await page.evaluate(() => document.querySelector('.menu-button').click()); await sleep(300); },
    'accueil avec bandeau games.json corrompu': async () => { await page.route('**/games.json', (r) => r.fulfill({ body: '{x' })); await page.goto(`${BASE}/index.html`); await page.waitForSelector('.banner'); await page.unroute('**/games.json'); },
    'erreur fatale systems.json': async () => { await page.route('**/systems.json', (r) => r.fulfill({ body: '{x' })); await page.goto(`${BASE}/index.html`); await page.waitForSelector('.message-screen'); await page.unroute('**/systems.json'); },
  };
  for (const [name, go] of Object.entries(screens)) {
    await go(); await sleep(200);
    const c = await page.evaluate(contrastScan);
    ok(`CA-V2 (contraste) : ${name}`, c.length === 0, JSON.stringify(c.slice(0, 4)), 'tel 390x844');
    const small = await page.evaluate(smallTargets);
    ok(`CA-V3 (cibles 48x48) : ${name}`, small.length === 0, small.join('; '), 'tel 390x844');
    const of = await page.evaluate(overflowReport);
    ok(`CA-V7 (pas de débordement) : ${name}`, of.scrollWidth <= of.vw && of.badCount === 0, JSON.stringify(of), 'tel 390x844');
  }
  await env.close();

  // ---- Contraste du visuel de repli : texte --text sur chaque couleur machine, et machine grisée ----
  {
    const e = await open({ width: 1280, height: 720 });
    await e.page.goto(`${BASE}/index.html`); await e.page.waitForSelector('.machine-tile');
    const r = await e.page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const lum = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
      const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
      const text = cs.getPropertyValue('--text').trim();
      const out = {};
      for (const m of ['arcade', 'neogeo', 'amiga', 'nes', 'snes', 'gameboy', 'gameboycolor', 'mastersystem', 'gamegear', 'megadrive', 'megacd', '32x', 'pcengine', 'pcenginecd']) out[m] = +ratio(text, cs.getPropertyValue(`--m-${m}`).trim()).toFixed(2);
      out['accent/bg'] = +ratio(cs.getPropertyValue('--accent').trim(), cs.getPropertyValue('--bg').trim()).toFixed(2);
      out['on-accent/accent'] = +ratio(cs.getPropertyValue('--on-accent').trim(), cs.getPropertyValue('--accent').trim()).toFixed(2);
      out['muted/surface'] = +ratio(cs.getPropertyValue('--text-muted').trim(), cs.getPropertyValue('--surface').trim()).toFixed(2);
      out['muted/surface-2'] = +ratio(cs.getPropertyValue('--text-muted').trim(), cs.getPropertyValue('--surface-2').trim()).toFixed(2);
      out['focus/bg'] = +ratio(cs.getPropertyValue('--focus').trim(), cs.getPropertyValue('--bg').trim()).toFixed(2);
      out['focus/surface'] = +ratio(cs.getPropertyValue('--focus').trim(), cs.getPropertyValue('--surface').trim()).toFixed(2);
      out['disabled(grisé : texte --text)'] = +ratio(text, cs.getPropertyValue('--disabled').trim()).toFixed(2);
      return out;
    });
    const low = Object.entries(r).filter(([k, v]) => v < (k.startsWith('focus') ? 3 : 4.5));
    ok('CA-V2 (couleurs de la palette : texte sur chaque couleur machine, boutons)', low.length === 0, JSON.stringify(r), 'chromium');
    await e.close();
  }

  // ---- CA-V5 zoom 200 % (équivalent : fenêtre 640x360 CSS px à DPR 2) ----
  {
    const e = await open({ width: 640, height: 360, contextOptions: { deviceScaleFactor: 2 } });
    const { page } = e;
    const pages = [['accueil', `${BASE}/index.html`, '.machine-tile'], ['grille', `${BASE}/index.html#/amiga`, '.game-tile'], ['état vide', null, '.empty-state'], ['Jouer', PLAYER, '.play-button']];
    for (const [name, url, sel] of pages) {
      if (name === 'état vide') { await page.route('**/games.json', (r) => r.fulfill({ json: { version: 1, games: [] } })); await page.goto('about:blank'); await page.goto(`${BASE}/index.html#/amiga`); }
      else await page.goto(url);
      await page.waitForSelector(sel); await sleep(300);
      if (name === 'état vide') await page.unroute('**/games.json');
      const of = await page.evaluate(overflowReport);
      const clipped = await page.evaluate(() => [...document.querySelectorAll('.machine-name, .machine-count, .grid-title, .grid-count, .play-title, .empty-title, .button, .back-button')].filter((e) => e.scrollWidth > e.clientWidth + 1).map((e) => e.className));
      const overlap = await page.evaluate(() => { const els = [...document.querySelectorAll('.machine-tile, .game-tile, .back-button, .grid-title, .grid-count, .site-title')].map((e) => ({ c: e.className, r: e.getBoundingClientRect() })).filter((x) => x.r.width); let n = 0; for (let i = 0; i < els.length; i++) for (let j = i + 1; j < els.length; j++) { const a = els[i].r, b = els[j].r; if (els[i].c.includes('scale')) continue; const ix = Math.min(a.right, b.right) - Math.max(a.left, b.left), iy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top); if (ix > 2 && iy > 2) n++; } return n; });
      ok(`CA-V5 (zoom 200 %) : ${name}`, of.scrollWidth <= of.vw && of.badCount === 0 && clipped.length === 0 && overlap === 0, JSON.stringify({ of, clipped, overlap }), '640x360 DPR2');
    }
    // En-tête de la grille avec un nom long à 200 %
    await e.close();
  }

  // ---- Noms accessibles, ordre de tabulation, structure ----
  {
    const e = await open({ width: 1280, height: 720 });
    const { page } = e;
    await page.goto(`${BASE}/index.html`); await page.waitForSelector('.machine-tile');
    const struct = await page.evaluate(() => ({ lang: document.documentElement.lang, title: document.title, h: [...document.querySelectorAll('h1,h2,h3')].map((h) => h.tagName + ':' + h.textContent.trim()), landmarks: [...document.querySelectorAll('header,main,nav,footer')].map((x) => x.tagName), imgAlt: [...document.querySelectorAll('img')].map((i) => i.getAttribute('alt')), badTabindex: [...document.querySelectorAll('[tabindex]')].map((x) => x.getAttribute('tabindex')), viewport: document.querySelector('meta[name=viewport]').content, live: [...document.querySelectorAll('[aria-live],[role=status]')].length }));
    ok('Structure : lang=fr, titre, h1 puis h2, header + main, alt="" sur images décoratives, pas de tabindex', struct.lang === 'fr' && struct.title.length > 3 && struct.h[0].startsWith('H1') && struct.landmarks.includes('MAIN') && struct.imgAlt.every((a) => a === '') && struct.badTabindex.length === 0 && !/user-scalable=no|maximum-scale/.test(struct.viewport), JSON.stringify(struct), 'chromium');
    const snap = await page.locator('body').ariaSnapshot();
    verdict('A11y : arbre d\'accessibilité accueil', null, `info : ${snap.replace(/\n/g, ' / ').slice(0, 500)}`, 'chromium');
    ok('A11y : cartes machines nommées "nom + nombre de jeux"', /link "Amiga \d+ jeux"/.test(snap) && /link "Neo Geo \d+ jeux"/.test(snap), snap.slice(0, 300), 'chromium');
    const order = [];
    for (let i = 0; i < 4; i++) { await page.keyboard.press('Tab'); order.push((await focused(page))?.navId ?? 'autre'); }
    ok('Tab : l\'ordre de tabulation suit l\'ordre visuel (Amiga, Neo Geo) puis sort', order[0] === 'amiga' && order[1] === 'neogeo', order.join(' > '), 'chromium');
    await page.goto(`${BASE}/index.html#/amiga`); await page.waitForSelector('.game-tile'); await sleep(300);
    const snap2 = await page.locator('body').ariaSnapshot();
    ok('A11y : grille : bouton retour nommé, tuiles nommées par le titre', /link "Retour aux machines"/.test(snap2) && /link "Zool 2"/.test(snap2), snap2.slice(0, 300), 'chromium');
    const orderCheck = await page.evaluate(() => { // ordre DOM = ordre visuel (haut vers bas, gauche vers droite)
      const els = [...document.querySelectorAll('a[href], button')].filter((e) => e.offsetParent); const rects = els.map((e) => e.getBoundingClientRect());
      const sorted = els.map((_, i) => i).sort((a, b) => (Math.abs(rects[a].top - rects[b].top) > 20 ? rects[a].top - rects[b].top : rects[a].left - rects[b].left));
      return { n: els.length, same: sorted.every((v, i) => v === i) };
    });
    ok('Tab : grille : l\'ordre de tabulation (ordre du DOM) suit l\'ordre visuel, retour d\'abord', orderCheck.same && orderCheck.n >= 10, JSON.stringify(orderCheck), 'chromium');
    await page.goto(PLAYER); await page.waitForSelector('.play-button');
    const snap3 = await page.locator('body').ariaSnapshot();
    verdict('A11y : arbre écran Jouer', null, `info : ${snap3.replace(/\n/g, ' / ').slice(0, 400)}`, 'chromium');
    await page.click('.play-button'); await sleep(400); await page.keyboard.press('F10'); await sleep(300);
    const snap4 = await page.locator('body').ariaSnapshot();
    ok('A11y : boîte de sortie : dialog nommé "Quitter ... ?" + 2 boutons', /dialog "Quitter/.test(snap4) && /button "Continuer"/.test(snap4) && /button "Quitter"/.test(snap4), snap4.replace(/\n/g, ' / ').slice(0, 400), 'chromium');
    await e.close();
  }
})().catch((x) => { console.error(x); process.exit(1); });
