// T32 : joystick tactile (directions depuis l'angle et la distance de nipplejs) et remplacement du traitement d'EmulatorJS.
import test from 'node:test';
import assert from 'node:assert/strict';
import { stickDirections, RELEASED, DEAD_ZONE } from '../js/player/virtual-stick.js';
import { patchVirtualStick } from '../js/player/launcher.js';

const at = (degree, distance = 40, prev = RELEASED) => stickDirections({ angle: { degree }, distance }, prev);
const on = (s) => Object.keys(s).filter((k) => s[k]).sort().join('+') || 'rien';

test('stickDirections : 4 directions et 4 diagonales (0° = droite, 90° = haut, sens anti-horaire)', () => {
  assert.equal(on(at(0)), 'right');
  assert.equal(on(at(90)), 'up');
  assert.equal(on(at(180)), 'left');
  assert.equal(on(at(270)), 'down');
  assert.equal(on(at(45)), 'right+up');
  assert.equal(on(at(135)), 'left+up');
  assert.equal(on(at(225)), 'down+left');
  assert.equal(on(at(315)), 'down+right');
  assert.equal(on(at(359.5)), 'right');
});

test('stickDirections : zone morte au centre (un doigt posé à 1 px à gauche du centre ne donne pas « gauche »)', () => {
  assert.equal(on(at(180, 1)), 'rien');
  assert.equal(on(at(180, DEAD_ZONE.on - 0.1)), 'rien');
  assert.equal(on(at(180, DEAD_ZONE.on)), 'left');
});

test('stickDirections : hystérésis, une direction tenue ne clignote pas au bord de la zone morte ni d\'un secteur', () => {
  const left = at(180);
  assert.equal(on(at(180, DEAD_ZONE.off + 0.5, left)), 'left'); // sous le seuil d'entrée, au-dessus du seuil de sortie
  assert.equal(on(at(180, DEAD_ZONE.off - 0.5, left)), 'rien');
  const right = at(0);
  assert.equal(on(at(25, 40)), 'right+up'); // sans état : diagonale dès 22,5°
  assert.equal(on(at(25, 40, right)), 'right'); // droite tenue : il faut aller plus loin pour ajouter haut
  assert.equal(on(at(35, 40, right)), 'right+up');
});

test('stickDirections : jamais deux directions opposées', () => {
  for (let d = 0; d < 360; d += 0.5) {
    for (const prev of [RELEASED, at(d - 10), at(d + 10)]) {
      const s = at(d, 40, prev);
      assert.ok(!(s.left && s.right) && !(s.up && s.down), `${d}°`);
    }
  }
});

/** Faux nipplejs et faux cœur : create renvoie un gestionnaire dont on déclenche les évènements à la main. */
function fakes() {
  const handlers = {};
  const sent = [];
  const lib = { create: (options) => ({ options, on: (type, fn) => { handlers[type] = fn; } }) };
  const gameManager = { simulateInput: (p, code, value) => sent.push([p, code, value]) };
  return { lib, gameManager, handlers, sent };
}

test('patchVirtualStick : le « move » d\'EmulatorJS est remplacé ; seuls les changements partent au cœur, tout de suite (codes 4 haut, 5 bas, 6 gauche, 7 droite)', () => {
  const { lib, gameManager, handlers, sent } = fakes();
  patchVirtualStick(lib, () => gameManager);
  let ejsMove = 0;
  let ejsEnd = 0;
  const manager = lib.create({ zone: 'z' });
  assert.equal(manager.options.zone, 'z');
  manager.on('move', () => { ejsMove++; });
  manager.on('end', () => { ejsEnd++; });
  handlers.move({}, { angle: { degree: 180 }, distance: 1 }); // doigt posé juste à gauche du centre
  assert.deepEqual(sent, []);
  handlers.move({}, { angle: { degree: 0 }, distance: 30 });
  handlers.move({}, { angle: { degree: 2 }, distance: 35 });
  assert.deepEqual(sent, [[0, 7, 1]]);
  handlers.move({}, { angle: { degree: 180 }, distance: 30 });
  assert.deepEqual(sent.slice(1), [[0, 6, 1], [0, 7, 0]]);
  handlers.end({}, {});
  assert.equal(ejsMove, 0, 'le traitement d\'EmulatorJS (relâchements en retard de 30 ms) n\'est jamais appelé');
  assert.equal(ejsEnd, 1, 'la fin d\'EmulatorJS (tout relâcher) est gardée');
  handlers.move({}, { angle: { degree: 180 }, distance: 30 }); // après « end », l'état repart de zéro
  assert.deepEqual(sent.at(-1), [0, 6, 1]);
});

test('patchVirtualStick : les autres évènements passent tels quels ; un seul remplacement ; cœur pas encore prêt sans erreur', () => {
  const { lib, handlers } = fakes();
  patchVirtualStick(lib, () => undefined);
  const wrapped = lib.create;
  patchVirtualStick(lib, () => undefined);
  assert.equal(lib.create, wrapped);
  const fn = () => {};
  const manager = lib.create({});
  manager.on('start', fn);
  assert.equal(handlers.start, fn);
  manager.on('move', () => {});
  assert.doesNotThrow(() => handlers.move({}, { angle: { degree: 0 }, distance: 30 }));
  assert.doesNotThrow(() => patchVirtualStick(undefined, () => undefined));
});
