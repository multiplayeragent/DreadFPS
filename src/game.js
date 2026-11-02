// Presentation only: actor/item/decor sprites, projectile visuals, effects, tracers, tesla beams, and turning server events into
// effects + sound. Game rules live in sim.js; this file never decides damage, frags or pickups.
import { THREE, CS, G, scene, camera, ART, rand, cv, canvasTex, mulberry } from './core.js';
import { loadMap, addLight } from './world.js';
import { MAPS } from './maps.js';
import { M, idx, EYE, WEAPONS, ITEM_DEFS, VERBS, SKINS, mapEntities, makeItem, aimRay, hitscan, pelletDirs, shotRng, projMove } from './sim.js';
import { A } from './audio.js';

const SPX_CHAR = 1.85 / 80, SPX_ITEM = 0.025;
const VOICE = { cultist: 135, marine: 110, ranger: 95, butcher: 70 };

// ---------- procedural fx textures ----------
function pxTex(w, h, seed, draw) { const c = cv(w, h), g = c.getContext('2d'), r = mulberry(seed); draw(g, r); return canvasTex(c); }
function disc(g, r, cx, cy, rad, col, dens = 1) {
  g.fillStyle = col;
  for (let y = Math.floor(cy - rad); y <= cy + rad; y++) for (let x = Math.floor(cx - rad); x <= cx + rad; x++)
    if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 < rad * rad && r() < dens) g.fillRect(x, y, 1, 1);
}
const PUFF = [0, 1, 2].map(f => pxTex(10, 10, 80 + f, (g, r) => {
  if (f === 0) { disc(g, r, 5, 5, 2.5, '#ffe080'); disc(g, r, 5, 5, 1.2, '#ffffff'); }
  if (f === 1) disc(g, r, 5, 5, 3.5, '#a8a8a8', 0.8);
  if (f === 2) disc(g, r, 5, 4, 4.5, '#686868', 0.45);
}));
const TELE = [[5, 0.12], [9, 0.3], [9, 0.5], [6, 0.2]].map(([rad, d], f) => pxTex(24, 40, 90 + f, (g, r) => {
  const cols = ['#40ff60', '#a0ffa0', '#20a040', '#e0ffe0'];
  for (let i = 0; i < 400 * d; i++) { const a = r() * 6.28, rr = Math.sqrt(r()) * rad; g.fillStyle = cols[i % 4]; g.fillRect((12 + Math.cos(a) * rr) | 0, (22 + Math.sin(a) * rr * 1.8) | 0, 1, 1); }
}));
const FIREBALL = [0, 1].map(f => pxTex(10, 10, 100 + f, (g, r) => { disc(g, r, 5, 5, 4.6, '#ff6010'); disc(g, r, 5, 5, 3, '#ffc040'); disc(g, r, 5, 5, 1.6, '#fff8d0'); }));
const GRENADE = pxTex(6, 6, 7, (g, r) => { disc(g, r, 3, 3, 2.8, '#2a2a24'); g.fillStyle = '#6a6a5a'; g.fillRect(2, 1, 1, 1); });
const BLOOD = pxTex(3, 3, 120, g => { g.fillStyle = '#a01010'; g.fillRect(0, 0, 3, 3); g.fillStyle = '#600000'; g.fillRect(1, 1, 1, 1); });
const GIB = pxTex(5, 4, 121, (g, r) => { g.fillStyle = '#8a1a14'; g.fillRect(0, 0, 5, 4); g.fillStyle = '#c86a5a'; g.fillRect(1, 1, 2, 1); g.fillStyle = '#e8d8c0'; g.fillRect(3, 2, 1, 1); });
const TELEPAD = pxTex(32, 32, 9, (g, r) => {
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const d = Math.hypot(x - 15.5, y - 15.5), a = Math.atan2(y - 15.5, x - 15.5);
    if (d < 15 && (Math.sin(a * 3 + d * 0.6) > 0.2 || d > 13 || r() < 0.08)) { g.fillStyle = d > 13 ? '#20a040' : r() < 0.5 ? '#40ff70' : '#a0ffb0'; g.fillRect(x, y, 1, 1); }
  }
});
const SHELL = pxTex(6, 3, 130, g => {
  g.fillStyle = '#a81c14'; g.fillRect(0, 0, 4, 3); g.fillStyle = '#e04a30'; g.fillRect(0, 0, 4, 1);
  g.fillStyle = '#b89038'; g.fillRect(4, 0, 2, 3); g.fillStyle = '#f0d070'; g.fillRect(4, 0, 2, 1);
});
const bloodMat = new THREE.SpriteMaterial({ map: BLOOD, alphaTest: 0.5 });
const gibMat = new THREE.SpriteMaterial({ map: GIB, alphaTest: 0.5 });

const geoCache = new Map();
function frameGeo(fr, spx) {
  const k = fr.tex.uuid + spx;
  if (!geoCache.has(k)) geoCache.set(k, new THREE.PlaneGeometry(fr.w * spx, fr.h * spx).translate((fr.w / 2 - fr.ax) * spx, fr.h * spx / 2, 0));
  return geoCache.get(k);
}
function bbMat(fr, emissive = 0x303030) {
  return new THREE.MeshLambertMaterial({ map: fr.tex, emissiveMap: fr.tex, emissive, alphaTest: 0.5, side: THREE.DoubleSide });
}
export const bbGroup = new THREE.Group(); // camera-facing sprites
scene.add(bbGroup);

// everything the view owns for the current level
export const V = { actors: new Map(), items: [], decor: [], drops: new Map(), projs: [], fx: [], parts: [], tracers: [], corpses: [], pads: [], shells: [], ejects: [], selfId: null };
let boomLights = [], teslaLight = null;
const muzzleLight = new THREE.PointLight(0xffb060, 0, 14, 1.5);
camera.add(muzzleLight);
muzzleLight.position.set(0, 0, -1);

// ============================================================
//  ACTORS (interpolated remote actors + the local player, whose sprite is hidden)
// ============================================================
class ActorView {
  constructor(id, skin) {
    this.id = id; this.skin = skin; this.pitchV = VOICE[skin];
    this.S = { a: ART.sprites[`char_${skin}_a`], b: ART.sprites[`char_${skin}_b`], c: ART.sprites[`char_${skin}_c`] };
    this.mat = bbMat(this.S.a[0]);
    this.mesh = new THREE.Mesh(frameGeo(this.S.a[0], SPX_CHAR), this.mat);
    this.mesh.receiveShadow = true;
    this.mesh.visible = false;
    bbGroup.add(this.mesh);
    this.cur = this.S.a[0];
    Object.assign(this, { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, vx: 0, vz: 0, weapon: 1, bob: 0, stepAcc: 0, lastShot: -9, shotN: 0, painT: 0,
      teslaUntil: 0, dead: false, gibbed: false, deathT: 0, seen: false, deadAt: null });
  }
  get isSelf() { return this.id === V.selfId; }
  setFrame(fr, mirror) {
    if (this.cur !== fr) { this.cur = fr; this.mat.map = fr.tex; this.mat.emissiveMap = fr.tex; this.mesh.geometry = frameGeo(fr, SPX_CHAR); }
    this.mesh.scale.x = mirror ? -1 : 1;
  }
  apply(s, dt) {
    const dead = !!s.dd;
    if (this.seen && this.dead && !dead && !this.gibbed && this.deadAt) leaveCorpse(this, this.deadAt);  // respawned: the body stays
    if (dead) { this.deathT = this.dead ? this.deathT + dt : 0; this.deadAt = [s.x, s.y, s.z]; } else { this.deathT = 0; this.deadAt = null; }
    this.dead = dead; this.gibbed = !!s.gb;
    this.x = s.x; this.y = s.y; this.z = s.z; this.yaw = s.yaw; this.pitch = s.pitch; this.vx = s.vx || 0; this.vz = s.vz || 0;
    if (s.w !== undefined) this.weapon = s.w;
    const hs = Math.hypot(this.vx, this.vz);
    if (!dead && s.g && hs > 1) {
      this.bob += dt * hs * 0.95;
      this.stepAcc += hs * dt;
      if (this.stepAcc > 2.4) { this.stepAcc = 0; A.footstep(this.x, this.z); }
    }
    this.painT -= dt;
    this.seen = true;
  }
  updateSprite() {
    this.mesh.visible = !this.isSelf && !this.gibbed && this.seen;
    if (!this.mesh.visible) return;
    this.mesh.position.set(this.x, this.y, this.z);
    const { a, b, c } = this.S;
    if (this.dead) { this.setFrame(this.deathT < 0.2 ? c[1] : this.deathT < 0.5 ? c[2] : c[3], false); return; }
    // view-dependent frame: front / side (mirrored for left-facing) / back
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    const tx = camera.position.x - this.x, tz = camera.position.z - this.z, tl = Math.hypot(tx, tz) || 1;
    const dot = (fx * tx + fz * tz) / tl;
    const rx = Math.cos(camera.rotation.y), rz = -Math.sin(camera.rotation.y);
    const moving = Math.hypot(this.vx, this.vz) > 0.8, step = Math.floor(this.bob / 1.6) % 4;
    if (this.painT > 0 && dot > 0) this.setFrame(c[0], false);
    else if (dot > 0.45) {
      if (G.time - this.lastShot < 0.12) this.setFrame(a[2], false);
      else this.setFrame(moving ? [a[1], a[0], b[2], a[0]][step] : a[0], false);
    } else if (dot < -0.45) this.setFrame(moving ? [a[3], b[3]][step % 2] : a[3], false);
    else this.setFrame(moving ? [b[0], b[1]][step % 2] : b[0], fx * rx + fz * rz < 0);
  }
  remove() {
    bbGroup.remove(this.mesh); this.mat.dispose();
    if (this.bolt) this.bolt.ribbons.forEach(r => { boltGroup.remove(r.mesh); r.mesh.geometry.dispose(); });
  }
}
function leaveCorpse(v, at) {
  const fr = v.S.c[3], m = new THREE.Mesh(frameGeo(fr, SPX_CHAR), bbMat(fr));
  m.position.set(at[0], at[1], at[2]);
  m.receiveShadow = true;
  bbGroup.add(m);
  V.corpses.push(m);
  if (V.corpses.length > 12) { const old = V.corpses.shift(); bbGroup.remove(old); old.material.dispose(); }
}
// samples: [{ id, x, y, z, yaw, pitch, vx, vz, g, dd, gb, w, k }] for every actor (self included, flagged by id)
export function syncActors(samples, dt) {
  const seen = new Set();
  for (const s of samples) {
    seen.add(s.id);
    let v = V.actors.get(s.id);
    const skin = SKINS[s.k] || 'marine';
    if (v && v.skin !== skin) { v.remove(); V.actors.delete(s.id); v = null; }
    if (!v) { v = new ActorView(s.id, skin); V.actors.set(s.id, v); }
    v.apply(s, dt);
    v.updateSprite();
  }
  for (const [id, v] of V.actors) if (!seen.has(id)) { v.remove(); V.actors.delete(id); }
}
const targetsFor = shooterId => [...V.actors.values()].filter(v => v.id !== shooterId && !v.dead && v.seen);

// ============================================================
//  LEVEL
// ============================================================
function clearLevel() {
  for (const v of V.actors.values()) v.remove();
  V.actors.clear();
  for (const it of V.items) { bbGroup.remove(it.mesh); it.mesh.material.dispose(); }
  for (const it of V.drops.values()) { bbGroup.remove(it.mesh); it.mesh.material.dispose(); }
  V.drops.clear();
  for (const p of V.projs) { scene.remove(p.s); p.s.material.dispose(); }
  for (const f of V.fx) { scene.remove(f.s); f.s.material.dispose(); }
  for (const p of V.parts) scene.remove(p.s);
  for (const t of V.tracers) { scene.remove(t.line); t.line.geometry.dispose(); }
  for (const p of V.pads) scene.remove(p);
  for (const s of V.shells) { scene.remove(s.s); s.s.material.dispose(); }
  for (const m of boltGroup.children) m.geometry.dispose();
  boltGroup.clear();
  bbGroup.clear();
  Object.assign(V, { items: [], decor: [], projs: [], fx: [], parts: [], tracers: [], corpses: [], pads: [], shells: [], ejects: [] });
}
function itemMesh(it) {
  const fr = ART.sprites[it.d.spr[0]][it.d.spr[1]];
  it.mesh = new THREE.Mesh(frameGeo(fr, SPX_ITEM), bbMat(fr, it.d.power ? 0x909090 : 0x505050));
  it.mesh.position.set(it.x, it.y + 0.05, it.z);
  it.phase = rand(0, 6);
  bbGroup.add(it.mesh);
  return it;
}
// build the level for map index mi; returns the decor list (shared with prediction for obstacle collision)
export function loadLevel(mi) {
  clearLevel();
  loadMap(MAPS[mi]);
  boomLights = [0, 1].map(() => addLight(0xff8030, 0, 18, 0, -50, 0));
  teslaLight = addLight(0x70b0ff, 0, 10, 0, -50, 0);
  const ents = mapEntities();
  V.items = ents.items.map(itemMesh);
  V.decor = ents.decor;
  for (const d of V.decor) {
    const fr = ART.sprites.decor[d.f];
    d.mesh = new THREE.Mesh(frameGeo(fr, SPX_ITEM), bbMat(fr, d.light ? 0x707070 : 0x303030));
    d.mesh.position.set(d.x, d.y, d.z);
    d.mesh.receiveShadow = true;
    bbGroup.add(d.mesh);
    if (d.light) { d.lamp = addLight(0xff9040, 30, 20, d.x, d.y + 1.9, d.z); d.seed = rand(0, 99); }
  }
  for (const t of M.things) if (t.type === 'light') addLight(0x9ab0ff, 26, 18, t.x * CS, 3.6, t.z * CS);
  for (const tp of M.teles) {
    const pad = new THREE.Mesh(new THREE.PlaneGeometry(CS * 0.9, CS * 0.9), new THREE.MeshBasicMaterial({ map: TELEPAD, alphaTest: 0.5 }));
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(tp.x, M.f[tp.from] + 0.03, tp.z);
    scene.add(pad); V.pads.push(pad);
    addLight(0x40ff70, 8, 7, tp.x, M.f[tp.from] + 1, tp.z);
  }
  return V.decor;
}
// replicated item availability, dropped weapons and barrels
export function syncWorld(itemMask, drops) {
  V.items.forEach((it, i) => { it.mesh.visible = itemMask[i] !== '0'; });
  const keep = new Set();
  for (const d of drops) {
    keep.add(d.id);
    if (!V.drops.has(d.id) && ITEM_DEFS[d.type]) V.drops.set(d.id, itemMesh(makeItem(d.type, d.x, d.z)));
  }
  for (const [id, it] of V.drops) if (!keep.has(id)) { bbGroup.remove(it.mesh); it.mesh.material.dispose(); V.drops.delete(id); }
  for (const d of V.decor) if (d.barrel && d.mesh.parent && d.dead) bbGroup.remove(d.mesh);
}

// ============================================================
//  EFFECTS
// ============================================================
const FXDEF = {
  explosion: () => ({ frames: ART.sprites.fx_explosion.map(f => f.tex), dt: 0.07, size: 0.055, sizes: ART.sprites.fx_explosion }),
  puff: () => ({ frames: PUFF, dt: 0.06, size: 0.035, rise: 0.6 }),
  smoke: () => ({ frames: PUFF.slice(1), dt: 0.14, size: 0.045, rise: 0.4 }),
  tele: () => ({ frames: TELE, dt: 0.11, size: 0.065, bottom: true }),
};
export function spawnFx(kind, x, y, z, scale = 1) {
  const d = FXDEF[kind](), tex = d.frames[0];
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, alphaTest: 0.5 }));
  const sz = i => d.sizes ? [d.sizes[i].w, d.sizes[i].h] : [tex.image.width, tex.image.height];
  const [w, h] = sz(0);
  s.position.set(x, y, z);
  s.scale.set(w * d.size * scale, h * d.size * scale, 1);
  if (d.bottom) s.center.set(0.5, 0);
  scene.add(s);
  V.fx.push({ s, d, t: 0, scale, sz });
}
function puffAt(x, y, z) { spawnFx('puff', x, y, z); }
export function bleed(x, y, z, n, dx = 0, dz = 0) {
  for (let i = 0; i < n; i++) {
    const s = new THREE.Sprite(bloodMat);
    s.position.set(x + rand(-0.15, 0.15), y + rand(-0.15, 0.15), z + rand(-0.15, 0.15));
    s.scale.setScalar(rand(0.08, 0.14));
    scene.add(s);
    V.parts.push({ s, vx: dx * 2 + rand(-1.5, 1.5), vy: rand(0, 3), vz: dz * 2 + rand(-1.5, 1.5), life: rand(0.4, 0.8) });
  }
}
function gibs(x, y, z) {
  for (let i = 0; i < 14; i++) {
    const s = new THREE.Sprite(gibMat);
    s.position.set(x, y + rand(-0.4, 0.4), z);
    s.scale.setScalar(rand(0.15, 0.3));
    scene.add(s);
    V.parts.push({ s, vx: rand(-5, 5), vy: rand(3, 8), vz: rand(-5, 5), life: rand(2, 4), bounce: true });
  }
  bleed(x, y, z, 20);
}
function explosionFx(x, y, z) {
  spawnFx('explosion', x, y + 0.3, z);
  const l = boomLights[0].intensity < boomLights[1].intensity ? boomLights[0] : boomLights[1];
  l.position.set(x, y + 0.8, z); l.intensity = 60;
  A.explosion(x, z);
  const pd = Math.hypot(camera.position.x - x, camera.position.y - y, camera.position.z - z), R = 4.2;
  if (pd < R * 3) G.shake = Math.max(G.shake, 0.8 * (1 - pd / (R * 3)));
}
// a short glowing streak that races from the muzzle to the impact point
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe2a0 });
function tracer(a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  if (len < 1.2) return;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(6), 3));
  const line = new THREE.Line(g, tracerMat);
  line.frustumCulled = false;
  scene.add(line);
  const streak = Math.min(len * 0.5, 3.5);
  V.tracers.push({ line, a, b, len, streak, t: 0, dur: (len + streak) / 400 });
}
// impacts of one hitscan shot: tracers from the muzzle, puffs on walls, blood on flesh
function impacts(mz, w, pts, dir) {
  for (let i = 0; i < pts.length; i += 4) {
    const p = [pts[i], pts[i + 1], pts[i + 2]], k = pts[i + 3];
    if (w === 0) { A.thud(p[0], p[2]); if (k === 1) bleed(p[0], p[1], p[2], 6); else if (k === 0) puffAt(p[0] - dir[0] * 0.08, p[1] - dir[1] * 0.08, p[2] - dir[2] * 0.08); continue; }
    tracer(mz, p);
    const dx = p[0] - mz[0], dy = p[1] - mz[1], dz = p[2] - mz[2], l = Math.hypot(dx, dy, dz) || 1;
    if (k === 1) bleed(p[0], p[1], p[2], 2, -dx / l, -dz / l);
    else if (k === 0) puffAt(p[0] - dx / l * 0.08, p[1] - dy / l * 0.08, p[2] - dz / l * 0.08);
  }
}
function muzzleOf(v, R, isSelf) {
  const gun = isSelf ? [R.r[0] * 0.18 - R.u[0] * 0.22, -0.22, R.r[2] * 0.18 - R.u[2] * 0.22] : [0, -0.15, 0];
  return [R.o[0] + R.d[0] * 0.6 + gun[0], R.o[1] + R.d[1] * 0.6 + gun[1], R.o[2] + R.d[2] * 0.6 + gun[2]];
}

// ---------- projectile visuals (the server owns the real ones; these are simulated locally for display) ----------
function spawnProjVis(pid, kind, owner, o, v, ff = 0) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: kind === 'rocket' ? FIREBALL[0] : GRENADE, alphaTest: 0.5 }));
  s.scale.setScalar(kind === 'rocket' ? 0.45 : 0.3);
  const p = { pid, kind, owner, x: o[0], y: o[1], z: o[2], vx: v[0], vy: v[1], vz: v[2], life: kind === 'rocket' ? 6 : 2.3, age: 0, trail: 0, stopped: 0, s, local: pid === null };
  for (let t = Math.min(ff, 0.3); t > 0.001; t -= 1 / 60) if (projMove(p, Math.min(t, 1 / 60), null)) { p.stopped = 0.001; break; }
  s.position.set(p.x, p.y, p.z);
  scene.add(s);
  V.projs.push(p);
  return p;
}
function removeProj(p) { scene.remove(p.s); p.s.material.dispose(); V.projs.splice(V.projs.indexOf(p), 1); }

// ---------- shotgun shells: ejected on the pump / break-open, they tumble and clunk onto the floor ----------
const EJECT = { 1: { delay: 0.3, n: 1 }, 2: { delay: 0.45, n: 2 } };   // weapon index -> when the action opens, how many shells
const MAX_SHELLS = 48, SHELL_LIFE = 15;
function queueEject(id, weapon) {
  const e = EJECT[weapon];
  if (e) V.ejects.push({ at: G.time + e.delay, id, n: e.n, ssg: weapon === 2 });
}
function ejectShells(ej) {
  const v = V.actors.get(ej.id);
  if (!v || v.dead) return;
  let o, yaw, base;
  if (v.isSelf) {
    // first person: out of the right side of the gun, just below the view
    yaw = camera.rotation.y;
    const c = camera.position;
    o = [c.x + Math.cos(yaw) * 0.22 - Math.sin(yaw) * 0.35, c.y - 0.3, c.z - Math.sin(yaw) * 0.22 - Math.cos(yaw) * 0.35];
    base = [G.player.vel.x, G.player.vel.z];
  } else {
    yaw = v.yaw;
    o = [v.x + Math.cos(yaw) * 0.25 - Math.sin(yaw) * 0.2, v.y + 1.15, v.z - Math.sin(yaw) * 0.25 - Math.cos(yaw) * 0.2];
    base = [v.vx, v.vz];
  }
  const rx = Math.cos(yaw), rz = -Math.sin(yaw), fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  for (let i = 0; i < ej.n; i++) {
    // the pump flicks a shell up and to the right; the break-open pops both shells out more gently
    const side = ej.ssg ? rand(0.8, 1.6) : rand(1.8, 2.8), up = ej.ssg ? rand(1.2, 2.0) : rand(2.4, 3.4), back = ej.ssg ? rand(0.2, 0.7) : rand(0.3, 0.9);
    const mat = new THREE.SpriteMaterial({ map: SHELL, alphaTest: 0.5, rotation: rand(0, 6.28) });
    const s = new THREE.Sprite(mat);
    s.scale.set(0.16, 0.08, 1);
    const sh = { s, x: o[0] + rx * i * 0.06, y: o[1], z: o[2] + rz * i * 0.06, vx: rx * side + fx * back + base[0], vy: up, vz: rz * side + fz * back + base[1],
      spin: rand(14, 24) * (Math.random() < 0.5 ? -1 : 1), rest: false, life: SHELL_LIFE };
    s.position.set(sh.x, sh.y, sh.z);
    scene.add(s);
    V.shells.push(sh);
    if (V.shells.length > MAX_SHELLS) { const old = V.shells.shift(); scene.remove(old.s); old.s.material.dispose(); }
  }
}
function updateShells(dt) {
  for (let i = V.ejects.length - 1; i >= 0; i--) if (G.time >= V.ejects[i].at) { ejectShells(V.ejects[i]); V.ejects.splice(i, 1); }
  for (let i = V.shells.length - 1; i >= 0; i--) {
    const sh = V.shells[i];
    sh.life -= dt;
    if (sh.life <= 0) { scene.remove(sh.s); sh.s.material.dispose(); V.shells.splice(i, 1); continue; }
    if (sh.rest) continue;
    sh.vy -= 16 * dt;
    let nx = sh.x + sh.vx * dt, nz = sh.z + sh.vz * dt;
    const ny = sh.y + sh.vy * dt;
    const j = idx(nx, nz);
    if (j < 0 || M.f[j] > sh.y + 0.2 || ny > M.c[j]) { sh.vx *= -0.4; sh.vz *= -0.4; nx = sh.x; nz = sh.z; if (Math.hypot(sh.vx, sh.vz) > 0.8) A.shell(nx, nz, 0.5); }  // wall
    const k = idx(nx, nz), fl = k < 0 ? sh.y : M.f[k] + 0.03;
    sh.x = nx; sh.z = nz; sh.y = ny;
    if (sh.y <= fl) {
      if (k >= 0 && M.liq[k]) { scene.remove(sh.s); sh.s.material.dispose(); V.shells.splice(i, 1); continue; }   // sinks in lava / slime
      sh.y = fl;
      if (-sh.vy > 1) A.shell(sh.x, sh.z, Math.min(1, -sh.vy / 5));
      sh.vy = -sh.vy * 0.35; sh.vx *= 0.55; sh.vz *= 0.55; sh.spin *= 0.45;
      if (sh.vy < 0.6) {
        // come to rest lying on its side
        sh.rest = true; sh.vy = 0;
        sh.s.material.rotation = Math.round(sh.s.material.rotation / Math.PI) * Math.PI + rand(-0.2, 0.2);
      }
    }
    if (!sh.rest) sh.s.material.rotation += sh.spin * dt;
    sh.s.position.set(sh.x, sh.y + 0.03, sh.z);
  }
}

// ============================================================
//  LOCAL SHOT PREDICTION (the shooter sees their own shot instantly; the server confirms damage)
// ============================================================
// shooter: { x, y, z, yaw, pitch, weapon }, cmd: the input that fired, rst: the render time remotes were drawn at
export function localShot(shooter, cmd) {
  const w = WEAPONS[shooter.weapon], self = V.actors.get(V.selfId);
  if (self) { self.lastShot = G.time; self.shotN++; }
  queueEject(V.selfId, shooter.weapon);
  if (w.id !== 'tesla' || (self && self.shotN % 2)) A.shot(w.sound, shooter.x, shooter.z);
  muzzleLight.intensity = w.melee ? 0 : 8;
  G.shake = Math.max(G.shake, { sshotgun: 0.35, rocket: 0.3, shotgun: 0.2 }[w.id] || 0.1);
  const R = aimRay(shooter), targets = targetsFor(V.selfId);
  if (w.proj) {
    const o = [R.o[0] + R.d[0] * 0.6 - R.u[0] * 0.2, R.o[1] + R.d[1] * 0.6 - 0.2, R.o[2] + R.d[2] * 0.6 - R.u[2] * 0.2];
    const v = w.proj === 'rocket' ? [R.d[0] * 26, R.d[1] * 26, R.d[2] * 26] : [R.d[0] * 17, R.d[1] * 17 + 3, R.d[2] * 17];
    spawnProjVis(null, w.proj, V.selfId, o, v);
    return;
  }
  if (w.beam) { if (self) self.teslaUntil = G.time + 0.15; return; }
  if (w.melee) {
    const h = hitscan(R.o, R.d, 1.9, targets, V.decor);
    if (h.target || h.wall) impacts(null, 0, [R.o[0] + R.d[0] * h.t, R.o[1] + R.d[1] * h.t, R.o[2] + R.d[2] * h.t, h.target ? h.kind : 0], R.d);
    return;
  }
  const pts = [];
  for (const d of pelletDirs(R, w, shotRng(cmd.seq))) {
    const h = hitscan(R.o, d, 120, targets, V.decor);
    pts.push(R.o[0] + d[0] * h.t, R.o[1] + d[1] * h.t, R.o[2] + d[2] * h.t, h.target ? h.kind : h.wall ? 0 : 3);
  }
  impacts(muzzleOf(self, R, true), w.id === 'axe' ? 0 : 1, pts, R.d);
}

// ============================================================
//  SERVER EVENTS -> effects, sound, messages
// ============================================================
function feed(text, color, t = 5) { G.feed.push({ text, color, t }); if (G.feed.length > 5) G.feed.shift(); }
const KILL_SELF = { lava: 'TOOK A LAVA BATH', slime: 'DISSOLVED' };
// ctx: { selfId, nameOf(id), age (seconds the batch is old, for projectile fast-forward) }
export function onEvent(e, ctx) {
  const self = ctx.selfId, v = id => V.actors.get(id);
  switch (e[0]) {
    case 'f': {
      if (e[1] === self) break;
      const a = v(e[1]);
      if (!a) break;
      a.lastShot = G.time; a.shotN++;
      const w = WEAPONS[e[2]];
      if (w.beam) a.teslaUntil = G.time + 0.15;
      if (!w.beam || a.shotN % 2) A.shot(w.sound, a.x, a.z);
      queueEject(a.id, e[2]);
      break;
    }
    case 'h': {
      if (e[1] === self) break;
      const a = v(e[1]);
      if (!a) break;
      const R = aimRay(a);
      impacts(muzzleOf(a, R, false), e[2] === 0 ? 0 : 1, e[3], R.d);
      break;
    }
    case 'p': {
      const [, pid, kind, oid, x, y, z, vx, vy, vz] = e, k = kind ? 'grenade' : 'rocket';
      if (oid === self) {
        const mine = V.projs.find(p => p.local && p.pid === null && p.kind === k);
        if (mine) { mine.pid = pid; break; }
      }
      spawnProjVis(pid, k, oid, [x, y, z], [vx, vy, vz], ctx.age);
      break;
    }
    case 'x': { const p = V.projs.find(q => q.pid === e[1]); if (p) removeProj(p); break; }
    case 'b': explosionFx(e[1], e[2], e[3]); break;
    case 'k': {
      const [, vid, aid, wk, gib, x, y, z] = e, vn = ctx.nameOf(vid), victim = v(vid);
      if (gib) { A.gib(x, z); gibs(x, y + 1, z); } else A.death(x, z, victim ? victim.pitchV : 110);
      bleed(x, y + 1.1, z, 12);
      let col = '#c8c0b0', msg;
      if (!aid) msg = `${vn} ${KILL_SELF[wk] || 'BLEW UP'}`;
      else {
        const an = ctx.nameOf(aid);
        msg = `${an} ${VERBS[wk] || 'KILLED'} ${vn}`;
        if (aid === self) { A.frag(); col = '#ffe040'; G.centerMsg(`YOU FRAGGED ${vn}`, 1.6); G.player.grin = 1.2; }
      }
      if (vid === self) { col = '#ff5040'; G.centerMsg(aid && aid !== vid ? `${ctx.nameOf(aid)} FRAGGED YOU` : 'YOU DIED', 3); }
      feed(msg, col);
      break;
    }
    case 'n': { const a = v(e[1]); if (a) { a.painT = 0.18; A.pain(a.x, a.z, a.pitchV); } break; }
    case 'z': A.sizzle(e[1], e[2]); break;
    case 'u': if (e[1] === self) { A.pickup(e[2]); G.player.pick = 1; feed(e[3], '#a8e070', 3); } break;
    case 't': spawnFx('tele', e[1], e[2], e[3]); A.teleport(e[1], e[3]); break;
    case 'r': spawnFx('tele', e[1], e[2], e[3], 0.5); A.respawnItem(e[1], e[3]); break;
    case 'j': feed(e[1], '#d8a060', 6); G.centerMsg(e[1], 2.5); break;
    case 'w': G.match.winnerId = e[1]; A.win(); break;
    case 'H': if (e[1] === self) { A.hit(); G.hits = (G.hits || 0) + 1; } break;
  }
}

// ---------- tesla: a continuous, crackling lightning beam drawn every frame while the trigger is held ----------
const boltGroup = new THREE.Group();
scene.add(boltGroup);
const BOLT_PTS = 16;
const boltMats = [
  new THREE.MeshBasicMaterial({ color: 0x3a8cff, transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
  new THREE.MeshBasicMaterial({ color: 0xeaf6ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
];
function makeBolt() {
  const ribbons = boltMats.map((m, k) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array((BOLT_PTS - 1) * 18), 3));
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false;
    boltGroup.add(mesh);
    return { mesh, half: k === 0 ? 0.13 : 0.04 };
  });
  return { ribbons, pts: [], n: 0, jitterT: 0, sparkT: 0 };
}
// build a camera-facing ribbon through the points
function ribbon(r, pts, n) {
  const pos = r.mesh.geometry.attributes.position, cam = camera.position, side = [];
  for (let i = 0; i < n; i++) {
    const p = pts[i], a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
    const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
    const vx = cam.x - p[0], vy = cam.y - p[1], vz = cam.z - p[2];
    let sx = dy * vz - dz * vy, sy = dz * vx - dx * vz, sz = dx * vy - dy * vx;
    // taper near the camera so the bolt stays a bolt instead of filling the screen
    const l = (Math.hypot(sx, sy, sz) || 1) / (r.half * Math.min(1, Math.max(0.1, Math.hypot(vx, vy, vz) / 4)));
    side.push([sx / l, sy / l, sz / l]);
  }
  let k = 0;
  for (let i = 0; i < BOLT_PTS - 1; i++) {
    const j = Math.min(i, n - 2), p = pts[j], q = pts[j + 1], s = side[j], t = side[j + 1];
    const quad = i < n - 1
      ? [[p[0] + s[0], p[1] + s[1], p[2] + s[2]], [p[0] - s[0], p[1] - s[1], p[2] - s[2]], [q[0] + t[0], q[1] + t[1], q[2] + t[2]], [q[0] - t[0], q[1] - t[1], q[2] - t[2]]]
      : [q, q, q, q];
    for (const v of [quad[0], quad[1], quad[2], quad[2], quad[1], quad[3]]) pos.setXYZ(k++, v[0], v[1], v[2]);
  }
  pos.needsUpdate = true;
}
function updateTesla(dt) {
  let lit = null, litD = 1e9;
  for (const a of V.actors.values()) {
    const on = !a.dead && a.weapon === 6 && G.time < a.teslaUntil;
    if (!on) { if (a.bolt) a.bolt.ribbons.forEach(r => r.mesh.visible = false); continue; }
    const B = a.bolt || (a.bolt = makeBolt());
    B.ribbons.forEach(r => r.mesh.visible = true);
    const R = aimRay(a), h = hitscan(R.o, R.d, WEAPONS[6].range, targetsFor(a.id), V.decor);
    let s;
    if (a.isSelf && G.teslaTip != null) {
      // start the bolt exactly where the tesla sprite's barrel tip is on screen
      const v = new THREE.Vector3(0, 1 - 2 * G.teslaTip / G.VH, 0.5).unproject(camera).sub(camera.position).normalize();
      s = [camera.position.x + v.x * 0.6, camera.position.y + v.y * 0.6, camera.position.z + v.z * 0.6];
    } else s = [R.o[0] + R.d[0] * 0.5, R.o[1] - 0.25, R.o[2] + R.d[2] * 0.5];
    const e = [R.o[0] + R.d[0] * h.t, R.o[1] + R.d[1] * h.t, R.o[2] + R.d[2] * h.t];
    const len = Math.hypot(e[0] - s[0], e[1] - s[1], e[2] - s[2]);
    B.jitterT -= dt;
    if (B.jitterT <= 0 || !B.off) {
      // re-zig the bolt ~25x a second so it crackles
      B.jitterT = 0.04;
      B.n = Math.max(4, Math.min(BOLT_PTS, Math.round(len / 1.1) + 2));
      const amp = Math.min(0.45, 0.06 + len * 0.025);
      B.off = [];
      for (let i = 0; i < B.n; i++) {
        const ramp = Math.min(1, (i / (B.n - 1)) * len / 2.5);
        B.off.push(i === 0 || i === B.n - 1 ? [0, 0, 0] : [rand(-amp, amp) * ramp, rand(-amp, amp) * ramp, rand(-amp, amp) * ramp]);
      }
    }
    B.pts = [];
    for (let i = 0; i < B.n; i++) {
      const t = i / (B.n - 1), o = B.off[i];
      B.pts.push([s[0] + (e[0] - s[0]) * t + o[0], s[1] + (e[1] - s[1]) * t + o[1], s[2] + (e[2] - s[2]) * t + o[2]]);
    }
    for (const r of B.ribbons) ribbon(r, B.pts, B.n);
    B.sparkT -= dt;
    if (B.sparkT <= 0 && (h.wall || h.target)) { B.sparkT = 0.06; spawnFx('puff', e[0] - R.d[0] * 0.1, e[1] - R.d[1] * 0.1, e[2] - R.d[2] * 0.1, 1.4); }
    const dCam = Math.hypot(e[0] - camera.position.x, e[2] - camera.position.z);
    if (dCam < litD) { litD = dCam; lit = e; }
    if (a.isSelf) muzzleLight.intensity = Math.max(muzzleLight.intensity, 3);
  }
  if (teslaLight) {
    if (lit) { teslaLight.position.set(lit[0], lit[1] + 0.3, lit[2]); teslaLight.intensity = 14 + rand(-5, 5); }
    else teslaLight.intensity = 0;
  }
}

// ============================================================
//  PER FRAME
// ============================================================
export function updateView(dt) {
  for (let i = V.tracers.length - 1; i >= 0; i--) {
    const tr = V.tracers[i];
    tr.t += dt;
    // the streak's front stops at the impact while its tail keeps going, so it shrinks into the hit point and is removed
    const run = (tr.t / tr.dur) * (tr.len + tr.streak), head = Math.min(tr.len, run), tail = Math.max(0, run - tr.streak);
    if (tail >= tr.len) { scene.remove(tr.line); tr.line.geometry.dispose(); V.tracers.splice(i, 1); continue; }
    const pos = tr.line.geometry.attributes.position;
    for (const [k, s] of [[0, tail / tr.len], [1, head / tr.len]]) pos.setXYZ(k, tr.a[0] + (tr.b[0] - tr.a[0]) * s, tr.a[1] + (tr.b[1] - tr.a[1]) * s, tr.a[2] + (tr.b[2] - tr.a[2]) * s);
    pos.needsUpdate = true;
  }
  for (let i = V.fx.length - 1; i >= 0; i--) {
    const f = V.fx[i];
    f.t += dt;
    const k = Math.floor(f.t / f.d.dt);
    if (k >= f.d.frames.length) { scene.remove(f.s); f.s.material.dispose(); V.fx.splice(i, 1); continue; }
    if (f.s.material.map !== f.d.frames[k]) {
      f.s.material.map = f.d.frames[k];
      const [w, h] = f.sz(k);
      f.s.scale.set(w * f.d.size * f.scale, h * f.d.size * f.scale, 1);
    }
    if (f.d.rise) f.s.position.y += f.d.rise * dt;
  }
  for (let i = V.parts.length - 1; i >= 0; i--) {
    const p = V.parts[i], s = p.s.position;
    p.life -= dt;
    if (p.life <= 0) { scene.remove(p.s); V.parts.splice(i, 1); continue; }
    p.vy -= 14 * dt; s.x += p.vx * dt; s.y += p.vy * dt; s.z += p.vz * dt;
    const fl = M.f[idx(s.x, s.z)] ?? 0;
    if (s.y < fl + 0.05) { s.y = fl + 0.05; if (p.bounce && p.vy < -2) { p.vy *= -0.3; p.vx *= 0.5; p.vz *= 0.5; } else p.vx = p.vz = p.vy = 0; }
  }
  for (const p of [...V.projs]) {
    if (p.stopped) { p.stopped += dt; p.s.visible = false; if (p.stopped > 1.5) removeProj(p); continue; }
    if (p.local && p.pid === null && p.age > 1) { removeProj(p); continue; }   // the server never confirmed this shot
    if (projMove(p, dt, null)) { p.stopped = 0.001; continue; }
    if (p.bounced) A.bounce(p.x, p.z);
    p.s.position.set(p.x, p.y, p.z);
    if (p.kind === 'rocket') {
      p.s.material.map = FIREBALL[Math.floor(G.time * 12) % 2];
      p.trail -= dt;
      if (p.trail <= 0) { p.trail = 0.035; spawnFx('smoke', p.x, p.y, p.z); }
    }
  }
  for (const it of [...V.items, ...V.drops.values()]) {
    it.phase += dt;
    if (it.d.power || it.d.w !== undefined) it.mesh.position.y = it.y + 0.15 + Math.sin(it.phase * 2.5) * 0.08;
  }
  for (const d of V.decor) if (d.lamp) d.lamp.intensity = 30 * (0.8 + 0.2 * Math.sin(G.time * 13 + d.seed) * Math.sin(G.time * 7.7 + d.seed * 2));
  for (const pad of V.pads) pad.rotation.z += dt * 2;
  updateTesla(dt);
  updateShells(dt);
  for (const l of boomLights) l.intensity *= Math.exp(-dt * 9);
  muzzleLight.intensity *= Math.exp(-dt * 30);
  for (const m of bbGroup.children) m.rotation.y = camera.rotation.y;
}
