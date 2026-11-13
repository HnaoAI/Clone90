// Recette T32 : le joystick tactile (zone nipplejs du schéma de manette par défaut : Amiga, arcade, Neo Geo...) envoie la bonne direction
// au cœur, sur téléphone Android (Pixel 7, portrait et paysage). Signalé par Hicham : « Quand je vais à droite, le jeu va à gauche », de temps en temps.
// Même montage que manette-tactile.mjs (T31) : vrai EmulatorJS (EJS_DATA, EJS_CORE), serveur `node scripts/serve.mjs --port 8765`, ROM NES
// dans roms/nes/ (GAME), schéma par défaut forcé par EJS_controlScheme. Vrais évènements tactiles (CDP Input.dispatchTouchEvent).
// Mesure : chaque appel à gameManager.simulateInput (codes 4 haut, 5 bas, 6 gauche, 7 droite), rejoué pour connaître l'état du cœur à tout instant.
import { pw, BASE, verdict, sleep } from './lib.mjs';
import { routeLocalCdn } from './mobile-menu-lib.mjs';

const { EJS_DATA, EJS_CORE } = process.env;
const GAME = process.env.GAME ?? 'nes/test';
if (!EJS_DATA || !EJS_CORE) {
  verdict('T32-joystick', null, 'EJS_DATA et EJS_CORE non fournis (paquets npm EmulatorJS dépaquetés)');
  process.exit(0);
}
const NAMES = { 4: 'haut', 5: 'bas', 6: 'gauche', 7: 'droite' };

/** Rejoue les appels : liste des états successifs {haut, bas, gauche, droite} (seuls les changements). */
function replay(calls) {
  const state = { haut: 0, bas: 0, gauche: 0, droite: 0 };
  const states = [];
  for (const [code, value] of calls) {
    if (!(code in NAMES) || state[NAMES[code]] === (value ? 1 : 0)) continue;
    state[NAMES[code]] = value ? 1 : 0;
    states.push({ ...state });
  }
  return { states, last: { ...state } };
}
const pressed = (s) => Object.keys(s).filter((k) => s[k]).join('+') || 'rien';

const browser = await pw.chromium.launch();
for (const [name, device] of [['portrait', 'Pixel 7'], ['paysage', 'Pixel 7 landscape']]) {
  const context = await browser.newContext({ ...pw.devices[device], serviceWorkers: 'block' });
  await routeLocalCdn(context, EJS_DATA, EJS_CORE);
  await context.addInitScript(() => { window.EJS_controlScheme = 'amiga'; });
  const page = await context.newPage();
  await page.goto(`${BASE}/player.html?system=${GAME.split('/')[0]}&game=${encodeURIComponent(GAME)}`);
  await page.locator('.play-button').tap();
  await page.waitForFunction(() => window.EJS_emulator?.started, null, { timeout: 30000 }).catch(() => {});
  await sleep(5000); // retrait automatique de la barre d'EmulatorJS
  const center = await page.evaluate(() => {
    const gm = window.EJS_emulator.gameManager;
    window.__calls = [];
    const orig = gm.simulateInput.bind(gm);
    gm.simulateInput = (p, k, v) => { window.__calls.push([k, v]); return orig(p, k, v); };
    const b = document.querySelector('.ejs_virtualGamepad_parent .nipple .back').getBoundingClientRect();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  });
  const cdp = await context.newCDPSession(page);
  const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y]) => ({ x, y, id: 1 })) });
  const calls = () => page.evaluate(() => { const c = window.__calls; window.__calls = []; return c; });
  const { x, y } = center;
  /** Geste : points successifs (décalage depuis le centre), puis attente, état mesuré doigt posé, puis relâché. */
  async function gesture(points, { gap = 16, hold = 300 } = {}) {
    await touch('touchStart', [[x + points[0][0], y + points[0][1]]]);
    for (const [dx, dy] of points.slice(1)) { if (gap) await sleep(gap); await touch('touchMove', [[x + dx, y + dy]]); }
    await sleep(hold);
    const during = replay(await calls());
    await touch('touchEnd', []);
    await sleep(100);
    const after = replay(await calls());
    return { during, after };
  }

  // 1) Le doigt se pose un peu à gauche du centre (cas courant sur un vrai téléphone), puis glisse à droite : jamais « gauche ».
  for (const start of [-1, -3]) {
    const steps = [[start, 0], ...[5, 10, 15, 20, 30, 40].map((d) => [d, 0])];
    const { during, after } = await gesture(steps);
    const wrong = during.states.find((s) => s.gauche);
    verdict('T32-droite-sans-gauche', !wrong && during.last.droite === 1, `départ ${start} px : ${during.states.map(pressed).join(' > ')}`, name);
    verdict('T32-relache', pressed(after.last) === 'rien', pressed(after.last), name);
  }
  // 2) Gauche puis droite d'un coup (sans pause) : la droite reste appuyée (aucun relâchement en retard), jamais gauche et droite ensemble.
  for (let i = 0; i < 3; i++) {
    const { during } = await gesture([[0, 0], [-40, 0], [-40, 2], [40, 0], [40, 2]], { gap: 0, hold: 200 });
    verdict('T32-gauche-puis-droite', during.last.droite === 1 && during.last.gauche === 0, `essai ${i + 1} : fin ${pressed(during.last)} (${during.states.map(pressed).join(' > ')})`, name);
    verdict('T32-jamais-opposes', during.states.every((s) => !(s.gauche && s.droite) && !(s.haut && s.bas)), during.states.map(pressed).join(' > '), name);
  }
  // 3) Doigt posé au centre qui tremble de quelques pixels : aucune direction (zone morte).
  {
    const { during } = await gesture([[0, 0], [2, 1], [-2, -1], [1, 3], [-3, 0], [0, -2]]);
    verdict('T32-zone-morte', during.states.length === 0, during.states.map(pressed).join(' > ') || 'aucune direction', name);
  }
  // 4) Les 8 directions marchent toujours.
  for (const [label, dx, dy, want] of [['droite', 40, 0, 'droite'], ['gauche', -40, 0, 'gauche'], ['haut', 0, -40, 'haut'], ['bas', 0, 40, 'bas'],
    ['haut-droite', 30, -30, 'haut+droite'], ['bas-gauche', -30, 30, 'bas+gauche'], ['haut-gauche', -30, -30, 'haut+gauche'], ['bas-droite', 30, 30, 'bas+droite']]) {
    const { during } = await gesture([[0, 0], [dx / 2, dy / 2], [dx, dy]]);
    verdict('T32-directions', pressed(during.last) === want, `${label} : ${pressed(during.last)}`, name);
  }
  // 5) Le disque du joystick suit toujours le doigt (affichage de nipplejs gardé).
  await touch('touchStart', [[x, y]]);
  await touch('touchMove', [[x + 40, y]]);
  await sleep(50);
  const transform = await page.evaluate(() => document.querySelector('.ejs_virtualGamepad_parent .nipple .front').style.transform);
  await touch('touchEnd', []);
  verdict('T32-disque-suit-le-doigt', /translate\((?!0px, 0px)/.test(transform), transform, name);
  await context.close();
}
await browser.close();
