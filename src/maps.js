// Map definitions. Each map is built on a grid with a tiny DSL; every cell char maps to a legend entry:
//   f: floor height, c: ceiling height (omit = open sky), r: roof height for indoor cells,
//   top: floor texture, side: texture of this cell's vertical faces where it is higher than a neighbour,
//   ctex: ceiling texture, wtex: texture of lintels/roof edges above openings, liq: 'lava' | 'slime'.
// Original layouts, inspired by classic deathmatch design: loops, vertical sniper perches with drops back down,
// teleporters returning players to the high ground, and power items placed in exposed, contested spots.

export class MapBuilder {
  constructor(w, h, fill) {
    this.w = w; this.h = h;
    this.g = Array.from({ length: h }, () => Array(w).fill(fill));
    this.things = []; this.teles = [];
    this.rect(0, 0, w - 1, 0, '#'); this.rect(0, h - 1, w - 1, h - 1, '#');
    this.rect(0, 0, 0, h - 1, '#'); this.rect(w - 1, 0, w - 1, h - 1, '#');
  }
  set(x, z, c) { if (x > 0 && z > 0 && x < this.w - 1 && z < this.h - 1) this.g[z][x] = c; }
  rect(x0, z0, x1, z1, c) { for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) if (x >= 0 && z >= 0 && x < this.w && z < this.h) this.g[z][x] = c; }
  box(x0, z0, x1, z1, wall, inner) { this.rect(x0, z0, x1, z1, wall); this.rect(x0 + 1, z0 + 1, x1 - 1, z1 - 1, inner); }
  thing(type, x, z, o = {}) { this.things.push({ type, x: x + 0.5, z: z + 0.5, ...o }); }
  many(type, pts) { pts.forEach(([x, z]) => this.thing(type, x, z)); }
  tele(x, z, tx, tz, yaw) { this.teles.push({ x, z, tx, tz, yaw }); }
}

const stone = (f, top = 'flagstone', side = 'stone') => ({ f, top, side });

export const MAPS = [
  {
    name: 'GALLOWS HILL', w: 40, h: 34, fill: '.', sky: 'moon',
    fog: [0x1e0a0c, 0.02], hemi: [0x9a7a8a, 0x2a1414, 1.0], sun: [0xffd8c8, 1.6, [-0.35, 1, 0.45]],
    legend: {
      '#': { f: 7, top: 'stone', side: 'stone' },
      '.': { f: 0, top: 'grass', side: 'cliff' },
      ',': { f: 0, top: 'cobble', side: 'stone' },
      'B': { f: 6, top: 'woodfloor', side: 'brick' },
      '_': { f: 0, c: 4.5, r: 6, top: 'woodfloor', ctex: 'woodwall', wtex: 'brick' },
      ':': { f: 0, c: 3.2, r: 6, top: 'woodfloor', ctex: 'woodwall', wtex: 'brick' },
      'q': { f: 0.7, c: 4.5, r: 6, top: 'woodfloor', side: 'woodwall', ctex: 'woodwall', wtex: 'brick' },
      'z': { f: 0.5, c: 4.5, r: 6, top: 'woodfloor', side: 'woodwall', ctex: 'woodwall', wtex: 'brick' },
      'a': { f: 1.0, c: 4.5, r: 6, top: 'marble', side: 'marble', ctex: 'woodwall', wtex: 'brick' },
      '1': stone(0.5), '2': stone(1.0), '3': stone(1.5), '4': stone(2.0), '5': stone(2.5), '6': stone(3.0),
      'W': stone(4.0, 'stone'),
      'K': { f: 6.6, top: 'woodfloor', side: 'woodwall' },
      'k': { f: 3, c: 5.6, r: 6.6, top: 'woodfloor', ctex: 'woodwall', wtex: 'woodwall' },
      'j': { f: 3, c: 5.0, r: 6.6, top: 'woodfloor', ctex: 'woodwall', wtex: 'woodwall' },
      'd': stone(-0.5), 'e': stone(-1.0), 'f': stone(-1.5),
      'C': { f: 1.6, top: 'marble', side: 'marble' },
      'c': { f: -2, c: 1.0, r: 1.6, top: 'flagstone', ctex: 'marble', wtex: 'marble' },
      'g': { f: -2, c: 0.2, r: 1.6, top: 'flagstone', ctex: 'marble', wtex: 'marble' },
      'S': { f: -0.8, liq: 'slime', top: 'slime', side: 'cliff' },
      'r': stone(1.3, 'stone'),
    },
    build(m) {
      m.rect(1, 16, 38, 17, ','); m.rect(19, 1, 20, 32, ',');
      // chapel (NW): pews, raised altar, two doors
      m.box(2, 2, 15, 12, 'B', '_');
      m.rect(6, 3, 11, 4, 'a'); m.rect(6, 5, 11, 5, 'z');
      for (const z of [7, 9]) { m.rect(4, z, 6, z, 'q'); m.rect(11, z, 13, z, 'q'); }
      m.rect(8, 12, 9, 12, ':'); m.rect(15, 6, 15, 7, ':');
      m.rect(8, 13, 9, 15, ','); m.rect(16, 6, 18, 7, ',');
      // bell tower platform (NE) with battlements, a south stair and a bell house on top
      m.rect(29, 1, 38, 8, '6');
      m.rect(29, 1, 29, 8, 'W'); m.rect(29, 8, 38, 8, 'W'); m.rect(33, 8, 34, 8, '6');
      ['5', '4', '3', '2', '1'].forEach((ch, i) => m.rect(33, 9 + i, 34, 9 + i, ch));
      m.box(34, 2, 37, 5, 'K', 'k'); m.rect(34, 3, 34, 4, 'j');
      // crypt (SW): sunken trench down to a marble mausoleum
      m.box(2, 21, 13, 31, 'C', 'c');
      m.rect(6, 18, 7, 18, 'd'); m.rect(6, 19, 7, 19, 'e'); m.rect(6, 20, 7, 20, 'f'); m.rect(6, 21, 7, 21, 'g');
      for (const [x, z] of [[5, 24], [10, 24], [5, 28], [10, 28]]) m.set(x, z, 'C');
      // ruins + slime pond (SE) with an island and two bridges
      m.rect(24, 12, 27, 12, 'r'); m.rect(33, 18, 33, 20, 'r');
      m.rect(24, 22, 36, 30, 'S'); m.rect(28, 25, 32, 27, '.');
      m.rect(21, 26, 27, 26, ','); m.rect(33, 26, 36, 26, ',');
      m.tele(11, 30, 31, 4, Math.PI);

      m.many('spawn', [[5, 10], [12, 10], [36, 7], [3, 30], [25, 15], [35, 17], [22, 31], [3, 1], [10, 32], [30, 25]]);
      m.thing('w:sshotgun', 8, 3); m.thing('w:rocket', 35, 3); m.thing('w:grenade', 23, 20); m.thing('w:tommy', 14, 17); m.thing('w:tesla', 24, 3);
      m.thing('mega', 7, 26); m.thing('ah', 30, 26); m.thing('al', 12, 8); m.thing('rage', 19, 16);
      m.many('hs', [[10, 14], [30, 20], [4, 17], [36, 32], [12, 23]]); m.many('hl', [[16, 9], [33, 15], [26, 31]]);
      m.many('am:shells', [[14, 11], [22, 26], [3, 25]]); m.many('am:bullets', [[18, 24], [37, 9]]);
      m.many('am:rockets', [[32, 3], [9, 29]]); m.many('am:cells', [[25, 4], [11, 23]]);
      m.many('d:cross', [[22, 10], [25, 10], [28, 10], [22, 14], [28, 14], [36, 11], [37, 15], [12, 18], [15, 19]]);
      m.many('d:stone', [[23, 12], [31, 12], [37, 10], [30, 14], [25, 19], [31, 19], [16, 21], [17, 24]]);
      m.many('d:tree', [[3, 14], [23, 7], [37, 19], [14, 25], [17, 30], [37, 32], [27, 20]]);
      m.many('d:brazier', [[3, 3], [14, 3], [30, 2], [3, 22], [12, 26], [21, 14], [18, 19], [23, 23]]);
      m.many('d:barrel', [[16, 3], [26, 21], [3, 19], [38, 22]]);
    },
  },
  {
    name: 'SLIPGATE KEEP', w: 44, h: 36, fill: '.', sky: 'storm',
    fog: [0x1a1424, 0.018], hemi: [0x8a80b0, 0x2a1a14, 1.0], sun: [0xffc8a0, 1.5, [0.5, 1, -0.3]],
    legend: {
      '#': { f: 9, top: 'stone', side: 'stone' },
      '.': { f: 0, top: 'cobble', side: 'stone' },
      '1': stone(0.5), '2': stone(1.0), '3': stone(1.5), '4': stone(2.0), '5': stone(2.5), '6': stone(3.0, 'stone'),
      'L': { f: -1.5, liq: 'lava', top: 'lava', side: 'cliff' },
      'm': { f: -1.5, top: 'flagstone', side: 'runic' },
      'n': { f: 0.5, top: 'flagstone', side: 'runic' },
      'K': { f: 8, top: 'stone', side: 'runic' },
      'k': { f: 0.5, c: 6, r: 8, top: 'flagstone', ctex: 'runic', wtex: 'runic' },
      'D': { f: 0.5, c: 3.6, r: 8, top: 'flagstone', ctex: 'runic', wtex: 'runic' },
      'v': { f: 1.0, c: 6, r: 8, top: 'flagstone', side: 'runic', ctex: 'runic', wtex: 'runic' },
      'w': { f: 1.5, c: 6, r: 8, top: 'flagstone', side: 'runic', ctex: 'runic', wtex: 'runic' },
      'u': { f: 2.0, c: 6, r: 8, top: 'marble', side: 'runic', ctex: 'runic', wtex: 'runic' },
      'A': { f: 5.5, top: 'woodfloor', side: 'brick' },
      'i': { f: 0, c: 4, r: 5.5, top: 'woodfloor', ctex: 'woodwall', wtex: 'brick' },
      'o': { f: 0, c: 3, r: 5.5, top: 'woodfloor', ctex: 'woodwall', wtex: 'brick' },
    },
    build(m) {
      // ramparts around the curtain wall, reached by two stairs
      m.rect(1, 1, 42, 2, '6'); m.rect(1, 1, 2, 34, '6'); m.rect(41, 1, 42, 34, '6'); m.rect(1, 33, 42, 34, '6');
      ['5', '4', '3', '2', '1'].forEach((ch, i) => { m.rect(3 + i, 16, 3 + i, 17, ch); m.rect(40 - i, 18, 40 - i, 19, ch); });
      // lava moat around the keep, four bridges
      m.rect(11, 7, 32, 28, 'L');
      m.box(15, 11, 28, 24, 'K', 'k');
      m.rect(21, 7, 22, 10, 'n'); m.rect(21, 25, 22, 28, 'n'); m.rect(11, 17, 14, 18, 'n'); m.rect(29, 17, 32, 18, 'n');
      m.rect(21, 11, 22, 11, 'D'); m.rect(21, 24, 22, 24, 'D'); m.rect(15, 17, 15, 18, 'D'); m.rect(28, 17, 28, 18, 'D');
      for (const [x, z] of [[18, 14], [25, 14], [18, 21], [25, 21]]) m.set(x, z, 'K');
      m.rect(20, 15, 23, 18, 'u'); m.rect(20, 19, 23, 19, 'w'); m.rect(20, 20, 23, 20, 'v');
      // moat ledges: one with a teleporter back to the north rampart, one holding the mega health
      m.rect(12, 25, 13, 26, 'm'); m.rect(30, 8, 31, 9, 'm');
      m.tele(12, 26, 21, 1, Math.PI);
      // armory (NE) and shrine (SW)
      m.box(34, 4, 39, 11, 'A', 'i'); m.rect(36, 11, 37, 11, 'o');
      m.box(4, 25, 9, 31, 'A', 'i'); m.rect(6, 25, 7, 25, 'o');

      m.many('spawn', [[4, 4], [39, 14], [1, 20], [21, 33], [17, 13], [26, 22], [8, 20], [35, 25], [36, 7], [42, 30]]);
      m.thing('w:rocket', 21, 16); m.thing('w:sshotgun', 41, 26); m.thing('w:tesla', 6, 29); m.thing('w:grenade', 8, 5); m.thing('w:tommy', 36, 30);
      m.thing('mega', 30, 8); m.thing('ah', 36, 6); m.thing('al', 1, 8); m.thing('rage', 30, 1);
      m.many('hs', [[5, 12], [38, 22], [17, 22], [26, 13], [20, 33], [12, 3]]); m.many('hl', [[7, 27], [37, 9], [3, 33]]);
      m.many('am:shells', [[42, 20], [19, 5], [8, 22]]); m.many('am:bullets', [[34, 30], [26, 5]]);
      m.many('am:rockets', [[24, 16], [10, 32], [38, 8]]); m.many('am:cells', [[8, 29], [33, 14]]);
      m.many('d:brazier', [[5, 5], [38, 30], [10, 6], [33, 6], [10, 29], [33, 29], [16, 12], [27, 23], [8, 30], [35, 5]]);
      m.many('d:barrel', [[4, 10], [39, 26], [16, 23], [27, 12], [12, 33]]);
      m.many('d:stone', [[6, 14], [37, 15]]);
    },
  },
  {
    name: 'HELLGATE OUTPOST', w: 44, h: 36, fill: '.', sky: 'hell',
    fog: [0x2a0c06, 0.022], hemi: [0xc08060, 0x301008, 1.0], sun: [0xffb080, 1.7, [0.3, 1, 0.5]],
    legend: {
      '#': { f: 9, top: 'cliff', side: 'cliff' },
      '.': { f: 0, top: 'mars', side: 'cliff' },
      '1': { f: 0.5, top: 'mars', side: 'cliff' }, '2': { f: 1.0, top: 'mars', side: 'cliff' },
      '3': { f: 1.5, top: 'mars', side: 'cliff' }, '4': { f: 2.0, top: 'mars', side: 'cliff' },
      '8': { f: 4.5, top: 'cliff', side: 'cliff' },
      'T': { f: 6, top: 'grate', side: 'tech' },
      't': { f: 0, c: 4.5, r: 6, top: 'grate', ctex: 'tech', wtex: 'tech' },
      'o': { f: 0, c: 3.2, r: 6, top: 'grate', ctex: 'tech', wtex: 'tech' },
      'H': { f: 7.5, top: 'grate', side: 'tech' },
      'h': { f: 0, c: 6.5, r: 7.5, top: 'grate', ctex: 'tech', wtex: 'tech' },
      'O': { f: 0, c: 5, r: 7.5, top: 'grate', ctex: 'tech', wtex: 'tech' },
      'x': { f: 1.0, c: 4.5, r: 6, top: 'crate', side: 'crate', ctex: 'tech', wtex: 'tech' },
      'X': { f: 2.0, c: 4.5, r: 6, top: 'crate', side: 'crate', ctex: 'tech', wtex: 'tech' },
      'y': { f: 1.0, top: 'crate', side: 'crate' }, 'Y': { f: 2.0, top: 'crate', side: 'crate' },
      'S': { f: -0.6, liq: 'slime', top: 'slime', side: 'cliff' },
      'g': { f: 0, top: 'grate', side: 'tech' },
    },
    build(m) {
      // rocky plateau along the north edge, reached by two ramps
      m.rect(1, 1, 42, 5, '4'); m.rect(6, 6, 17, 7, '4');
      m.rect(24, 6, 25, 6, '3'); m.rect(24, 7, 25, 7, '2'); m.rect(24, 8, 25, 8, '1');
      m.rect(1, 6, 2, 6, '3'); m.rect(1, 7, 2, 7, '2'); m.rect(1, 8, 2, 8, '1');
      m.rect(10, 2, 11, 3, '8'); m.rect(33, 2, 34, 3, '8');
      // main base (south), partition walls and crate stacks
      m.box(12, 19, 31, 31, 'T', 't');
      m.rect(21, 19, 22, 19, 'o'); m.rect(12, 24, 12, 25, 'o'); m.rect(31, 24, 31, 25, 'o');
      m.rect(20, 20, 20, 23, 'T'); m.rect(24, 27, 28, 27, 'T');
      m.rect(14, 28, 15, 29, 'x'); m.set(14, 30, 'X');
      m.rect(26, 21, 27, 21, 'x'); m.set(27, 22, 'X');
      // hangar (NE)
      m.box(30, 8, 41, 16, 'H', 'h'); m.rect(30, 11, 30, 13, 'O'); m.rect(35, 16, 36, 16, 'O');
      // nukage pools with a grate catwalk, outdoor crates
      m.rect(3, 12, 9, 19, 'S');
      m.rect(34, 22, 40, 31, 'S'); m.rect(36, 22, 37, 31, 'g'); m.rect(38, 26, 39, 27, 'g');
      m.rect(20, 12, 21, 13, 'y'); m.set(22, 13, 'Y'); m.rect(5, 24, 6, 25, 'y'); m.set(5, 26, 'Y'); m.rect(37, 18, 38, 18, 'y');
      m.tele(14, 22, 41, 2, Math.PI / 2);

      m.many('spawn', [[3, 3], [40, 4], [15, 25], [28, 30], [35, 12], [22, 15], [10, 32], [41, 33], [2, 22], [24, 23]]);
      m.thing('w:rocket', 6, 3); m.thing('w:tesla', 39, 14); m.thing('w:sshotgun', 24, 29); m.thing('w:grenade', 10, 15); m.thing('w:tommy', 22, 33);
      m.thing('ah', 27, 22); m.thing('al', 33, 10); m.thing('mega', 38, 26); m.thing('rage', 16, 1);
      m.many('hs', [[18, 10], [28, 17], [8, 28], [41, 20], [17, 23]]); m.many('hl', [[25, 3], [16, 33], [36, 9]]);
      m.many('am:shells', [[22, 25], [11, 9], [32, 33]]); m.many('am:bullets', [[29, 21], [4, 29]]);
      m.many('am:rockets', [[14, 3], [40, 11]]); m.many('am:cells', [[38, 14], [5, 26]]);
      m.many('d:barrel', [[18, 21], [29, 29], [10, 21], [27, 14], [32, 19], [2, 10], [13, 34], [42, 21]]);
      m.many('d:brazier', [[8, 9], [24, 10], [19, 34], [33, 21], [3, 33]]);
      m.many('light', [[16, 22], [27, 29], [17, 29], [35, 10], [37, 14]]);
    },
  },
];
