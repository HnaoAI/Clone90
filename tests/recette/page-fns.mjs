// Fonctions de mesure exécutées DANS la page (page.evaluate) : débordement, contraste WCAG, cibles tactiles. Sans dépendance.
// ---------- fonctions exécutées dans la page ----------
export const overflowReport = () => {
  const vw = window.innerWidth;
  const bad = [];
  for (const e of document.querySelectorAll('body *')) {
    const r = e.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.right > vw + 1 || r.left < -1) bad.push(`${e.tagName}.${e.className} ${Math.round(r.left)}..${Math.round(r.right)}`);
  }
  return { scrollWidth: document.documentElement.scrollWidth, bodyScrollWidth: document.body.scrollWidth, vw, bad: bad.slice(0, 5), badCount: bad.length };
};

export const contrastScan = () => {
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); const p = m[1].split(',').map((x) => parseFloat(x)); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c.a > 0.5) return c; } return { r: 15, g: 17, b: 23, a: 1 }; };
  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    const fg = parse(cs.color); const bg = bgOf(el);
    const size = parseFloat(cs.fontSize); const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const c = ratio(fg, bg);
    if (c < need) out.push({ text: n.textContent.trim().slice(0, 30), ratio: +c.toFixed(2), need, el: `${el.tagName}.${el.className}` });
  }
  return out;
};

export const smallTargets = () => [...document.querySelectorAll('a, button, [role=button]')].filter((e) => {
  const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (r.width < 47.5 || r.height < 47.5);
}).map((e) => `${e.tagName}.${e.className} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`);

