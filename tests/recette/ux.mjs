// Recette T9, critères CA-* de docs/ux.md. Usage : node tests/recette/ux.mjs [chromium|firefox|webkit] [desktop]  (desktop = sans les viewports téléphone)
// Prérequis : serveur sur BASE (défaut http://localhost:8765) avec de faux fichiers dans roms/ et games.json généré.
import { open, verdict, sleep, padPress, padWake, PAD, focused, BASE } from './lib.mjs';

const browserName = process.argv[2] ?? 'chromium';
const VIEWPORTS = [
  { name: 'desktop 1280x720', width: 1280, height: 720, touch: false },
  { name: 'tel 360x740', width: 360, height: 740, touch: true },
  { name: 'tel 390x844', width: 390, height: 844, touch: true },
];

import { overflowReport, contrastScan, smallTargets } from './page-fns.mjs';

async function waitScroll(page) { // le défilement est animé (smooth) hors reduced-motion
  let last = -1;
  for (let i = 0; i < 20; i++) { const y = await page.evaluate(() => scrollY); if (y === last) return; last = y; await sleep(60); }
}
const inViewport = (page, sel) => page.evaluate((s) => {
  const e = document.activeElement; if (!e) return false;
  const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
}, sel);

/** Navigation franche : évite qu'un changement de hash seul réutilise les données déjà chargées. */
async function fresh(page, url) { await page.goto('about:blank'); await page.goto(url); }
async function goHome(page, query = '') {
  await page.goto(`${BASE}/index.html${query}`);
  await page.waitForSelector('.machine-tile, .message-screen');
}
async function dialogOpen(page) { return page.locator('[role=dialog]').count().then((n) => n > 0); }

// ---------- parcours de jeu ----------
async function openFirstGameOfSystem(page, input, systemIndexKeys) { /* réservé */ }

async function runViewport(vp) {
  const V = vp.name;
  const env = await open({ browser: browserName, ...vp });
  const { page } = env;
  const ok = (id, cond, detail = '') => verdict(id, cond, detail, V);

  // === CA-N1 clavier ===
  await goHome(page);
  ok('CA-N1 (accueil sans focus auto en souris/tactile)', (await focused(page)) === null);
  await page.keyboard.press('ArrowRight');
  await sleep(150);
  let f = await focused(page);
  ok('CA-N1 (clavier : 1re flèche donne le focus à une carte)', f?.tag === 'A' && /machine-tile/.test(f.cls), JSON.stringify(f));
  const ring = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { w: cs.outlineWidth, s: cs.outlineStyle, c: cs.outlineColor, off: cs.outlineOffset }; });
  ok('CA-V1 (anneau de focus clavier carte >= 3px)', parseFloat(ring.w) >= 3 && ring.s !== 'none', JSON.stringify(ring));

  // === CA-N5 flèches : accueil (2 machines) ===
  await page.keyboard.press('ArrowRight'); await sleep(100);
  const f2 = await focused(page);
  await page.keyboard.press('ArrowRight'); await sleep(100);
  const f3 = await focused(page);
  ok('CA-N5 (accueil : droite, pas de bouclage au bord)', f2?.navId !== f?.navId && f3?.navId === f2?.navId, `${f?.navId} -> ${f2?.navId} -> ${f3?.navId}`);
  await page.keyboard.press('ArrowDown'); await sleep(100);
  ok('CA-N5 (accueil : bas sans rangée dessous = le focus reste)', (await focused(page))?.navId === f3?.navId);

  // === CA-N5 / N6 grille : Amiga 9 jeux ===
  await page.keyboard.press('Enter'); await sleep(250); // ouvre la machine du focus courant
  const hash1 = await page.evaluate(() => location.hash);
  await page.goto(`${BASE}/index.html#/amiga`); await page.waitForSelector('.game-tile'); await sleep(300);
  f = await focused(page);
  ok('CA-N1/CA-C (grille : un jeu a le focus dès l\'arrivée)', f?.tag === 'A' && /game-tile/.test(f.cls), JSON.stringify(f));
  const cols = await page.evaluate(() => { const t = [...document.querySelectorAll('.game-tile')].map((e) => Math.round(e.getBoundingClientRect().top / 10)); return t.filter((y) => y === t[0]).length; });
  // Droite
  const seq = [];
  const rec = async () => seq.push((await focused(page))?.navId);
  await rec();
  await page.keyboard.press('ArrowRight'); await sleep(120); await rec();
  await page.keyboard.press('ArrowLeft'); await sleep(120); await rec();
  await page.keyboard.press('ArrowLeft'); await sleep(120); await rec(); // bord gauche : reste
  ok('CA-N5 (grille : droite/gauche, pas de bouclage)', seq[1] !== seq[0] && seq[2] === seq[0] && seq[3] === seq[0], `colonnes=${cols} ${seq.join(' | ')}`);
  await page.keyboard.press('ArrowDown'); await sleep(250); await waitScroll(page);
  const down1 = (await focused(page))?.navId;
  await page.keyboard.press('ArrowUp'); await sleep(250); await waitScroll(page);
  const up1 = (await focused(page))?.navId;
  ok('CA-N5 (grille : bas puis haut revient à la même tuile)', down1 !== seq[0] && up1 === seq[0], `${seq[0]} -> ${down1} -> ${up1}`);
  await page.keyboard.press('ArrowUp'); await sleep(250);
  f = await focused(page);
  ok('CA-N5 (grille : haut depuis la 1re rangée = bouton retour de l\'en-tête)', f?.navId === 'back', JSON.stringify(f));
  await page.keyboard.press('ArrowDown'); await sleep(250);
  // dernière rangée plus courte : aller au dernier élément
  for (let i = 0; i < 12; i++) { await page.keyboard.press('ArrowDown'); await sleep(80); }
  await waitScroll(page);
  const lastRowFocus = await page.evaluate(() => { const tiles = [...document.querySelectorAll('.game-tile')]; return { idx: tiles.indexOf(document.activeElement), n: tiles.length }; });
  ok('CA-N5 (bas jusqu\'à la dernière rangée atteint la dernière rangée)', lastRowFocus.idx >= lastRowFocus.n - cols, JSON.stringify({ ...lastRowFocus, cols }));

  // CA-N6 : visibilité à chaque pas sur toute la grille (on repart du haut)
  await page.goto(`${BASE}/index.html#/amiga`); await page.waitForSelector('.game-tile'); await sleep(300);
  let allVisible = true; const failures = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press(i % 2 === 0 ? 'ArrowDown' : 'ArrowRight'); await sleep(120); await waitScroll(page);
    if (!(await inViewport(page))) { allVisible = false; failures.push(i); }
  }
  ok('CA-N6 (l\'élément focusé reste entièrement visible)', allVisible, `échecs aux pas ${failures.join(',')}`);
  // avec mise à l'échelle 1.05 + anneau 4px+3px : le bord de l'anneau reste dans la fenêtre ?
  const ringVisible = await page.evaluate(() => { const r = document.activeElement.getBoundingClientRect(); const m = 4 + 3; return { top: r.top - m, bottom: innerHeight - (r.bottom + m), left: r.left - m, right: innerWidth - (r.right + m) }; });
  ok('CA-N6 (anneau de focus complet visible, marge >= 0)', Object.values(ringVisible).every((v) => v >= -1), JSON.stringify(ringVisible));

  // === CA-C2, CA-C3 ===
  await page.goto(`${BASE}/index.html#/amiga`); await page.waitForSelector('.game-tile');
  const covers = await page.evaluate(() => ({ tiles: document.querySelectorAll('.game-tile').length, imgs: document.querySelectorAll('.game-cover > img').length, initials: [...document.querySelectorAll('.cover-initials')].map((e) => e.textContent), broken: [...document.querySelectorAll('img')].filter((i) => i.complete && i.naturalWidth === 0 && !i.closest('.cover-logo, .machine-logo')).length }));
  ok('CA-C2 (jeu sans jaquette : repli initiales, pas d\'image cassée)', covers.imgs === 0 && covers.initials.length === covers.tiles && covers.broken === 0, JSON.stringify(covers));
  const long = await page.evaluate(() => { const t = [...document.querySelectorAll('.game-tile')].find((a) => a.getAttribute('aria-label').startsWith('Un Titre')); const s = t.querySelector('.game-title'); const cs = getComputedStyle(s); return { aria: t.getAttribute('aria-label').length, title: t.title === t.getAttribute('aria-label'), h: s.getBoundingClientRect().height, lh: parseFloat(cs.lineHeight), clip: s.scrollHeight > s.clientHeight, clamp: cs.webkitLineClamp }; });
  ok('CA-C3 (titre long : 2 lignes max, nom accessible complet)', long.h <= long.lh * 2 + 1 && long.clip && long.title && long.aria > 100, JSON.stringify(long));
  // jaquette qui ne charge pas : route une image 404 + une valide
  await page.route('**/games.json', async (route) => {
    const j = await (await route.fetch()).json();
    j.games[0].cover = 'roms/amiga/inexistante.png'; // 404
    j.games[1].cover = 'roms/amiga/corrompue.png';   // contenu non image
    await route.fulfill({ json: j });
  });
  await page.route('**/roms/amiga/corrompue.png', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: 'pas une image' }));
  await page.reload(); await page.waitForSelector('.game-tile'); await sleep(700);
  const covers2 = await page.evaluate(() => ({ tiles: document.querySelectorAll('.game-tile').length, imgs: document.querySelectorAll('.game-cover > img').length, initials: document.querySelectorAll('.cover-initials').length }));
  ok('CA-C2 (jaquette 404 ou corrompue : bascule sur le repli)', covers2.imgs === 0 && covers2.initials === covers2.tiles, JSON.stringify(covers2));
  await page.unroute('**/games.json');

  // === CA-V1 : anneau sur tous les éléments focusables, 3 écrans ===
  const ringsBad = [];
  for (const url of ['index.html', 'index.html#/amiga']) {
    await page.goto(`${BASE}/${url}`); await page.waitForSelector('.machine-tile, .game-tile'); await page.keyboard.press('Tab');
    const res = await page.evaluate(async () => {
      const lumf = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const px = (c) => { const p = c.match(/[\d.]+/g).map(Number); return { r: p[0], g: p[1], b: p[2] }; };
      const out = [];
      for (const e of document.querySelectorAll('a, button')) {
        e.focus(); const cs = getComputedStyle(e);
        const [a, b] = [lumf(px(cs.outlineColor)), lumf({ r: 15, g: 17, b: 23 })].sort((x, y) => y - x);
        if (!(parseFloat(cs.outlineWidth) >= 3 && cs.outlineStyle !== 'none' && (a + 0.05) / (b + 0.05) >= 3)) out.push(`${e.tagName}.${e.className} ${cs.outlineWidth} ${cs.outlineStyle}`);
      }
      return out;
    });
    ringsBad.push(...res);
  }
  ok('CA-V1 (contour >= 3px et contraste >= 3:1 sur toutes les cartes, tuiles, boutons)', ringsBad.length === 0, ringsBad.slice(0, 3).join('; '));

  // === CA-V2 contraste : accueil, grille, état vide ===
  const v2 = [];
  for (const url of ['index.html', 'index.html#/amiga', 'index.html#/neogeo']) {
    await page.goto(`${BASE}/${url}`); await page.waitForSelector('.machine-tile, .game-tile'); await sleep(200);
    v2.push(...(await page.evaluate(contrastScan)).map((x) => ({ url, ...x })));
  }
  ok('CA-V2 (contraste texte >= 4.5:1 : accueil, grilles)', v2.length === 0, JSON.stringify(v2.slice(0, 4)));

  // === CA-V3 cibles tactiles ===
  if (vp.touch) {
    const small = [];
    for (const url of ['index.html', 'index.html#/amiga']) {
      await page.goto(`${BASE}/${url}`); await page.waitForSelector('.machine-tile, .game-tile');
      small.push(...(await page.evaluate(smallTargets)));
    }
    ok('CA-V3 (cibles >= 48x48 : accueil, grille)', small.length === 0, small.slice(0, 4).join('; '));
  }

  // === CA-V7 / CA-C4 pas de défilement horizontal ===
  const of = [];
  for (const url of ['index.html', 'index.html#/amiga', 'index.html#/neogeo']) {
    await page.goto(`${BASE}/${url}`); await page.waitForSelector('.machine-tile, .game-tile'); await sleep(200);
    const r = await page.evaluate(overflowReport);
    if (r.scrollWidth > r.vw || r.bodyScrollWidth > r.vw || r.badCount) of.push({ url, ...r });
  }
  ok(vp.width <= 360 ? 'CA-V7 (aucun défilement horizontal à 360 px)' : 'CA-V7 (pas de débordement horizontal, test à cette largeur)', of.length === 0, JSON.stringify(of.slice(0, 2)));

  // 12 machines simulées
  await page.route('**/systems.json', async (route) => { const j = await (await route.fetch()).json(); j.systems.forEach((s) => { s.wave = 1; }); await route.fulfill({ json: j }); });
  await goHome(page);
  const twelve = await page.evaluate(() => ({ n: document.querySelectorAll('.machine-tile').length, ...(() => { const vw = innerWidth; return { sw: document.documentElement.scrollWidth, vw, bodySw: document.body.scrollWidth }; })() }));
  const of12 = await page.evaluate(overflowReport);
  const cols12 = await page.evaluate(() => { const t = [...document.querySelectorAll('.machine-tile')].map((e) => Math.round(e.getBoundingClientRect().top)); return t.filter((y) => y === t[0]).length; });
  ok('CA-C4 (12 machines : lisible, sans défilement horizontal)', twelve.n === 12 && twelve.sw <= twelve.vw && twelve.bodySw <= twelve.vw && of12.badCount === 0, JSON.stringify({ ...twelve, cols: cols12, bad: of12.bad }));
  const names12 = await page.evaluate(() => [...document.querySelectorAll('.machine-name')].every((e) => e.scrollWidth <= e.clientWidth + 1));
  ok('CA-C4 (12 machines : noms entiers, non coupés)', names12);
  if (vp.touch) {
    const small = await page.evaluate(smallTargets);
    ok('CA-V3 (cibles >= 48x48 avec 12 machines)', small.length === 0, small.slice(0, 3).join('; '));
  }
  // navigation 12 machines : bas jusqu'en bas, tout visible
  let vis12 = true;
  await page.keyboard.press('ArrowRight');
  for (let i = 0; i < 8; i++) { await page.keyboard.press('ArrowDown'); await sleep(100); await waitScroll(page); if (!(await inViewport(page))) vis12 = false; }
  ok('CA-N6 (12 machines : le focus reste visible en descendant)', vis12);
  await page.unroute('**/systems.json');

  // === CA-C1 état vide ===
  await page.route('**/games.json', async (route) => { const j = await (await route.fetch()).json(); j.games = j.games.filter((g) => g.system !== 'neogeo'); await route.fulfill({ json: j }); });
  await page.route('**/systems.json', async (route) => { const j = await (await route.fetch()).json(); j.systems.forEach((s) => { s.wave = 1; }); await route.fulfill({ json: j }); });
  await fresh(page, `${BASE}/index.html#/neogeo`); await page.waitForSelector('.empty-state'); await sleep(300);
  const empty = await page.evaluate(() => ({ text: document.querySelector('.empty-state').innerText, focus: document.activeElement.dataset.navId, code: [...document.querySelectorAll('.empty-state code')].map((c) => c.textContent) }));
  ok('CA-C1 (état vide : chemin roms/neogeo/ exact + bouton focusé)', empty.code.includes('roms/neogeo/') && empty.focus === 'back-empty' && /Revenir aux machines/.test(empty.text), JSON.stringify(empty));
  ok('CA-C1 (état vide : formats acceptés affichés)', empty.code.includes('.zip'), JSON.stringify(empty.code));
  await page.keyboard.press('Enter'); await sleep(300);
  ok('CA-C1 (état vide : Entrée sur le bouton revient à l\'accueil)', (await page.evaluate(() => location.hash)) === '#/' && !!(await page.$('.machine-tile')));
  await fresh(page, `${BASE}/index.html#/neogeo`); await page.waitForSelector('.empty-state');
  if (vp.touch) {
    const sm = await page.evaluate(smallTargets); ok('CA-V3 (état vide)', sm.length === 0, sm.join(';'));
    const wide = await page.evaluate(() => { const b = document.querySelector('.empty-state .button').getBoundingClientRect(); return { w: b.width, vw: innerWidth }; });
    ok('CA-C1 (téléphone : bouton pleine largeur)', wide.w >= wide.vw - 40, JSON.stringify(wide));
  }
  const of0 = await page.evaluate(overflowReport);
  ok('CA-V7 (état vide)', of0.scrollWidth <= of0.vw && of0.badCount === 0, JSON.stringify(of0));
  await page.unroute('**/games.json'); await page.unroute('**/systems.json');

  // === CA-N7 bouton précédent ===
  await goHome(page);
  await page.click('.machine-tile >> nth=0'); await sleep(300);
  const onGrid = await page.evaluate(() => location.hash);
  await page.goBack(); await sleep(300);
  const backHome = await page.evaluate(() => ({ hash: location.hash, tiles: document.querySelectorAll('.machine-tile').length, focus: document.activeElement?.dataset?.navId }));
  ok('CA-N7 (précédent : grille -> accueil, focus rendu à la machine quittée)', onGrid !== '#/' && backHome.tiles > 0 && backHome.focus === onGrid.replace('#/', ''), JSON.stringify({ onGrid, ...backHome }));
  await page.keyboard.press('Escape'); await sleep(200);
  ok('CA-N (accueil : Échap ne fait rien)', (await page.evaluate(() => location.hash)) === '#/' || (await page.evaluate(() => location.hash)) === '');

  await env.close();
  return null;
}

// ---------- parcours de jeu (une seule exécution par viewport) ----------
async function runPlay(vp) {
  const V = vp.name;
  const ok = (id, cond, detail = '') => verdict(id, cond, detail, V);
  const env = await open({ browser: browserName, ...vp });
  const { page } = env;

  // CA-N2 : clavier seul
  await goHome(page);
  await page.keyboard.press('ArrowRight'); await sleep(100);
  await page.keyboard.press('Enter'); await sleep(400);
  const g1 = await focused(page);
  await page.keyboard.press('Enter'); await sleep(900);
  const onPlayer = page.url().includes('player.html');
  const jouer = await focused(page);
  ok('CA-J7 (écran Jouer : bouton focusé à l\'arrivée)', onPlayer && /Jouer/.test(jouer?.text ?? ''), JSON.stringify(jouer));
  await page.keyboard.press('Enter'); await sleep(700);
  const playing = await page.evaluate(() => ({ fake: !!document.getElementById('fake-canvas'), globals: window.__ejs?.globals, body: document.body.className }));
  ok('CA-N2 (clavier : accueil -> grille -> Jouer -> jeu)', playing.fake && playing.body.includes('is-playing'), JSON.stringify({ g1: g1?.navId }));
  // plan de lancement
  ok('Lancement (variables EJS_*)', playing.globals?.EJS_core === 'amiga' && /roms\/amiga\//.test(decodeURIComponent(playing.globals.EJS_gameUrl)) && /bios\/kick40068/.test(playing.globals.EJS_biosUrl), JSON.stringify(playing.globals));
  // CA-J1 : touches de jeu
  for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'a', 'b', 'x', 'y', 'Enter', 'Space', 'z', 's']) { await page.keyboard.press(k); await sleep(40); }
  await page.keyboard.press('Escape'); await sleep(200); // Échap court
  await page.keyboard.down('Escape'); await sleep(400); await page.keyboard.up('Escape'); await sleep(200);
  await page.evaluate(() => window.__padSet([PAD_START = 9], [0, 0, 0, 0])); await sleep(1300); await page.evaluate(() => window.__padSet([], [0, 0, 0, 0])); await sleep(150); // Start seul 1,3 s
  await page.evaluate(() => window.__padSet([8], [0, 0, 0, 0])); await sleep(1300); await page.evaluate(() => window.__padSet([], [0, 0, 0, 0])); await sleep(150); // Select seul
  for (const b of [0, 1, 2, 3]) await padPress(page, [b], 100);
  ok('CA-J1 (aucune touche de jeu, Échap court, Start seul, Select seul n\'ouvre la confirmation)', !(await dialogOpen(page)) && page.url().includes('player.html'));
  ok('CA-J1 (le jeu n\'a pas été mis en pause par ces touches)', (await page.evaluate(() => window.__ejs.pauses)) === 0);
  // le site ne bloque pas les touches du jeu : preventDefault absent
  const prevented = await page.evaluate(() => new Promise((res) => { const out = {}; const h = (e) => { out[e.key] = e.defaultPrevented; }; setTimeout(() => { window.removeEventListener('keydown', h); res(out); }, 300); window.addEventListener('keydown', h); }));
  await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Enter'); await sleep(350);
  // CA-J2 : F10
  await page.keyboard.press('F10'); await sleep(300);
  ok('CA-J2 (F10 ouvre la confirmation)', await dialogOpen(page));
  ok('CA-J2 (jeu en pause pendant la confirmation)', await page.evaluate(() => window.__ejs.paused === true));
  const dlg = await page.evaluate(() => ({ role: document.querySelector('[role=dialog]').getAttribute('role'), modal: document.querySelector('[role=dialog]').getAttribute('aria-modal'), labelled: document.querySelector('[role=dialog]').getAttribute('aria-labelledby'), focus: document.activeElement.textContent }));
  ok('CA-J3 (focus par défaut = Continuer ; role=dialog aria-modal)', dlg.focus === 'Continuer' && dlg.modal === 'true', JSON.stringify(dlg));
  // piège du focus : Tab
  await page.keyboard.press('Tab'); await page.keyboard.press('Tab'); await page.keyboard.press('Tab');
  ok('CA-J (focus piégé dans la boîte avec Tab)', await page.evaluate(() => !!document.activeElement.closest('[role=dialog]')));
  // Échap court = Continuer
  await page.keyboard.press('Escape'); await sleep(300);
  ok('CA-J3 (Échap court dans la boîte = Continuer, jeu repris)', !(await dialogOpen(page)) && (await page.evaluate(() => window.__ejs.paused === false)));
  // Échap maintenu 1 s
  await page.keyboard.down('Escape'); await sleep(1250); await page.keyboard.up('Escape'); await sleep(300);
  ok('CA-J2 (Échap maintenu 1 s ouvre la confirmation)', await dialogOpen(page));
  // Continuer par B manette
  await padWake(page); // la manette n'est vue qu'ici
  await padPress(page, [PAD.B], 120);
  ok('CA-J3 (B manette dans la boîte = Continuer)', !(await dialogOpen(page)));
  // Select+Start 1 s
  await page.evaluate(() => window.__padSet([8, 9], [0, 0, 0, 0])); await sleep(1300); await page.evaluate(() => window.__padSet([], [0, 0, 0, 0])); await sleep(300);
  ok('CA-J2 (Select + Start maintenus 1 s ouvrent la confirmation)', await dialogOpen(page));
  // répéter Select+Start = Quitter ?
  const urlBefore = page.url();
  // d'abord naviguer Gauche/Droite
  await padPress(page, [PAD.RIGHT], 100);
  const onQuit = await page.evaluate(() => document.activeElement.textContent);
  ok('CA (boîte : croix droite place le focus sur Quitter)', onQuit === 'Quitter', onQuit);
  await padPress(page, [PAD.LEFT], 100);
  // Menu bouton
  await page.keyboard.press('Escape'); await sleep(300);
  ok('CA-J3 (retour clavier ferme la boîte)', !(await dialogOpen(page)));
  const menuBox = await page.evaluate(() => { const b = document.querySelector('.menu-button').getBoundingClientRect(); return { w: b.width, h: b.height, x: b.left, y: b.top }; });
  ok('CA-J5 (bouton Menu >= 48x48, coin haut gauche)', menuBox.w >= 47.5 && menuBox.h >= 47.5 && menuBox.y < 20 && menuBox.x < 20, JSON.stringify(menuBox));
  if (vp.touch) {
    await page.touchscreen.tap(menuBox.x + 20, menuBox.y + 20);
  } else {
    await page.mouse.move(100, 300); await page.click('.menu-button');
  }
  await sleep(300);
  ok('CA-J2 (bouton Menu ouvre la confirmation)', await dialogOpen(page));
  // retour du navigateur pendant la confirmation = Continuer ; pendant jeu = ouvre confirmation
  await page.keyboard.press('Escape'); await sleep(300);
  await page.goBack(); await sleep(500);
  ok('CA-N7 (précédent navigateur pendant le jeu ouvre la confirmation)', (await dialogOpen(page)) && page.url().includes('player.html'), page.url());
  await page.goBack(); await sleep(400);
  ok('CA-N7 (précédent pendant la confirmation = Continuer)', !(await dialogOpen(page)) && page.url().includes('player.html'));
  // CA-J4 Quitter
  await page.keyboard.press('F10'); await sleep(300);
  await page.keyboard.press('ArrowRight'); await sleep(100);
  await page.keyboard.press('Enter'); await sleep(900);
  const after = await page.evaluate(() => ({ url: location.href, hash: location.hash, focus: document.activeElement?.dataset?.navId, tiles: document.querySelectorAll('.game-tile').length }));
  const visible = await inViewport(page);
  ok('CA-J4 (Quitter : retour à la grille, focus sur la tuile du jeu quitté, visible)', after.hash.startsWith('#/amiga') && after.focus === new URLSearchParams(after.hash.split('?')[1]).get('focus') && visible, JSON.stringify(after));
  await page.keyboard.press('Escape'); await sleep(300);
  const home2 = await page.evaluate(() => ({ hash: location.hash, focus: document.activeElement?.dataset?.navId }));
  ok('CA-N2 (clavier : retour grille -> accueil, focus sur la machine)', (home2.hash === '#/' || home2.hash === '') && home2.focus === 'amiga', JSON.stringify(home2));
  await env.close();
}

async function runPlayAltInputs(vp) {
  // CA-N3 manette seule, CA-N4 tactile seul
  const V = vp.name;
  const ok = (id, cond, detail = '') => verdict(id, cond, detail, V);
  // --- manette ---
  let env = await open({ browser: browserName, ...vp, touch: false });
  let { page } = env;
  await goHome(page);
  await padWake(page);
  ok('CA-N1 (manette : 1er appui = réveil + toast, focus sur une carte)', /machine-tile/.test((await focused(page))?.cls ?? '') && (await page.locator('#toast').innerText()) !== '', JSON.stringify(await focused(page)));
  await padPress(page, [PAD.RIGHT]);
  await padPress(page, [PAD.LEFT]);
  const ringPad = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { w: cs.outlineWidth, cls: document.body.className }; });
  ok('CA-V1 (anneau de focus en mode manette)', parseFloat(ringPad.w) >= 3 && /input-gamepad/.test(ringPad.cls), JSON.stringify(ringPad));
  await padPress(page, [PAD.A]);
  await sleep(300);
  await padPress(page, [PAD.RIGHT]); // 2e tuile
  await padPress(page, [PAD.DOWN]);
  await padPress(page, [PAD.A]); await sleep(900);
  ok('CA-N3 (manette : accueil -> grille -> écran Jouer)', page.url().includes('player.html'), page.url());
  ok('CA-J7 (manette : bouton Jouer focusé)', /Jouer/.test((await focused(page))?.text ?? ''));
  await padPress(page, [PAD.A]); await sleep(700);
  const swallowed = !(await page.evaluate(() => document.body.classList.contains('is-playing')));
  verdict('OBS manette : sur une nouvelle page (player.html), le 1er appui de A est avalé par le réveil', null, swallowed ? 'oui : il faut appuyer deux fois sur A pour lancer le jeu (conforme à ux.md 4.2, mais coûteux à chaque changement de page)' : 'non', V);
  if (swallowed) { await padPress(page, [PAD.A]); await sleep(700); }
  ok('CA-J7 (A lance le jeu)', await page.evaluate(() => document.body.classList.contains('is-playing')));
  await page.evaluate(() => window.__padSet([8, 9], [0, 0, 0, 0])); await sleep(1300); await page.evaluate(() => window.__padSet([], [0, 0, 0, 0])); await sleep(300);
  ok('CA-J2 (manette : Select+Start ouvre la confirmation)', await dialogOpen(page));
  await padPress(page, [PAD.RIGHT]); await padPress(page, [PAD.A]); await sleep(900);
  const aft = await page.evaluate(() => ({ hash: location.hash, focus: document.activeElement?.dataset?.navId }));
  ok('CA-N3/CA-J4 (manette : Quitter -> grille, focus sur la tuile)', aft.hash.startsWith('#/') && !!aft.focus && aft.focus.includes('/'), JSON.stringify(aft));
  await padPress(page, [PAD.B]); await sleep(300); // 1er appui sur la nouvelle page index.html = réveil
  if ((await page.evaluate(() => location.hash)).startsWith('#/amiga') || (await page.evaluate(() => location.hash)).startsWith('#/neogeo')) await padPress(page, [PAD.B]);
  await sleep(300);
  const h = await page.evaluate(() => ({ hash: location.hash, focus: document.activeElement?.dataset?.navId }));
  ok('CA-N3 (manette : B ramène à l\'accueil, focus sur la machine)', (h.hash === '#/' || h.hash === '') && /amiga|neogeo/.test(h.focus ?? ''), JSON.stringify(h));
  // stick gauche + répétition
  await goHome(page); await padWake(page);
  await page.evaluate(() => window.__padSet([], [0.9, 0, 0, 0])); await sleep(1100); await page.evaluate(() => window.__padSet([], [0, 0, 0, 0]));
  ok('Stick gauche (déplace le focus)', (await focused(page))?.navId === (await page.evaluate(() => [...document.querySelectorAll('.machine-tile')].pop().dataset.navId)));
  // Start valide sur les menus
  await goHome(page); await padWake(page); await padPress(page, [PAD.START]); await sleep(300);
  ok('Start valide dans les menus', (await page.evaluate(() => location.hash)).startsWith('#/') && (await page.evaluate(() => location.hash)) !== '#/');
  await env.close();

  // --- tactile ---
  if (vp.touch) {
    env = await open({ browser: browserName, ...vp }); page = env.page;
    await goHome(page);
    await page.tap('.machine-tile >> nth=0'); await sleep(300);
    const noRing = await page.evaluate(() => { const cs = getComputedStyle(document.activeElement); return { w: cs.outlineWidth, s: cs.outlineStyle }; });
    await page.waitForSelector('.game-tile');
    await page.tap('.game-tile >> nth=1'); await sleep(900);
    ok('CA-N4 (tactile : tap machine puis jeu ouvre l\'écran Jouer)', page.url().includes('player.html'), page.url());
    await page.tap('.play-button'); await sleep(700);
    ok('CA-N4 (tactile : tap Jouer lance le jeu)', await page.evaluate(() => document.body.classList.contains('is-playing')));
    const hint = await page.evaluate(() => document.querySelector('.exit-hint')?.innerText ?? null);
    ok('Rappel de sortie au lancement (tactile)', !!hint, hint ?? 'absent');
    const m = await page.evaluate(() => { const b = document.querySelector('.menu-button').getBoundingClientRect(); const h = document.querySelector('.exit-hint')?.getBoundingClientRect(); return { b: [b.left, b.top, b.right, b.bottom], h: h && [h.left, h.top, h.right, h.bottom], vw: innerWidth, op: getComputedStyle(document.querySelector('.menu-wrap')).opacity }; });
    ok('CA-J5/CA-V3 (tactile : Menu >= 48x48, rappel ne le recouvre pas)', m.b[2] - m.b[0] >= 47.5 && m.b[3] - m.b[1] >= 47.5 && (!m.h || m.h[1] >= m.b[3]), JSON.stringify(m));
    await page.tap('.menu-button'); await sleep(300);
    ok('CA-J2 (tactile : Menu ouvre la confirmation)', await dialogOpen(page));
    const small = await page.evaluate(smallTargets);
    ok('CA-V3 (boîte de confirmation : cibles >= 48x48)', small.length === 0, small.join('; '));
    await page.tap('[role=dialog] button >> nth=1'); await sleep(900);
    const aft2 = await page.evaluate(() => ({ hash: location.hash, focus: document.activeElement?.dataset?.navId }));
    ok('CA-N4/CA-J4 (tactile : Quitter -> grille)', aft2.hash.startsWith('#/amiga'), JSON.stringify(aft2));
    await page.tap('.back-button'); await sleep(300);
    ok('CA-N4 (tactile : bouton < ramène à l\'accueil)', (await page.evaluate(() => location.hash)) === '#/');
    await env.close();
  }
}

(async () => {
  console.log(`# navigateur : ${browserName}`);
  for (const vp of VIEWPORTS.filter((v) => process.argv[3] !== 'desktop' || !v.touch)) {
    for (const fn of [runViewport, runPlay, runPlayAltInputs]) {
      try { await fn(vp); } catch (e) { verdict(`ERREUR SCRIPT ${fn.name}`, false, String(e).slice(0, 300), vp.name); }
    }
  }
})();
