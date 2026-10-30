// Pure deathmatch simulation: map grid, collision, nav, actors, weapons, projectiles, items, barrels, bots and match rules.
// No Three.js and no DOM. The same file runs in the browser (offline practice + client-side prediction) and, concatenated
// with maps.js by tools/build-logic.mjs, as the authoritative Multiplayer Agent room logic. Keep it import-free apart from maps.js.
import { MAPS, MapBuilder } from './maps.js';

export const CS = 2;          // world units per map cell
export const STEP = 0.6;      // max auto step-up
export const PH = 1.75;       // actor collision height
export const EYE = 1.55;
export const R_ACTOR = 0.42;
export const FRAG_LIMIT = 15, SLOTS = 6, NEXT_MAP_DELAY = 10;
export const LAGCOMP_MAX = 0.35, HIST_LEN = 0.6, INPUT_BUDGET = 0.35, EASY_SHARE = 0.6;

export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const randInt = (a, b) => Math.floor(rand(a, b + 1));
export const pick = arr => arr[(Math.random() * arr.length) | 0];
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));
export function mulberry(a) {
  return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
const r2 = v => Math.round(v * 100) / 100, r3 = v => Math.round(v * 1000) / 1000, r4 = v => Math.round(v * 10000) / 10000;

export const WEAPONS = [
  { id: 'axe', name: 'AXE', ammo: null, use: 0, rate: 0.5, melee: true, dmg: [22, 30], sound: 'axe' },
  { id: 'shotgun', name: 'SHOTGUN', ammo: 'shells', use: 1, rate: 0.55, pellets: 6, dmg: [6, 9], spread: 0.045, sound: 'shotgun' },
  { id: 'sshotgun', name: 'SUPER SHOTGUN', ammo: 'shells', use: 2, rate: 0.95, pellets: 14, dmg: [6, 9], spread: 0.11, vspread: 0.05, sound: 'sshotgun' },
  { id: 'tommy', name: 'TOMMY GUN', ammo: 'bullets', use: 1, rate: 0.085, pellets: 1, dmg: [8, 11], spread: 0.03, sound: 'tommy' },
  { id: 'grenade', name: 'GRENADE LAUNCHER', ammo: 'rockets', use: 1, rate: 0.65, proj: 'grenade', sound: 'grenade' },
  { id: 'rocket', name: 'ROCKET LAUNCHER', ammo: 'rockets', use: 1, rate: 0.8, proj: 'rocket', sound: 'rocket' },
  { id: 'tesla', name: 'TESLA GUN', ammo: 'cells', use: 1, rate: 0.1, beam: true, dmg: [11, 14], range: 26, sound: 'tesla' },
];
export const MAXA = { shells: 100, bullets: 200, rockets: 50, cells: 150 };
export const AMMO = ['shells', 'bullets', 'rockets', 'cells'];
export const VERBS = { axe: 'CHOPPED UP', shotgun: 'PEPPERED', sshotgun: 'SPLATTERED', tommy: 'RIDDLED', grenade: 'FRAGGED', rocket: 'GIBBED', tesla: 'ELECTROCUTED', barrel: 'BLEW UP', tele: 'TELEFRAGGED' };
export const SKINS = ['cultist', 'marine', 'ranger', 'butcher'];
export const BOT_NAMES = [['MORDECAI', 'cultist'], ['RUSTJAW', 'butcher'], ['VESPER', 'ranger'], ['GRIMWALD', 'marine'], ['THE DEACON', 'cultist'], ['MOTHER BONE', 'butcher'], ['SALTMAN', 'ranger'], ['HOLLOW', 'marine']];
// bot difficulty: skill range, reaction-time and aim-wobble multipliers, and whether bots notice enemies behind them
export const DIFFICULTIES = [
  { name: 'EASY', skill: [0.05, 0.25], react: 1.8, aim: 1.8, eyesInBack: false },
  { name: 'NORMAL', skill: [0.35, 0.75], react: 1, aim: 1, eyesInBack: false },
  { name: 'HARD', skill: [0.7, 0.9], react: 0.7, aim: 0.6, eyesInBack: false },
  { name: 'NIGHTMARE', skill: [0.95, 1], react: 0.45, aim: 0.35, eyesInBack: true },
];
export const ITEM_DEFS = {
  'w:shotgun': { spr: ['pick_weapons', 0], w: 1, ammo: ['shells', 10] },
  'w:sshotgun': { spr: ['pick_weapons', 1], w: 2, ammo: ['shells', 10] },
  'w:tommy': { spr: ['pick_weapons', 2], w: 3, ammo: ['bullets', 40] },
  'w:grenade': { spr: ['pick_weapons', 3], w: 4, ammo: ['rockets', 5] },
  'w:rocket': { spr: ['pick_weapons', 4], w: 5, ammo: ['rockets', 5] },
  'w:tesla': { spr: ['pick_weapons', 5], w: 6, ammo: ['cells', 30] },
  hs: { spr: ['pick_items1', 0], respawn: 20, health: 15, max: 100, msg: 'BANDAGES' },
  hl: { spr: ['pick_items1', 1], respawn: 20, health: 25, max: 100, msg: 'MEDICAL KIT' },
  mega: { spr: ['pick_items1', 2], respawn: 35, health: 100, max: 200, msg: 'LIFE ESSENCE!', power: true },
  al: { spr: ['pick_items1', 3], respawn: 25, armor: 100, abs: 0.4, msg: 'LEATHER ARMOR' },
  ah: { spr: ['pick_items1', 4], respawn: 25, armor: 200, abs: 0.7, msg: 'IRON PLATE ARMOR' },
  'am:shells': { spr: ['pick_items2', 0], respawn: 20, ammo: ['shells', 20], msg: 'SHELLS' },
  'am:bullets': { spr: ['pick_items2', 1], respawn: 20, ammo: ['bullets', 50], msg: 'DRUM OF BULLETS' },
  'am:rockets': { spr: ['pick_items2', 2], respawn: 20, ammo: ['rockets', 5], msg: 'ROCKETS' },
  'am:cells': { spr: ['pick_items2', 3], respawn: 20, ammo: ['cells', 30], msg: 'BATTERY CELLS' },
  rage: { spr: ['pick_items2', 4], respawn: 60, rage: 30, msg: 'RAGE RUNE! TRIPLE DAMAGE', power: true },
};
export const ITEM_TYPES = Object.keys(ITEM_DEFS);
export const DECOR = {
  tree: { f: 0, r: 0.45 }, cross: { f: 1, r: 0.3 }, stone: { f: 2, r: 0.35 }, brazier: { f: 3, r: 0.35, light: true },
  pillar: { f: 4, r: 0.45 }, barrel: { f: 5, r: 0.4, barrel: true },
};

// ============================================================
//  MAP GRID (heights, liquids, teleporters) + NAV GRAPH
// ============================================================
export const M = { W: 0, H: 0, f: null, c: null, liq: null, tele: null, things: [], teles: [], spawns: [], def: null, adj: null };
export const idx = (x, z) => {
  const cx = Math.floor(x / CS), cz = Math.floor(z / CS);
  return cx < 0 || cz < 0 || cx >= M.W || cz >= M.H ? -1 : cz * M.W + cx;
};
export const cellCenter = i => [((i % M.W) + 0.5) * CS, (Math.floor(i / M.W) + 0.5) * CS];

// build the collision grid for a map; returns the legend entry of every cell (the client turns those into geometry)
export function loadGrid(def) {
  const b = new MapBuilder(def.w, def.h, def.fill);
  def.build(b);
  const W = M.W = def.w, H = M.H = def.h, N = W * H;
  M.def = def;
  M.f = new Float32Array(N); M.c = new Float32Array(N); M.liq = new Uint8Array(N); M.tele = new Int16Array(N).fill(-1);
  const cells = new Array(N);
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const ch = b.g[z][x], d = def.legend[ch];
    if (!d) throw new Error(`map ${def.name}: no legend for '${ch}'`);
    const i = z * W + x;
    cells[i] = d;
    M.f[i] = d.f; M.c[i] = d.c ?? Infinity;
    M.liq[i] = d.liq === 'lava' ? 1 : d.liq === 'slime' ? 2 : 0;
  }
  M.things = b.things;
  M.spawns = b.things.filter(t => t.type === 'spawn').map(t => ({ x: t.x * CS, z: t.z * CS }));
  M.teles = b.teles.map((t, k) => {
    M.tele[t.z * W + t.x] = k;
    return { x: (t.x + 0.5) * CS, z: (t.z + 0.5) * CS, tx: (t.tx + 0.5) * CS, tz: (t.tz + 0.5) * CS, yaw: t.yaw, from: t.z * W + t.x, to: t.tz * W + t.tx };
  });
  buildNav();
  return cells;
}

// items and decor of the loaded map, in thing order (server and clients index items/barrels the same way)
export function makeItem(type, x, z, o = {}) {
  return { type, d: ITEM_DEFS[type], x, z, y: groundUnder(x, z, 0.1, 50), active: true, respawnT: 0, temp: o.temp || 0, ammo: o.ammo || null, id: o.id || 0 };
}
export function makeDecor(kind, x, z) {
  const d = DECOR[kind];
  return { kind, x, z, r: d.r, f: d.f, y: groundUnder(x, z, 0.1, 50), barrel: !!d.barrel, light: !!d.light, hp: 25, dead: false, fuse: 0, by: null };
}
export function mapEntities() {
  const items = [], decor = [];
  for (const t of M.things) {
    const x = t.x * CS, z = t.z * CS;
    if (t.type.startsWith('d:')) decor.push(makeDecor(t.type.slice(2), x, z));
    else if (ITEM_DEFS[t.type]) items.push(makeItem(t.type, x, z));
  }
  return { items, decor };
}

// ---------- collision ----------
const blocks = (i, y) => i < 0 || M.f[i] > y + STEP || M.c[i] - Math.max(M.f[i], y) < PH;
function overlapped(x, z, r, fn) {
  const x0 = Math.floor((x - r) / CS), x1 = Math.floor((x + r) / CS), z0 = Math.floor((z - r) / CS), z1 = Math.floor((z + r) / CS);
  for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) {
    const nx = Math.max(cx * CS, Math.min(x, (cx + 1) * CS)), nz = Math.max(cz * CS, Math.min(z, (cz + 1) * CS));
    if ((x - nx) ** 2 + (z - nz) ** 2 >= r * r) continue;
    const i = cx < 0 || cz < 0 || cx >= M.W || cz >= M.H ? -1 : cz * M.W + cx;
    if (fn(i) === true) return true;
  }
  return false;
}
export const collides = (x, z, r, y) => overlapped(x, z, r, i => blocks(i, y));
export function moveCollide(p, dx, dz, r, y) {
  if (!Number.isFinite(dx) || !Number.isFinite(dz)) return false;
  const steps = Math.min(200, Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / (r * 0.7))));
  const sx = dx / steps, sz = dz / steps;
  let hitX = false, hitZ = false;
  for (let k = 0; k < steps; k++) {
    if (!collides(p.x + sx, p.z, r, y)) p.x += sx; else hitX = true;
    if (!collides(p.x, p.z + sz, r, y)) p.z += sz; else hitZ = true;
  }
  return hitX || hitZ;
}
export function groundUnder(x, z, r, y) {
  let g = -99;
  overlapped(x, z, r, i => { if (i >= 0 && M.f[i] <= y + STEP && M.f[i] > g) g = M.f[i]; });
  return g;
}
export function ceilOver(x, z, r) {
  let c = Infinity;
  overlapped(x, z, r, i => { if (i >= 0 && M.c[i] < c) c = M.c[i]; });
  return c;
}
// distance along a normalized 3D ray until it enters solid space (or maxT)
export function trace(ox, oy, oz, dx, dy, dz, maxT) {
  const solid = t => { const y = oy + dy * t, i = idx(ox + dx * t, oz + dz * t); return i < 0 || y < M.f[i] || y > M.c[i]; };
  if (solid(0)) return 0;
  for (let t = 0.1; t < maxT; t += 0.1) {
    if (solid(t)) {
      let lo = t - 0.1, hi = t;
      for (let k = 0; k < 5; k++) { const m = (lo + hi) / 2; if (solid(m)) hi = m; else lo = m; }
      return lo;
    }
  }
  return maxT;
}
export function los(ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, d = Math.hypot(dx, dy, dz) || 1e-4;
  return trace(ax, ay, az, dx / d, dy / d, dz / d, d) >= d - 0.05;
}

// ---------- navigation graph (8-connected cells, step/jump/drop edges, teleporters) ----------
function buildNav() {
  const { W, H, f: F, c: C } = M;
  const walk = i => i >= 0 && F[i] < 20 && C[i] - F[i] >= PH;
  const adj = M.adj = Array.from({ length: W * H }, () => []);
  for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) {
    const i = z * W + x;
    if (!walk(i)) continue;
    if (M.tele[i] >= 0) { adj[i].push({ j: M.teles[M.tele[i]].to, cost: 1, jump: false }); continue; }
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dz) continue;
      const j = (z + dz) * W + x + dx;
      if (!walk(j)) continue;
      const fi = F[i], fj = F[j], top = Math.max(fi, fj);
      if (dx && dz) {
        const a = z * W + x + dx, b = (z + dz) * W + x;
        if (!walk(a) || !walk(b) || F[a] > top + 0.05 || F[b] > top + 0.05) continue;
      }
      if (C[j] - top < PH) continue;
      const dh = fj - fi;
      let cost = dx && dz ? 1.414 : 1, jump = false;
      if (dh > 1.5) continue;
      if (dh > STEP) { jump = true; cost += 2; }
      if (M.liq[j] === 1) cost += 25; else if (M.liq[j] === 2) cost += 6;
      adj[i].push({ j, cost, jump });
    }
  }
}
// Dijkstra over the nav graph from cell s; returns { dist, prev, via } (via = edge used to enter each cell)
export function navSearch(s) {
  // Float64 on purpose: Float32 rounding made `nd < dist[j]` stay true forever for the same path, re-queuing cells endlessly
  const N = M.W * M.H, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), via = new Array(N);
  if (s < 0) return { dist, prev, via };
  const heap = [[0, s]];
  dist[s] = 0;
  for (let guard = N * 16; heap.length && guard > 0; guard--) {
    let top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      for (let k = 0; ;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
        if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
        if (m === k) break;
        [heap[k], heap[m]] = [heap[m], heap[k]]; k = m;
      }
    }
    const [d, i] = top;
    if (d > dist[i]) continue;
    for (const e of M.adj[i]) {
      const nd = d + e.cost;
      if (nd < dist[e.j]) {
        dist[e.j] = nd; prev[e.j] = i; via[e.j] = e;
        heap.push([nd, e.j]);
        for (let k = heap.length - 1; k > 0;) {
          const p = (k - 1) >> 1;
          if (heap[p][0] <= heap[k][0]) break;
          [heap[k], heap[p]] = [heap[p], heap[k]]; k = p;
        }
      }
    }
  }
  return { dist, prev, via };
}
export function navPath(search, goal) {
  const path = [];
  for (let i = goal; i >= 0 && search.prev[i] !== -2; i = search.prev[i]) {
    path.push(i);
    if (search.dist[i] === 0) break;
  }
  return path.reverse();
}

// ============================================================
//  ACTORS: shared movement + weapon timing (server, practice and client prediction all run these)
// ============================================================
export function makeActor(id, name, skin, bot, skill = 0.5) {
  const a = { id, name, skin, bot, skill, frags: 0, deaths: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, yaw: 0, pitch: 0,
    wish: { x: 0, z: 0, jump: false, fire: false }, ack: 0, budget: 0.2, lastInputT: 0, hist: [], respawnT: 0 };
  resetActor(a);
  a.dead = true;
  return a;
}
export function resetActor(a) {
  a.hp = 100; a.armor = 0; a.armorAbs = 0; a.rage = 0;
  a.owned = [true, true, false, false, false, false, false];
  a.ammo = { shells: 25, bullets: 0, rockets: 0, cells: 0 };
  a.weapon = 1; a.next = 1; a.switching = 0; a.cooldown = 0; a.shotN = 0;
  a.painT = 0; a.hazardT = 0; a.teleCd = 0; a.lastAttacker = null; a.lastHurtT = -9;
  a.dead = false; a.deathT = 0; a.gibbed = false; a.ai = null;
  a.vx = a.vy = a.vz = 0; a.og = true;
}
function pushFrom(a, x, z, r) {
  const dx = a.x - x, dz = a.z - z, d = Math.hypot(dx, dz), min = r + R_ACTOR;
  if (d < min) {
    if (d < 1e-4) moveCollide(a, 0.05, 0, R_ACTOR, a.y);
    else moveCollide(a, dx / d * (min - d), dz / d * (min - d), R_ACTOR, a.y);
  }
}
// One movement step. cmd (humans) = { f, s, jump, yaw, pitch }; bots set a.wish themselves and pass cmd = null.
// `others` pushes the actor out of other actors (bots only, so human prediction never depends on remote positions).
// Returns flags: 1 jumped, 2 landed hard, 4 teleported (a.teleFrom holds the departure point).
export function moveActor(a, cmd, dt, decor, others) {
  if (cmd) {
    a.yaw = +cmd.yaw || 0; a.pitch = clamp(+cmd.pitch || 0, -1.45, 1.45);
    const f = clamp(+cmd.f || 0, -1, 1), s = clamp(+cmd.s || 0, -1, 1), sy = Math.sin(a.yaw), cy = Math.cos(a.yaw);
    const wx = -sy * f + cy * s, wz = -cy * f - sy * s, l = Math.hypot(wx, wz);
    a.wish.x = l ? wx / l : 0; a.wish.z = l ? wz / l : 0; a.wish.jump = !!cmd.jump;
  }
  if (a.dead) {
    a.vy -= 18 * dt; a.y += a.vy * dt;
    moveCollide(a, a.vx * dt, a.vz * dt, 0.3, a.y);
    const k = Math.exp(-dt * 3); a.vx *= k; a.vz *= k;
    const g = groundUnder(a.x, a.z, 0.3, a.y);
    if (a.y <= g) { a.y = g; a.vy = 0; }
    return 0;
  }
  let ev = 0;
  const i0 = idx(a.x, a.z), inLiq = i0 >= 0 && M.liq[i0] && a.y < M.f[i0] + 0.3;
  const speed = (a.bot ? 7.0 : 7.6) * (inLiq ? 0.6 : 1);
  const k = 1 - Math.exp(-dt * (a.og ? 12 : 2.2));
  a.vx += (a.wish.x * speed - a.vx) * k;
  a.vz += (a.wish.z * speed - a.vz) * k;
  moveCollide(a, a.vx * dt, a.vz * dt, R_ACTOR, a.y);
  for (const o of decor) if (!o.dead) pushFrom(a, o.x, o.z, o.r);
  if (others) for (const o of others) if (o !== a && !o.dead && Math.abs(o.y - a.y) < PH) pushFrom(a, o.x, o.z, R_ACTOR);
  if (a.wish.jump && a.og) { a.vy = 6.3; a.og = false; ev |= 1; }
  a.vy -= 18 * dt;
  a.y += a.vy * dt;
  const g = groundUnder(a.x, a.z, R_ACTOR, a.y);
  if (a.y <= g) {
    if (!a.og && a.vy < -8) ev |= 2;
    a.y = g; a.vy = 0; a.og = true;
  } else if (a.og && a.y - g < STEP + 0.05 && a.vy <= 0) a.y = g;
  else a.og = false;
  const c = ceilOver(a.x, a.z, R_ACTOR);
  if (a.y + PH > c) { a.y = c - PH; if (a.vy > 0) a.vy = 0; }
  a.teleCd = Math.max(0, a.teleCd - dt);
  const i = idx(a.x, a.z);
  if (i >= 0 && M.tele[i] >= 0 && a.teleCd <= 0 && a.y < M.f[i] + 0.5) {
    const t = M.teles[M.tele[i]];
    a.teleFrom = [a.x, a.y, a.z];
    a.x = t.tx; a.z = t.tz; a.y = groundUnder(t.tx, t.tz, 0.1, 50);
    a.yaw = t.yaw; a.vx = a.vz = a.vy = 0; a.teleCd = 1;
    ev |= 4;
  }
  return ev;
}

export const hasAmmo = (a, i) => a.owned[i] && (!WEAPONS[i].ammo || a.ammo[WEAPONS[i].ammo] >= WEAPONS[i].use);
export function switchWeapon(a, i) {
  if (!a.owned[i] || (i === a.weapon && a.switching <= 0) || (i === a.next && a.switching > 0)) return false;
  a.next = i; a.switching = 0.3;
  return true;
}
export function bestWeapon(a) {
  for (const i of [5, 6, 2, 3, 1, 4, 0]) if (hasAmmo(a, i)) return i;
  return 0;
}
// weapon timing for one step; returns 1 when a shot goes off (ammo already spent), 2 for a dry-fire click, else 0
export function weaponTick(a, dt, fire, sw) {
  if (sw >= 0 && sw < 7) switchWeapon(a, sw);
  a.cooldown = Math.max(0, a.cooldown - dt);
  if (a.switching > 0) {
    const prev = a.switching;
    a.switching -= dt;
    if (prev > 0.15 && a.switching <= 0.15) a.weapon = a.next;
    if (a.switching < 0) a.switching = 0;
  }
  if (!fire || a.dead || a.cooldown > 0 || a.switching > 0) return 0;
  const w = WEAPONS[a.weapon];
  if (!hasAmmo(a, a.weapon)) {
    const b = bestWeapon(a);
    a.cooldown = 0.3;
    if (b !== a.weapon) { switchWeapon(a, b); return 0; }
    return 2;
  }
  if (w.ammo) a.ammo[w.ammo] -= w.use;
  a.cooldown = w.rate;
  a.shotN++;
  return 1;
}

// ---------- aiming / hitscan (shared so clients can predict their own tracers exactly) ----------
export function aimRay(a) {
  const cp = Math.cos(a.pitch);
  return { o: [a.x, a.y + EYE, a.z], d: [-Math.sin(a.yaw) * cp, Math.sin(a.pitch), -Math.cos(a.yaw) * cp], r: [Math.cos(a.yaw), 0, -Math.sin(a.yaw)],
    u: [Math.sin(a.yaw) * Math.sin(a.pitch), Math.cos(a.pitch), Math.cos(a.yaw) * Math.sin(a.pitch)] };
}
// pellet spread for a human shot is seeded by the input seq, so client prediction and server agree on every pellet
export const shotRng = seq => mulberry((seq | 0) * 2654435761);
export function pelletDirs(R, w, rng) {
  const out = [];
  for (let p = 0; p < w.pellets; p++) {
    const sx = (rng() * 2 - 1) * w.spread, sy = (rng() * 2 - 1) * (w.vspread ?? w.spread);
    const d = [R.d[0] + R.r[0] * sx + R.u[0] * sy, R.d[1] + R.u[1] * sy, R.d[2] + R.r[2] * sx + R.u[2] * sy];
    const l = Math.hypot(d[0], d[1], d[2]);
    out.push([d[0] / l, d[1] / l, d[2] / l]);
  }
  return out;
}
function rayCyl(o, d, cx, cz, r, y0, y1) {
  const ox = o[0] - cx, oz = o[2] - cz, aa = d[0] * d[0] + d[2] * d[2];
  if (aa < 1e-9) return -1;
  const b = 2 * (ox * d[0] + oz * d[2]), c = ox * ox + oz * oz - r * r, disc = b * b - 4 * aa * c;
  if (disc < 0) return -1;
  const s = Math.sqrt(disc);
  let t = (-b - s) / (2 * aa);
  if (t < 0) t = (-b + s) / (2 * aa);
  if (t < 0) return -1;
  const y = o[1] + d[1] * t;
  return y >= y0 && y <= y1 ? t : -1;
}
// nearest target ({x,y,z} cylinders) or live barrel along a ray, limited by world geometry. kind: 1 flesh, 2 barrel
export function hitscan(o, d, maxT, targets, decor) {
  let best = trace(o[0], o[1], o[2], d[0], d[1], d[2], maxT), target = null, kind = 0;
  for (const tg of targets) {
    const t = rayCyl(o, d, tg.x, tg.z, R_ACTOR + 0.05, tg.y, tg.y + PH);
    if (t > 0 && t < best) { best = t; target = tg; kind = 1; }
  }
  for (const b of decor) {
    if (!b.barrel || b.dead) continue;
    const t = rayCyl(o, d, b.x, b.z, 0.4, b.y, b.y + 1.1);
    if (t > 0 && t < best) { best = t; target = b; kind = 2; }
  }
  return { t: best, target, kind, wall: best < maxT && !target };
}
// projectile motion; hit(p) reports actor/barrel contact (server only). Returns 0 flying, 1 explode, 2 fizzle; sets p.bounced
export function projMove(p, dt, hit) {
  p.age += dt; p.life -= dt; p.bounced = false;
  if (p.life <= 0) return p.kind === 'grenade' ? 1 : 2;
  if (p.kind === 'grenade') p.vy -= 15 * dt;
  const steps = Math.min(60, Math.max(1, Math.ceil(Math.hypot(p.vx, p.vy, p.vz) * dt / 0.2)));
  for (let s = 0; s < steps; s++) {
    const px = p.x, py = p.y, pz = p.z, h = dt / steps;
    p.x += p.vx * h; p.y += p.vy * h; p.z += p.vz * h;
    const i = idx(p.x, p.z);
    if (i < 0 || p.y < M.f[i] || p.y > M.c[i]) {
      if (p.kind === 'rocket') { p.x = px; p.y = py; p.z = pz; return 1; }
      // grenade bounce: figure out which axis we crossed
      const iy = idx(px, pz);
      if (iy >= 0 && (py + p.vy * h < M.f[iy] || py + p.vy * h > M.c[iy])) { p.vy *= -0.45; p.vx *= 0.7; p.vz *= 0.7; }
      else {
        const ix = idx(p.x, pz);
        if (ix < 0 || py < M.f[ix] || py > M.c[ix]) p.vx *= -0.6; else p.vz *= -0.6;
      }
      p.x = px; p.y = py; p.z = pz;
      if (Math.hypot(p.vx, p.vy, p.vz) > 2) p.bounced = true;
      continue;
    }
    if (hit && hit(p)) return 1;
  }
  return 0;
}

// ============================================================
//  SIM: authoritative world (room logic on the server, LocalConn offline)
// ============================================================
// Events (this.ev, flushed by the host each tick) are short arrays:
//   f shot [aid,w] · h impacts [aid,w,[x,y,z,kind,...]] (kind 0 wall, 1 flesh, 2 barrel, 3 nothing) · p projectile [pid,kind,oid,x,y,z,vx,vy,vz]
//   x projectile gone [pid] · b boom [x,y,z] · k kill [victim,attacker,weapon,gib,x,y,z] · n pain [aid] · z sizzle [x,z]
//   u pickup [aid,sound,msg] · t teleport fx [x,y,z] · r item respawn [x,y,z] · j announcement [text] · w win [aid] · M map [mi] · H hit confirm [aid]
export class Sim {
  constructor(o = {}) {
    this.o = { slots: SLOTS, diff: 1, rotate: true, ...o };
    this.diff = DIFFICULTIES[this.o.diff] || DIFFICULTIES[1];
    this.t = 0; this.actors = []; this.byId = {}; this.items = []; this.decor = []; this.drops = []; this.projs = [];
    this.ev = []; this.nextId = 1; this.skinN = 1; this.mi = -1;
    this.match = { over: false, winner: null, overT: 0 };
  }
  e(...a) { this.ev.push(a); }

  // ---------- roster ----------
  addHuman(id, name) {
    if (this.byId[id]) return this.byId[id];
    if (this.actors.length >= this.o.slots) {
      const bot = this.kickCandidate();
      if (bot) { this.removeActor(bot.id); this.e('j', `${bot.name} WAS KICKED TO MAKE ROOM`); }
    }
    const a = makeActor(id, cleanName(name), SKINS[this.skinN++ % SKINS.length], false);
    a.lastInputT = this.t;
    this.actors.push(a); this.byId[id] = a;
    if (this.mi >= 0) this.respawn(a);
    return a;
  }
  // mixed rooms keep about 60% of the bots EASY and the rest NORMAL
  easyTarget(n) { return Math.ceil(n * EASY_SHARE); }
  kickCandidate() {
    const bots = this.actors.filter(b => b.bot).sort((p, q) => p.frags - q.frags);
    if (!this.o.mix || bots.length < 2) return bots[0];
    const easy = bots.filter(b => b.diffI === 0).length, kickEasy = easy > this.easyTarget(bots.length - 1);
    return bots.find(b => (b.diffI === 0) === kickEasy) || bots[0];
  }
  addBot() {
    const used = new Set(this.actors.map(a => a.name));
    const ni = Math.max(0, BOT_NAMES.findIndex(([n]) => !used.has(n)));
    const [n, s] = BOT_NAMES[ni];
    let D = this.diff, k;
    if (this.o.mix) {
      const bots = this.actors.filter(b => b.bot), easy = bots.filter(b => b.diffI === 0).length;
      D = DIFFICULTIES[easy < this.easyTarget(bots.length + 1) ? 0 : 1];
      k = Math.random();
    } else k = clamp(ni / Math.max(1, this.o.slots - 2), 0, 1);  // spread skills across the range by roster position
    const a = makeActor('b' + this.nextId++, n, s, true, D.skill[0] + (D.skill[1] - D.skill[0]) * k);
    a.diff = D; a.diffI = DIFFICULTIES.indexOf(D);
    this.actors.push(a); this.byId[a.id] = a;
    if (this.mi >= 0) this.respawn(a);
    return a;
  }
  fillBots(announce) {
    while (this.actors.length < this.o.slots) { const b = this.addBot(); if (announce) this.e('j', `${b.name} JOINED THE FIGHT`); }
  }
  removeActor(id) {
    const a = this.byId[id];
    if (!a) return;
    this.actors.splice(this.actors.indexOf(a), 1);
    delete this.byId[id];
    for (const o of this.actors) {
      if (o.lastAttacker === a) o.lastAttacker = null;
      if (o.ai && o.ai.target === a) o.ai.target = null;
    }
  }
  setName(id, name) {
    const a = this.byId[id];
    if (!a || a.bot) return;
    const n = cleanName(name), first = !a.named;
    a.named = true;
    if (n !== a.name || first) { a.name = n; if (first) this.e('j', `${n} ENTERED THE ARENA`); }
  }
  humans() { return this.actors.filter(a => !a.bot).length; }

  // ---------- map / match ----------
  startMap(mi) {
    this.mi = mi;
    loadGrid(MAPS[mi]);
    const ents = mapEntities();
    this.items = ents.items; this.decor = ents.decor; this.drops = []; this.projs = [];
    this.match = { over: false, winner: null, overT: 0 };
    for (const a of this.actors) { a.frags = 0; a.deaths = 0; a.dead = true; a.hist = []; }
    for (const a of this.actors) this.respawn(a);
    this.e('M', mi);
  }
  chooseSpawn(a) {
    const scored = M.spawns.map(s => {
      let d = 1e9;
      for (const o of this.actors) if (o !== a && !o.dead) d = Math.min(d, Math.hypot(o.x - s.x, o.z - s.z));
      return { s, d };
    }).sort((p, q) => q.d - p.d);
    return pick(scored.slice(0, 3)).s;
  }
  respawn(a) {
    resetActor(a);
    const s = this.chooseSpawn(a);
    a.x = s.x; a.z = s.z; a.y = groundUnder(s.x, s.z, 0.1, 50);
    a.yaw = rand(0, Math.PI * 2); a.pitch = 0; a.hist = [];
    this.telefrag(a, s.x, s.z);
    this.e('t', r2(s.x), r2(a.y), r2(s.z));
  }
  requestRespawn(id) {
    const a = this.byId[id];
    if (a && a.dead && a.deathT > 1 && !this.match.over) this.respawn(a);
  }
  telefrag(a, x, z) {
    for (const o of this.actors) if (o !== a && !o.dead && Math.hypot(o.x - x, o.z - z) < 1) { o.hp = -50; this.kill(o, a, 'tele'); }
  }
  endMatch(winner) {
    this.match.over = true; this.match.winner = winner; this.match.overT = 0;
    this.e('w', winner.id);
  }
  nextMap() { this.startMap((this.mi + 1) % MAPS.length); }

  // ---------- damage ----------
  damage(t, amount, attacker, weapon, kx = 0, kz = 0) {
    if (t.dead || this.match.over) return;
    if (attacker && attacker.rage > 0) amount *= 3;
    amount = Math.round(amount);
    const save = Math.min(t.armor, Math.ceil(amount * t.armorAbs));
    t.armor -= save;
    t.hp -= amount - save;
    t.vx += kx; t.vz += kz;
    if (attacker && attacker !== t) { t.lastAttacker = attacker; t.lastHurtT = this.t; this.e('H', attacker.id); }
    if (t.hp <= 0) this.kill(t, attacker, weapon);
    else if (t.painT < -0.3) { t.painT = 0.18; this.e('n', t.id); }
  }
  kill(t, attacker, weapon) {
    t.dead = true; t.deathT = 0; t.deaths++; t.respawnT = t.bot ? rand(1.5, 2.5) : 5;
    t.gibbed = t.hp < -40;
    t.vy = Math.max(t.vy, 2);
    // drop the weapon in hand (with some of its ammo)
    const w = WEAPONS[t.weapon];
    if (t.weapon >= 2) this.drops.push(makeItem('w:' + w.id, t.x, t.z, { temp: 25, id: this.nextId++, ammo: [w.ammo, Math.max(5, Math.floor(t.ammo[w.ammo] / 2))] }));
    const self = !attacker || attacker === t;
    if (self) t.frags--;
    else attacker.frags++;
    this.e('k', t.id, self ? '' : attacker.id, weapon, t.gibbed ? 1 : 0, r2(t.x), r2(t.y), r2(t.z));
    if (!self && attacker.frags >= FRAG_LIMIT) this.endMatch(attacker);
  }
  hurt(tg, dmg, a, weapon, d, kb = 0.08) {
    if (tg.actor) this.damage(tg.actor, dmg, a, weapon, d[0] * dmg * kb, d[2] * dmg * kb);
    else this.hitBarrel(tg, dmg, a);
  }
  hitBarrel(b, dmg, by) { if (!b.barrel || b.dead || b.fuse > 0) return; b.hp -= dmg; if (b.hp <= 0) { b.fuse = rand(0.1, 0.25); b.by = by; } }
  explode(x, y, z, R, dmg, owner, weapon) {
    this.e('b', r2(x), r2(y), r2(z));
    for (const a of this.actors) {
      if (a.dead) continue;
      const cy = a.y + 0.9, d = Math.max(0, Math.hypot(a.x - x, cy - y, a.z - z) - R_ACTOR);
      if (d >= R || !los(x, y + 0.1, z, a.x, cy, a.z)) continue;
      const f = 1 - d / R, dl = Math.hypot(a.x - x, a.z - z) || 1, kick = f * 13;
      a.vx += (a.x - x) / dl * kick; a.vz += (a.z - z) / dl * kick;
      a.vy += Math.max(0.3, (cy - y) / (d + R_ACTOR)) * f * 9; a.og = false;
      this.damage(a, dmg * f * (a === owner ? 0.5 : 1), owner, weapon);
    }
    for (const b of this.decor) if (b.barrel && !b.dead && Math.hypot(b.x - x, b.z - z) < R) this.hitBarrel(b, dmg * (1 - Math.hypot(b.x - x, b.z - z) / R), owner);
  }

  // ---------- weapons ----------
  // other live actors as hit cylinders, rewound to time rt (lag compensation) using the per-tick position history
  targetsAt(shooter, rt) {
    const out = [];
    for (const a of this.actors) {
      if (a === shooter || a.dead) continue;
      let x = a.x, y = a.y, z = a.z;
      const H = a.hist;
      if (rt < this.t - 1e-4 && H.length) {
        if (rt <= H[0][0]) { x = H[0][1]; y = H[0][2]; z = H[0][3]; }
        else for (let i = H.length - 1; i >= 0; i--) {
          if (H[i][0] <= rt) {
            const A = H[i], B = H[i + 1] || [this.t, a.x, a.y, a.z], k = B[0] > A[0] ? (rt - A[0]) / (B[0] - A[0]) : 0;
            x = A[1] + (B[1] - A[1]) * k; y = A[2] + (B[2] - A[2]) * k; z = A[3] + (B[3] - A[3]) * k;
            break;
          }
        }
      }
      out.push({ x, y, z, actor: a });
    }
    return out;
  }
  fireShot(a, cmd) {
    const w = WEAPONS[a.weapon], R = aimRay(a);
    this.e('f', a.id, a.weapon);
    if (w.proj) {
      const o = [R.o[0] + R.d[0] * 0.6 - R.u[0] * 0.2, R.o[1] + R.d[1] * 0.6 - 0.2, R.o[2] + R.d[2] * 0.6 - R.u[2] * 0.2];
      const v = w.proj === 'rocket' ? [R.d[0] * 26, R.d[1] * 26, R.d[2] * 26] : [R.d[0] * 17, R.d[1] * 17 + 3, R.d[2] * 17];
      const p = { id: this.nextId++, kind: w.proj, owner: a, x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2], life: w.proj === 'rocket' ? 6 : 2.3, age: 0 };
      this.projs.push(p);
      this.e('p', p.id, w.proj === 'rocket' ? 0 : 1, a.id, r3(p.x), r3(p.y), r3(p.z), r3(p.vx), r3(p.vy), r3(p.vz));
      return;
    }
    // lag compensation: humans hit what they saw, so targets are rewound to the shooter's render time
    const rt = cmd && Number.isFinite(+cmd.rt) ? clamp(+cmd.rt, this.t - LAGCOMP_MAX, this.t) : this.t;
    const targets = this.targetsAt(a, rt);
    if (w.melee) {
      const h = hitscan(R.o, R.d, 1.9, targets, this.decor);
      if (h.target || h.wall) this.e('h', a.id, 0, [r2(R.o[0] + R.d[0] * h.t), r2(R.o[1] + R.d[1] * h.t), r2(R.o[2] + R.d[2] * h.t), h.target ? h.kind : 0]);
      if (h.target) this.hurt(h.target, randInt(...w.dmg), a, 'axe', R.d);
      return;
    }
    if (w.beam) {
      const h = hitscan(R.o, R.d, w.range, targets, this.decor);
      if (h.target) this.hurt(h.target, randInt(...w.dmg), a, 'tesla', R.d, 0.5);
      return;
    }
    const dirs = pelletDirs(R, w, cmd ? shotRng(cmd.seq) : Math.random), hits = new Map(), imp = [];
    for (const d of dirs) {
      const h = hitscan(R.o, d, 120, targets, this.decor);
      imp.push(r2(R.o[0] + d[0] * h.t), r2(R.o[1] + d[1] * h.t), r2(R.o[2] + d[2] * h.t), h.target ? h.kind : h.wall ? 0 : 3);
      if (h.target) hits.set(h.target, (hits.get(h.target) || 0) + randInt(...w.dmg));
    }
    this.e('h', a.id, a.weapon, imp);
    hits.forEach((dmg, tg) => this.hurt(tg, dmg, a, w.id, R.d, 0.04));
  }
  projHit(p) {
    for (const a of this.actors) {
      if (a.dead || (a === p.owner && p.age < 0.25)) continue;
      if (Math.hypot(p.x - a.x, p.z - a.z) < R_ACTOR + 0.2 && p.y > a.y && p.y < a.y + PH) {
        if (p.kind === 'rocket') this.damage(a, randInt(70, 90), p.owner, 'rocket', p.vx * 0.1, p.vz * 0.1);
        return true;
      }
    }
    for (const b of this.decor) if (b.barrel && !b.dead && Math.hypot(p.x - b.x, p.z - b.z) < 0.5 && p.y < b.y + 1.1) return true;
    return false;
  }

  // ---------- items ----------
  take(a, it) {
    const d = it.d;
    if (d.w !== undefined) {
      const [k, n] = it.ammo || d.ammo, had = a.owned[d.w];
      if (had && a.ammo[k] >= MAXA[k]) return null;
      a.owned[d.w] = true; a.ammo[k] = Math.min(MAXA[k], a.ammo[k] + n);
      if (!had) switchWeapon(a, d.w);
      return ['weapon', had ? `${WEAPONS[d.w].name} AMMO` : `YOU GOT THE ${WEAPONS[d.w].name}`];
    }
    if (d.health) {
      if (a.hp >= d.max) return null;
      a.hp = Math.min(d.max, a.hp + d.health);
      return [d.power ? 'power' : 'item', d.msg];
    }
    if (d.armor) {
      if (a.armor * a.armorAbs >= d.armor * d.abs) return null;
      a.armor = d.armor; a.armorAbs = d.abs;
      return ['armor', d.msg];
    }
    if (d.ammo) {
      const [k, n] = d.ammo;
      if (a.ammo[k] >= MAXA[k]) return null;
      a.ammo[k] = Math.min(MAXA[k], a.ammo[k] + n);
      return ['item', d.msg];
    }
    if (d.rage) { a.rage = d.rage; return ['power', d.msg]; }
    return null;
  }
  touch(it) {
    for (const a of this.actors) {
      if (a.dead || Math.hypot(a.x - it.x, a.z - it.z) > 0.95 || Math.abs(a.y - it.y) > 1.2) continue;
      const r = this.take(a, it);
      if (r) { this.e('u', a.id, r[0], r[1]); return true; }
    }
    return false;
  }

  // ---------- per-step ----------
  afterMove(a, flags) {
    if (flags & 4) {
      this.e('t', r2(a.teleFrom[0]), r2(a.teleFrom[1]), r2(a.teleFrom[2]));
      this.telefrag(a, a.x, a.z);
      this.e('t', r2(a.x), r2(a.y), r2(a.z));
      if (a.ai) a.ai.replanT = 0;
    }
  }
  // one input command from a human: movement + weapons. dt is clamped by a per-player time budget (no speed hacks)
  input(id, cmd) {
    const a = this.byId[id];
    if (!a || a.bot || !cmd) return;
    const seq = cmd.seq | 0;
    if (seq <= a.ack) return;
    a.ack = seq;
    a.lastInputT = this.t;
    const dt = Math.min(clamp(+cmd.dt || 0, 0, 0.05), a.budget);
    if (dt <= 0.001 || a.dead) return;
    a.budget -= dt;
    this.afterMove(a, moveActor(a, cmd, dt, this.decor, null));
    if (!this.match.over && !a.dead) {
      const sw = Number.isInteger(cmd.w) ? cmd.w : -1;
      if (weaponTick(a, dt, !!cmd.fire, sw) === 1) this.fireShot(a, cmd);
    }
  }
  tick(dt) {
    this.t += dt;
    // input budget refills with real elapsed time when the host gives a clock (late server ticks must not clamp inputs)
    const wall = this.o.now ? this.o.now() : null, refill = wall !== null && this.wall !== undefined ? clamp(wall - this.wall, 0, 0.5) : dt;
    this.wall = wall ?? undefined;
    const m = this.match;
    if (m.over) {
      m.overT += dt;
      if (this.o.rotate && m.overT >= NEXT_MAP_DELAY) this.nextMap();
    }
    for (const a of this.actors) {
      if (a.dead) {
        a.deathT += dt;
        a.respawnT -= dt;
        if (a.respawnT <= 0 && !this.match.over) { this.respawn(a); continue; }
      } else if (a.bot) botThink(this, a, dt);
      if (a.bot || a.dead) this.afterMove(a, moveActor(a, null, dt, this.decor, a.bot ? this.actors : null));
      else if (this.t - a.lastInputT > 0.75) {
        // no inputs arriving (tab hidden / stalled): keep gravity and friction going
        a.wish.x = a.wish.z = 0; a.wish.jump = false;
        this.afterMove(a, moveActor(a, null, dt, this.decor, null));
      }
      if (!a.bot) a.budget = Math.min(INPUT_BUDGET, a.budget + refill);
      if (a.dead) continue;
      const i = idx(a.x, a.z);
      if (i >= 0 && M.liq[i] && a.y < M.f[i] + 0.3) {
        a.hazardT -= dt;
        if (a.hazardT <= 0) { a.hazardT = 0.5; this.e('z', r2(a.x), r2(a.z)); this.damage(a, M.liq[i] === 1 ? 22 : 8, null, M.liq[i] === 1 ? 'lava' : 'slime'); }
      }
      if (a.hp > 100) a.hp = Math.max(100, a.hp - dt);
      a.rage = Math.max(0, a.rage - dt);
      a.painT -= dt;
      if (a.bot && !a.dead && !this.match.over && weaponTick(a, dt, a.wish.fire, -1) === 1) this.fireShot(a, null);
    }
    for (const it of this.items) {
      if (!it.active) {
        it.respawnT -= dt;
        if (it.respawnT <= 0) { it.active = true; this.e('r', r2(it.x), r2(it.y), r2(it.z)); }
      } else if (this.touch(it)) { it.active = false; it.respawnT = it.d.respawn || 20; }
    }
    this.drops = this.drops.filter(it => (it.temp -= dt) > 0 && !this.touch(it));
    for (const b of this.decor) {
      if (b.fuse > 0 && (b.fuse -= dt) <= 0) { b.dead = true; this.explode(b.x, b.y + 0.6, b.z, 4.5, 110, b.by, 'barrel'); }
    }
    this.projs = this.projs.filter(p => {
      const r = projMove(p, dt, q => this.projHit(q));
      if (!r) return true;
      this.e('x', p.id);
      if (r === 1) this.explode(p.x, p.y, p.z, 4.2, 120, p.owner, p.kind);
      return false;
    });
    // position history for lag compensation
    for (const a of this.actors) {
      a.hist.push([this.t, a.x, a.y, a.z]);
      while (a.hist.length > 2 && a.hist[0][0] < this.t - HIST_LEN) a.hist.shift();
    }
  }

  // ---------- replication: mirror the working copy into plain-JSON room state ----------
  mirror(state) {
    const S = state.shared, E = state.entities;
    if (!E.players) E.players = {};
    if (!E.bots) E.bots = {};
    const set = (o, k, v) => { if (o[k] !== v) o[k] = v; };
    set(S, 'st', r3(this.t)); set(S, 'mi', this.mi); set(S, 'mo', this.match.over ? 1 : 0);
    set(S, 'win', this.match.winner ? this.match.winner.name : '');
    set(S, 'nt', this.match.over && this.o.rotate ? Math.max(0, Math.ceil(NEXT_MAP_DELAY - this.match.overT)) : 0);
    // masks carry a letter prefix: the room state turns all-digit strings into numbers
    set(S, 'it', 'm' + this.items.map(it => it.active ? '1' : '0').join(''));
    set(S, 'br', 'm' + this.decor.filter(b => b.barrel).map(b => b.dead ? '0' : '1').join(''));
    set(S, 'dw', JSON.stringify(this.drops.map(it => [it.id, ITEM_TYPES.indexOf(it.type), r2(it.x), r2(it.z)])));
    for (const a of this.actors) {
      const coll = a.bot ? E.bots : E.players, e = coll[a.id] || (coll[a.id] = {});
      set(e, 'n', a.name); set(e, 'k', SKINS.indexOf(a.skin));
      set(e, 'x', r3(a.x)); set(e, 'y', r3(a.y)); set(e, 'z', r3(a.z));
      set(e, 'vx', r3(a.vx)); set(e, 'vy', r3(a.vy)); set(e, 'vz', r3(a.vz));
      set(e, 'yw', r3(a.yaw)); set(e, 'pt', r3(a.pitch)); set(e, 'g', a.og ? 1 : 0); set(e, 'tc', r4(a.teleCd));
      set(e, 'hp', Math.ceil(a.hp)); set(e, 'ar', a.armor); set(e, 'aa', a.armorAbs); set(e, 'rg', Math.ceil(a.rage));
      set(e, 'w', a.weapon); set(e, 'nx', a.next); set(e, 'sw', r4(a.switching)); set(e, 'cd', r4(a.cooldown));
      set(e, 'ow', a.owned.reduce((m, o, i) => m | (o ? 1 << i : 0), 0));
      set(e, 'am', AMMO.map(k => a.ammo[k]).join(','));
      set(e, 'f', a.frags); set(e, 'd', a.deaths); set(e, 'dd', a.dead ? 1 : 0); set(e, 'gb', a.gibbed ? 1 : 0);
      if (!a.bot) set(e, 'ack', a.ack);
    }
    for (const coll of [E.players, E.bots]) for (const id of Object.keys(coll)) if (!this.byId[id]) delete coll[id];
  }
}
function cleanName(n) {
  const s = String(n || '').toUpperCase().replace(/[^A-Z0-9 .!?'-]/g, '').trim().slice(0, 12);
  return s || 'PLAYER';
}

// ============================================================
//  BOTS: perceive -> pick goal (items/enemies) -> path over nav graph -> strafe, aim, fire
// ============================================================
const WANT_WEAPON = { 2: 60, 3: 45, 4: 40, 5: 90, 6: 75 };
const PREF_RANGE = [1.2, 7, 4, 11, 10, 12, 9];
const PROJ_SPEED = { 4: 17, 5: 26 };

function itemDesire(b, it) {
  const d = it.d;
  if (d.w !== undefined) {
    if (!b.owned[d.w]) return WANT_WEAPON[d.w] || 20;
    const [k] = d.ammo;
    return b.ammo[k] < MAXA[k] * 0.3 ? 15 : 0;
  }
  if (d.health) return b.hp >= d.max ? 0 : d.max > 100 ? 65 + (100 - Math.min(100, b.hp)) * 0.4 : (100 - b.hp) * 0.9;
  if (d.armor) return b.armor * b.armorAbs >= d.armor * d.abs ? 0 : d.abs > 0.5 ? 60 : 30 + (100 - b.armor) * 0.15;
  if (d.ammo) { const [k] = d.ammo; const uses = WEAPONS.some((w, i) => b.owned[i] && w.ammo === k); return uses && b.ammo[k] < MAXA[k] * 0.5 ? 25 : 3; }
  if (d.rage) return 85;
  return 0;
}
function pickWeapon(b, dist) {
  let best = 0, bs = -1;
  const sc = [dist < 1.8 ? 60 : 1, 30 - dist * 0.5, dist < 7 ? 75 : 45 - dist, dist > 5 ? 55 : 45, dist > 4 && dist < 14 ? 50 : 8, dist > 3.5 ? 85 : 4, dist < 22 ? 78 : 5];
  for (let i = 0; i < WEAPONS.length; i++) if (hasAmmo(b, i) && sc[i] > bs) { bs = sc[i]; best = i; }
  if (best !== b.weapon && b.switching <= 0) switchWeapon(b, best);
}
function replan(sim, b, B) {
  const me = idx(b.x, b.z);
  const S = navSearch(me);
  let best = null, bestScore = 4;
  for (const it of sim.items.concat(sim.drops)) {
    const i = idx(it.x, it.z), dist = S.dist[i];
    if (!isFinite(dist)) continue;
    const eta = dist * CS / 7;
    if (!it.active && it.respawnT > eta + 1) continue;
    const s = itemDesire(b, it) * B.taste / (1 + dist * 0.07);
    if (s > bestScore) { bestScore = s; best = i; }
  }
  if (best === null) {
    if (B.roam === null || B.roam === me || !isFinite(S.dist[B.roam])) {
      const sp = M.spawns[(Math.random() * M.spawns.length) | 0];
      B.roam = idx(sp.x, sp.z);
    }
    best = B.roam;
  }
  B.goal = best;
  B.search = S;
  B.path = isFinite(S.dist[best]) ? navPath(S, best) : [];
  B.pi = 1;
  B.replanT = rand(0.7, 1.2);
}
function perceive(sim, b, B) {
  let best = null, bd = 1e9;
  const fx = -Math.sin(b.yaw), fz = -Math.cos(b.yaw);
  for (const a of sim.actors) {
    if (a === b || a.dead) continue;
    const dx = a.x - b.x, dz = a.z - b.z, d = Math.hypot(dx, dz);
    if (d > 60) continue;
    const facing = (fx * dx + fz * dz) / (d || 1);
    const revenge = a === b.lastAttacker && sim.t - b.lastHurtT < 3;
    if (facing < -0.25 && !revenge && d > 4 && !b.diff.eyesInBack) continue;
    if (!los(b.x, b.y + EYE, b.z, a.x, a.y + 1.2, a.z)) continue;
    const score = d - (revenge ? 15 : 0) - (a.rage > 0 ? 5 : 0);
    if (score < bd) { bd = score; best = a; }
  }
  if (best !== B.target) { B.react = (0.45 - b.skill * 0.3 + rand(0, 0.15)) * b.diff.react; }
  B.target = best;
}
export function botThink(sim, b, dt) {
  const B = b.ai || (b.ai = { path: [], pi: 0, goal: null, roam: null, replanT: 0, seeT: 0, target: null, react: 0, strafe: 1, strafeT: 0,
    stuckT: 0, lx: b.x, lz: b.z, wpT: 0, jumpCd: 0, taste: rand(0.8, 1.2), aimPhase: rand(0, 10) });
  B.seeT -= dt; B.replanT -= dt; B.react -= dt; B.strafeT -= dt; B.wpT -= dt; B.jumpCd -= dt;
  if (B.seeT <= 0) { B.seeT = 0.15; perceive(sim, b, B); }
  if (B.replanT <= 0 || B.pi >= B.path.length) replan(sim, b, B);

  // --- path following
  let mx = 0, mz = 0;
  b.wish.jump = false;
  if (B.pi < B.path.length) {
    const nxt = B.path[B.pi], [cx, cz] = cellCenter(nxt), dx = cx - b.x, dz = cz - b.z, d = Math.hypot(dx, dz);
    if (d < 0.6 || (B.pi < B.path.length - 1 && d < 1.1 && idx(b.x, b.z) === nxt)) B.pi++;
    else {
      mx = dx / d; mz = dz / d;
      const e = B.search.via[nxt];
      if (e && e.jump && d < 1.8 && b.og && B.jumpCd <= 0) { b.wish.jump = true; B.jumpCd = 0.6; }
    }
  }

  // --- combat
  const T = B.target;
  if (T && !T.dead && sim.byId[T.id]) {
    const dx = T.x - b.x, dz = T.z - b.z, dist = Math.hypot(dx, dz) || 1;
    if (B.wpT <= 0) { B.wpT = 0.5; pickWeapon(b, dist); }
    if (B.strafeT <= 0) { B.strafe = Math.random() < 0.5 ? -1 : 1; B.strafeT = rand(0.4, 1.3); if (Math.random() < 0.15 + b.skill * 0.2 && B.jumpCd <= 0) { b.wish.jump = true; B.jumpCd = 1; } }
    const want = PREF_RANGE[b.weapon], ux = dx / dist, uz = dz / dist;
    const rangeK = clamp((dist - want) / 4, -1, 1);
    const follow = b.hp > 50 ? 0.4 : 0.8;
    mx = mx * follow + (-uz * B.strafe) * 0.9 + ux * rangeK * 0.7;
    mz = mz * follow + (ux * B.strafe) * 0.9 + uz * rangeK * 0.7;
    // aim with lead for projectiles and a skill-based wobble
    let ax = T.x, az = T.z, ay = T.y + 1.1;
    const sp = PROJ_SPEED[b.weapon];
    if (sp) {
      const t = dist / sp * (0.4 + b.skill * 0.6);
      ax += T.vx * t; az += T.vz * t;
      if (b.weapon === 5 && T.og) ay = T.y + 0.3;
      if (b.weapon === 4) ay += dist * 0.09;
    }
    const tyaw = Math.atan2(-(ax - b.x), -(az - b.z));
    const tpitch = Math.atan2(ay - (b.y + EYE), Math.hypot(ax - b.x, az - b.z));
    const wob = (0.09 * (1 - b.skill) + 0.015) * b.diff.aim * Math.sin(sim.t * 3.1 + B.aimPhase);
    const turn = (5 + b.skill * 9) * dt;
    const dy = wrapAngle(tyaw + wob - b.yaw);
    b.yaw += clamp(dy, -turn, turn);
    b.pitch += clamp(tpitch - b.pitch, -turn, turn);
    const err = Math.abs(wrapAngle(tyaw - b.yaw));
    const tol = b.weapon === 2 || b.weapon === 6 ? 0.22 : b.weapon === 5 ? 0.12 : 0.09;
    b.wish.fire = B.react <= 0 && err < tol + 0.6 / dist && !(b.weapon === 5 && dist < 2.5);
  } else {
    b.wish.fire = false;
    if (B.wpT <= 0) { B.wpT = 1; pickWeapon(b, 10); }
    if (mx || mz) {
      const tyaw = Math.atan2(-mx, -mz);
      b.yaw += clamp(wrapAngle(tyaw - b.yaw), -6 * dt, 6 * dt);
      b.pitch *= 1 - Math.min(1, dt * 4);
    }
  }

  // --- don't wander into lava or off big drops while strafing
  const ml = Math.hypot(mx, mz);
  if (ml > 0.01) {
    mx /= ml; mz /= ml;
    const here = idx(b.x, b.z), ahead = idx(b.x + mx * 1.3, b.z + mz * 1.3);
    const onPath = B.pi < B.path.length && B.path[B.pi] === ahead;
    if (ahead >= 0 && !onPath && ((M.liq[ahead] === 1 && M.liq[here] !== 1) || M.f[here] - M.f[ahead] > 3)) { mx = -mx * 0.3; mz = -mz * 0.3; B.strafe *= -1; }
  }
  b.wish.x = mx; b.wish.z = mz;

  // --- stuck detection
  B.stuckT += dt;
  if (B.stuckT > 1) {
    const moved = Math.hypot(b.x - B.lx, b.z - B.lz);
    if (moved < 0.5 && ml > 0.1) { b.wish.jump = true; B.strafe *= -1; B.strafeT = 0.6; B.replanT = 0; B.roam = null; }
    B.stuckT = 0; B.lx = b.x; B.lz = b.z;
  }
}
