// Recette T9 : robustesse (données corrompues, noms de fichiers spéciaux, ROM/BIOS manquants, CDN en panne, injection).
// Usage : node tests/recette/robustesse.mjs   (serveur sur BASE avec de faux jeux, dont des noms spéciaux)
import { open, verdict, sleep, focused, BASE } from './lib.mjs';

const ok = (id, c, d = '') => verdict(id, c, d, 'robustesse');
const real = async (route) => (await route.fetch()).json();

async function homeWith(page, { games, systems, status }) {
  if (games !== undefined) await page.route('**/games.json', (r) => (status ? r.fulfill({ status, body: 'x' }) : typeof games === 'string' ? r.fulfill({ status: 200, contentType: 'application/json', body: games }) : r.fulfill({ json: games })));
  if (systems !== undefined) await page.route('**/systems.json', (r) => (typeof systems === 'string' ? r.fulfill({ status: 200, contentType: 'application/json', body: systems }) : r.fulfill({ status: systems.status ?? 200, body: systems.body ?? '' })));
  await page.goto(`${BASE}/index.html`);
  await page.waitForSelector('.machine-tile, .message-screen, .banner', { timeout: 6000 }).catch(() => {});
  await sleep(300);
  return page.evaluate(() => ({ tiles: document.querySelectorAll('.machine-tile').length, banner: document.querySelector('.banner')?.innerText.replace(/\n/g, ' | ') ?? null, fatal: document.querySelector('.message-screen')?.innerText.replace(/\n/g, ' | ') ?? null, focus: document.activeElement?.textContent?.slice(0, 40) ?? null }));
}

(async () => {
  // --- games.json ---
  const cases = [
    ['games.json corrompu (JSON invalide)', { games: '{"version":1,"games":[ {oops' }, (r) => r.tiles === 2 && /illisible/.test(r.banner ?? '')],
    ['games.json vide (0 octet)', { games: '' }, (r) => r.tiles === 2 && /illisible/.test(r.banner ?? '')],
    ['games.json = tableau JSON', { games: '[]' }, (r) => r.tiles === 2 && /illisible/.test(r.banner ?? '')],
    ['games.json version 2', { games: { version: 2, games: [] } }, (r) => r.tiles === 2 && /illisible/.test(r.banner ?? '')],
    ['games.json games:[]', { games: { version: 1, games: [] } }, (r) => r.tiles === 2 && /Aucun jeu trouvé/.test(r.banner ?? '')],
    ['games.json 500 serveur', { games: 'x', status: 500 }, (r) => r.tiles === 2 && /illisible/.test(r.banner ?? '')],
    ['games.json 404', { games: 'x', status: 404 }, (r) => r.tiles === 2 && /Aucun jeu disponible/.test(r.banner ?? '')],
    ['games.json entrées invalides (.., absolu, machine inconnue)', { games: { version: 1, games: [
      { id: 'amiga/a', system: 'amiga', title: 'OK', file: 'roms/amiga/a.adf' },
      { id: 'amiga/b', system: 'amiga', title: 'Traversée', file: '../secret.adf' },
      { id: 'amiga/c', system: 'amiga', title: 'Absolu', file: '/etc/passwd' },
      { id: 'amiga/d', system: 'amiga', title: 'Schéma', file: 'http://evil.example/x.adf' },
      { id: 'zzz/e', system: 'zzz', title: 'Inconnue', file: 'roms/zzz/e.adf' }] } }, (r) => r.tiles === 2 && /ignoré/.test(r.banner ?? '') && /4 entrée/.test(r.banner ?? '')],
  ];
  for (const [name, opt, check] of cases) {
    const env = await open({ width: 1280, height: 720 });
    const r = await homeWith(env.page, opt);
    const js = env.errors.filter((e) => e.startsWith('pageerror'));
    ok(`Robustesse : ${name}`, check(r) && js.length === 0, JSON.stringify({ ...r, js }));
    await env.close();
  }
  // --- systems.json ---
  const sysCases = [
    ['systems.json illisible (pas du JSON)', '{pas du json', (r) => r.fatal && r.tiles === 0],
    ['systems.json vide', '', (r) => r.fatal && r.tiles === 0],
    ['systems.json machines vides', '{"version":1,"systems":[]}', (r) => r.fatal && r.tiles === 0],
    ['systems.json id invalide (majuscule/traversée)', '{"version":1,"systems":[{"id":"../x","name":"X","order":1,"extensions":[]}]}', (r) => r.fatal && r.tiles === 0],
    ['systems.json HTTP 404', { status: 404, body: 'nope' }, (r) => r.fatal && r.tiles === 0],
  ];
  for (const [name, systems, check] of sysCases) {
    const env = await open({ width: 1280, height: 720 });
    const r = await homeWith(env.page, { systems });
    ok(`Robustesse : ${name} -> écran d'erreur`, check(r) && env.errors.filter((e) => e.startsWith('pageerror')).length === 0, JSON.stringify(r));
    const f = await focused(env.page);
    verdict(`Robustesse : ${name} : message lisible`, null, `info : ${r.fatal} / focus=${JSON.stringify(f)}`, 'robustesse');
    await env.close();
  }
  // --- injection HTML dans les titres, hash et focus malformés ---
  {
    const env = await open({ width: 1280, height: 720 });
    const { page } = env;
    await page.route('**/games.json', (r) => r.fulfill({ json: { version: 1, games: [
      { id: 'amiga/x1', system: 'amiga', title: '<img src=x onerror="window.__xss=1">', file: 'roms/amiga/Zool 2.adf' },
      { id: 'amiga/x2', system: 'amiga', title: '"><script>window.__xss=2</script>', file: 'roms/amiga/Zool 2.adf' }] } }));
    await page.goto(`${BASE}/index.html#/amiga?focus=%3Cscript%3Ewindow.__xss%3D3%3C%2Fscript%3E`); await page.waitForSelector('.game-tile'); await sleep(500);
    ok('Robustesse : titres HTML et ?focus= piégé n\'exécutent rien (XSS)', (await page.evaluate(() => window.__xss)) === undefined && (await page.evaluate(() => [...document.querySelectorAll('.game-title')].map((e) => e.textContent).join('|'))).includes('<img src=x'));
    await page.goto(`${BASE}/index.html#/amiga?focus=%E0%A4%A`); await sleep(400);
    ok('Robustesse : ?focus= mal encodé ne casse pas la grille', (await page.locator('.game-tile').count()) === 2 && env.errors.filter((e) => e.startsWith('pageerror')).length === 0);
    await page.goto(`${BASE}/index.html#/amiga?focus=amiga%2Finexistant`); await sleep(400);
    ok('Robustesse : ?focus= inconnu = 1er jeu focusé', (await focused(page))?.navId === 'amiga/x2');
    await page.goto(`${BASE}/index.html#/%3Cb%3E`); await sleep(400);
    ok('Robustesse : hash absurde = accueil', (await page.evaluate(() => location.hash)) === '#/' && (await page.locator('.machine-tile').count()) === 2);
    await env.close();
  }
  // --- noms de fichiers spéciaux : parcours complet jusqu'au retour avec focus ---
  const special = ['Turrican II #1', '100% Dynamite', 'Pinball Dreams ça été', 'Lemmings', 'Zool 2', 'Quest? Part 1', 'A+B', 'Tom & Jerry', 'Chaos [!] (Europe) _v2', 'Émile', '日本語'];
  const env = await open({ width: 1280, height: 720 });
  const { page } = env;
  await page.goto(`${BASE}/index.html`);
  const names = await page.evaluate(async (base) => (await (await fetch(`${base}/games.json`)).json()).games.map((g) => g.title), BASE);
  verdict('Robustesse : jeux présents pour noms spéciaux', null, `info : ${names.join(' ; ')}`, 'robustesse');
  for (const title of special) {
    if (!names.includes(title) && !names.some((n) => n.startsWith(title.split(' ')[0]))) { verdict(`Nom spécial "${title}"`, null, 'pas de fichier de test', 'robustesse'); continue; }
    await page.goto(`${BASE}/index.html#/amiga`); await page.waitForSelector('.game-tile');
    const tile = page.locator('.game-tile', { has: page.locator('.game-title', { hasText: new RegExp(`^${title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) }) }).first();
    if (!(await tile.count())) { verdict(`Nom spécial "${title}"`, null, 'tuile introuvable (titre nettoyé ?)', 'robustesse'); continue; }
    const navId = await tile.getAttribute('data-nav-id');
    await tile.click(); await sleep(700);
    const st = await page.evaluate(() => ({ url: location.href, text: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 220), play: !!document.querySelector('.play-button') }));
    let line = { ready: st.play };
    if (st.play) {
      await page.click('.play-button'); await sleep(600);
      const g = await page.evaluate(async () => { const u = window.__ejs?.globals?.EJS_gameUrl; if (!u) return null; const r = await fetch(u); return { url: u, status: r.status, bytes: (await r.arrayBuffer()).byteLength }; });
      line.game = g;
      await page.keyboard.press('F10'); await sleep(250); await page.keyboard.press('ArrowRight'); await page.keyboard.press('Enter'); await sleep(900);
      const back = await page.evaluate(() => ({ hash: location.hash, focus: document.activeElement?.dataset?.navId }));
      line.back = back; line.expectedFocus = navId;
      ok(`Nom spécial "${title}" : lancement (fichier atteint) et retour avec focus`, g?.status === 200 && g?.bytes > 0 && back.focus === navId, JSON.stringify(line));
    } else {
      ok(`Nom spécial "${title}" : lancement (fichier atteint) et retour avec focus`, false, `écran Jouer non atteint : ${st.text}`);
    }
  }
  await env.close();

  // --- ROM / BIOS manquants, CDN en panne ---
  async function playScenario(name, setup, expect, opts = {}) {
    const e = await open({ width: 1280, height: 720, ...opts });
    await setup(e.page);
    await e.page.goto(`${BASE}/player.html?system=amiga&game=${encodeURIComponent('amiga/zool_2')}`);
    await sleep(900);
    if (await e.page.locator('.play-button').count()) { await e.page.click('.play-button'); await sleep(1500); }
    const s = await e.page.evaluate(() => ({ text: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 300), focus: document.activeElement?.textContent ?? null, black: document.body.classList.contains('is-playing'), btn: [...document.querySelectorAll('a,button')].filter((b) => b.offsetParent).map((b) => b.textContent.trim()) }));
    ok(name, expect(s), JSON.stringify(s));
    return e;
  }
  let e = await playScenario('CA-J6 : ROM supprimée après génération = message + bouton focusé', (p) => p.route('**/roms/amiga/Zool*', (r) => r.fulfill({ status: 404, body: 'nope' })), (s) => /Jeu introuvable/.test(s.text) && s.focus === 'Revenir à la liste');
  await e.page.keyboard.press('Enter'); await sleep(800);
  ok('CA-J6 : le bouton ramène à la grille', (await e.page.evaluate(() => location.hash)).startsWith('#/amiga'), await e.page.evaluate(() => location.href));
  await e.close();
  e = await playScenario('BIOS Amiga requis manquant = message BIOS manquant', (p) => p.route('**/bios/kick40068*', (r) => r.fulfill({ status: 404, body: 'nope' })), (s) => /BIOS manquant/.test(s.text) && /kick40068\.A1200/.test(s.text)); await e.close();
  e = await playScenario('CA-J6 : CDN EmulatorJS inaccessible = message + bouton focusé (pas d\'écran noir)', async () => {}, (s) => /Impossible de lancer/.test(s.text) && /Revenir/.test(s.focus ?? ''), { cdn: 'fail' }); await e.close();
  e = await playScenario('player.html sans paramètres', async () => {}, () => true);
  await e.page.goto(`${BASE}/player.html`); await sleep(600);
  const np = await e.page.evaluate(() => ({ text: document.body.innerText.replace(/\n+/g, ' | ').slice(0, 200), focus: document.activeElement?.textContent }));
  ok('player.html sans paramètres : message et bouton focusé', /Revenir/.test(np.focus ?? ''), JSON.stringify(np));
  await e.page.goto(`${BASE}/player.html?system=../x&game=y`); await sleep(500);
  ok('player.html system=../x : message, pas de crash', (await e.page.locator('.message-screen, .play-message').count()) > 0 && e.errors.filter((x) => x.startsWith('pageerror')).length === 0);
  await e.page.goto(`${BASE}/player.html?system=neogeo&game=${encodeURIComponent('amiga/zool_2')}`); await sleep(500);
  ok('player.html machine et jeu incohérents : message', (await e.page.locator('.message-screen, .play-message').count()) > 0);
  await e.close();
  // localStorage inaccessible
  e = await open({ width: 1280, height: 720 });
  await e.context.addInitScript(() => { Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } }); });
  await e.page.goto(`${BASE}/player.html?system=amiga&game=${encodeURIComponent('amiga/zool_2')}`); await sleep(700);
  await e.page.click('.play-button'); await sleep(600);
  ok('localStorage inaccessible : le jeu se lance quand même', await e.page.evaluate(() => document.body.classList.contains('is-playing')) && e.errors.filter((x) => x.startsWith('pageerror')).length === 0, e.errors.join(' | '));
  await e.close();
})().catch((x) => { console.error(x); process.exit(1); });
