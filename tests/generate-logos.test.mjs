// Tests du générateur de logos (T5b) : un SVG valide par machine, sans doublon, couleurs lues dans les sources, contraste, fichiers à jour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { PROJECT_ROOT } from '../scripts/project-root.mjs';
import { GLYPHS } from '../scripts/pixel-font.mjs';
import { buildLogoSvg, contrastRatio, generateLogos, readAccentColors, LOGO_TEXT_COLOR } from '../scripts/generate-logos.mjs';

const systems = JSON.parse(readFileSync(join(PROJECT_ROOT, 'systems.json'), 'utf8')).systems;
const baseCss = readFileSync(join(PROJECT_ROOT, 'css', 'base.css'), 'utf8');
const logos = generateLogos(systems, baseCss);

test('un logo par machine de systems.json, au chemin déclaré dans le champ logo', () => {
  assert.deepEqual([...logos.keys()].sort(), systems.map((s) => s.logo).sort());
  for (const s of systems) assert.equal(s.logo, `assets/logos/${s.id}.svg`);
});

test('chaque logo est un SVG autonome et valide (balises équilibrées, rien d\'externe ni d\'actif)', () => {
  for (const [path, svg] of logos) {
    assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 160 100"[^>]*>/, path);
    assert.ok(svg.trim().endsWith('</svg>'), path);
    assert.ok(!/<script|<image|href=|url\(|<style|on[a-z]+=/i.test(svg), `contenu externe ou actif dans ${path}`);
    const open = (svg.match(/<(?!\/)[a-z]+[^>]*[^/]>/g) ?? []).length;
    const close = (svg.match(/<\/[a-z]+>/g) ?? []).length;
    assert.equal(open, close, `balises déséquilibrées dans ${path}`);
    for (const tag of svg.match(/<[a-z][^>]*>/g)) {
      const attrs = tag.replace(/^<[a-z]+/, '').replace(/\/?>$/, '').replace(/\s+[\w:-]+="[^"]*"/g, '');
      assert.equal(attrs.trim(), '', `attribut mal formé (XML strict exigé pour un SVG en image) dans ${path} : ${tag}`);
    }
    assert.match(svg, /<title>[^<]+<\/title>/, path);
  }
});

test('pas de doublon : chaque logo est différent des autres', () => {
  assert.equal(new Set(logos.values()).size, logos.size);
});

test('la couleur de fond vient de la variable déclarée dans le champ accent de systems.json', () => {
  const colors = readAccentColors(baseCss);
  for (const s of systems) {
    const expected = colors[s.accent];
    assert.match(expected, /^#[0-9a-f]{6}$/i, `${s.accent} introuvable dans css/base.css`);
    assert.ok(logos.get(s.logo).includes(`fill="${expected}"`), s.id);
  }
});

test('contraste texte/fond d\'au moins 4.5:1 pour chaque machine', () => {
  const colors = readAccentColors(baseCss);
  for (const s of systems) assert.ok(contrastRatio(LOGO_TEXT_COLOR, colors[s.accent]) >= 4.5, s.id);
  assert.ok(Math.abs(contrastRatio('#000000', '#ffffff') - 21) < 0.01);
});

test('un fond trop clair fait échouer la génération (pas de logo illisible)', () => {
  assert.throws(() => buildLogoSvg({ id: 'x', name: 'X' }, '#ffee00'), /contraste/i);
});

test('le nom de la machine est écrit en pixels : toutes les lettres des noms ont un glyphe', () => {
  for (const s of systems) for (const ch of s.name.toUpperCase().replace(/ /g, '')) assert.ok(GLYPHS[ch], `${ch} (${s.name})`);
  for (const g of Object.values(GLYPHS)) { assert.equal(g.length, 7); for (const row of g) assert.match(row, /^[01]{5}$/); }
});

test('un nom long est coupé en deux lignes et reste dans le cadre', () => {
  const svg = buildLogoSvg({ id: 'gameboycolor', name: 'Game Boy Color' }, '#7d3c98');
  const xs = [...svg.matchAll(/data-text[^>]*d="([^"]+)"/g)].flatMap((m) => [...m[1].matchAll(/M(\d+) (\d+)/g)].map((p) => [+p[1], +p[2]]));
  assert.ok(xs.length > 0);
  for (const [x, y] of xs) { assert.ok(x >= 8 && x <= 152, `x=${x}`); assert.ok(y >= 8 && y <= 92, `y=${y}`); }
  assert.match(svg, /data-lines="2"/);
});

test('les fichiers commités sont à jour par rapport au script', () => {
  for (const [path, svg] of logos) {
    const file = join(PROJECT_ROOT, path);
    assert.ok(existsSync(file), `${path} absent : lancer node scripts/generate-logos.mjs`);
    assert.equal(readFileSync(file, 'utf8'), svg, `${path} périmé : lancer node scripts/generate-logos.mjs`);
  }
});
