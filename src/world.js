// Level geometry and lighting (rendering only). The collision grid, tracing and nav graph live in sim.js.
import { THREE, CS, G, scene, ART } from './core.js';
import { M, loadGrid } from './sim.js';
import { A } from './audio.js';
export { M, idx, EYE, PH, STEP } from './sim.js';

const TS = 2;              // world units per texture repeat
let levelGroup = null;
const matCache = {};
function material(tex, liquid) {
  const k = (liquid ? 'L:' : '') + tex;
  if (matCache[k]) return matCache[k];
  const map = ART.tex[tex];
  return matCache[k] = liquid ? new THREE.MeshBasicMaterial({ map }) : new THREE.MeshLambertMaterial({ map, shadowSide: THREE.DoubleSide });
}

export function loadMap(def) {
  const cells = loadGrid(def);
  for (const l of pool) { l.intensity = 0; l.position.set(0, -100, 0); }
  poolUsed = 0;
  buildGeometry(cells);
  buildLighting(def);
}

// ---------- geometry ----------
function buildGeometry(cells) {
  if (levelGroup) { scene.remove(levelGroup); levelGroup.traverse(o => o.geometry && o.geometry.dispose()); }
  levelGroup = new THREE.Group();
  scene.add(levelGroup);
  const buckets = {};
  const bucket = (tex, liq) => { const k = (liq ? 'L:' : '') + tex; return buckets[k] || (buckets[k] = { tex, liq, p: [], n: [], uv: [] }); };
  const quad = (tex, liq, pts, nrm) => {
    const [a, b, c] = pts;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
    if (cx * nrm[0] + cy * nrm[1] + cz * nrm[2] < 0) pts = [pts[0], pts[3], pts[2], pts[1]];
    const B = bucket(tex, liq);
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const p = pts[k];
      B.p.push(p[0], p[1], p[2]); B.n.push(nrm[0], nrm[1], nrm[2]);
      if (Math.abs(nrm[1]) > 0.5) B.uv.push(p[0] / TS, p[2] / TS);
      else if (Math.abs(nrm[0]) > 0.5) B.uv.push(p[2] / TS, p[1] / TS);
      else B.uv.push(p[0] / TS, p[1] / TS);
    }
  };
  // vertical face on the edge of cell (x,z) towards direction (dx,dz), spanning y0..y1
  const face = (tex, x, z, dx, dz, y0, y1) => {
    if (y1 - y0 < 0.001) return;
    const x0 = x * CS, z0 = z * CS, x1 = x0 + CS, z1 = z0 + CS;
    let e;
    if (dx === 1) e = [[x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0]];
    else if (dx === -1) e = [[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]];
    else if (dz === 1) e = [[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]];
    else e = [[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]];
    quad(tex, false, e, [dx, 0, dz]);
  };
  const flat = (tex, liq, x, z, y, up) => {
    const x0 = x * CS, z0 = z * CS, x1 = x0 + CS, z1 = z0 + CS;
    quad(tex, liq, [[x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0]], [0, up ? 1 : -1, 0]);
  };
  const { W, H, f: F, c: C } = M;
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const i = z * W + x, d = cells[i], f = F[i], c = C[i];
    flat(d.top, !!d.liq, x, z, f, true);
    if (c < Infinity) { flat(d.ctex, false, x, z, c, false); flat(d.wtex, false, x, z, d.r, true); }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (nx < 0 || nz < 0 || nx >= W || nz >= H) continue;
      const j = nz * W + nx, fn = F[j], cn = C[j], dn = cells[j];
      if (fn < f) face(d.side || 'stone', x, z, dx, dz, fn, f);
      if (c < Infinity) {
        const lo = Math.max(c, fn), hi = Math.min(cn, d.r);
        if (hi > lo) face(d.wtex, x, z, dx, dz, lo, hi);
        if (cn < Infinity && dn.r < d.r) face(d.wtex, x, z, dx, dz, Math.max(dn.r, fn), d.r);
      }
    }
  }
  M.liquidTex = new Set();
  for (const B of Object.values(buckets)) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    const mesh = new THREE.Mesh(g, material(B.tex, B.liq));
    mesh.castShadow = !B.liq; mesh.receiveShadow = !B.liq;
    levelGroup.add(mesh);
    if (B.liq) M.liquidTex.add(ART.tex[B.tex]);
  }
}

function buildLighting(def) {
  scene.background = ART.sky[def.sky];
  scene.fog = new THREE.FogExp2(def.fog[0], def.fog[1]);
  const hemi = new THREE.HemisphereLight(def.hemi[0], def.hemi[1], def.hemi[2]);
  sky.hemi = hemi; sky.base = def.hemi[2]; sky.color = new THREE.Color(def.hemi[0]); sky.kind = def.sky;
  sky.next = G.time + rand(4, 10); sky.pulses = []; scene.backgroundIntensity = 1;
  levelGroup.add(hemi, new THREE.AmbientLight(0x8a7a80, 0.9));
  const sun = new THREE.DirectionalLight(def.sun[0], def.sun[1]);
  sky.sun = sun; sky.sunBase = def.sun[1];
  const cx = M.W * CS / 2, cz = M.H * CS / 2, [dx, dy, dz] = def.sun[2];
  sun.position.set(cx + dx * 80, dy * 80, cz + dz * 80);
  sun.target.position.set(cx, 0, cz);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const ext = Math.max(M.W, M.H) * CS * 0.75;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 260 });
  sun.shadow.bias = -0.0008;
  sun.shadow.normalBias = 0.04;
  levelGroup.add(sun, sun.target);
}
// Fixed pool of point lights shared by every map: the light count never changes, so shaders compile once
// instead of recompiling on every map change (which can stall or reset the GPU on some Windows drivers).
const LIGHT_POOL = 14;
const pool = Array.from({ length: LIGHT_POOL }, () => { const l = new THREE.PointLight(0xffffff, 0, 10, 1.3); l.position.set(0, -100, 0); scene.add(l); return l; });
let poolUsed = 0;
export function addLight(color, intensity, dist, x, y, z) {
  const l = poolUsed < pool.length ? pool[poolUsed++] : { intensity: 0, position: new THREE.Vector3() };
  if (l.isLight) { l.color.set(color); l.distance = dist; }
  l.intensity = intensity;
  l.position.set(x, y, z);
  return l;
}
// ---------- sky weather: every now and then lightning (storm / moon) or a hellfire pulse lights the sky and the level ----------
const rand = (a, b) => a + Math.random() * (b - a);
const SKY_FX = {
  storm: { gap: [5, 14], pulses: () => [[0, 1], [rand(0.08, 0.14), 0], [rand(0.16, 0.3), rand(0.6, 1)]], tint: 0xc8d8ff, decay: 12, thunder: [0.25, 1.2] },
  moon: { gap: [14, 32], pulses: () => [[0, rand(0.45, 0.7)], [rand(0.1, 0.2), rand(0.2, 0.4)]], tint: 0xd0d8ff, decay: 10, thunder: [1, 2.5] },
  hell: { gap: [9, 20], pulses: () => [[0, rand(0.6, 0.9)]], tint: 0xff5020, decay: 2.2, thunder: [0, 0.2] },
};
export const sky = { hemi: null, sun: null, base: 1, sunBase: 1, color: null, kind: 'moon', next: 0, pulses: [], flash: new THREE.Color() };
export function animateSky() {
  const fx = SKY_FX[sky.kind];
  if (!fx || !sky.hemi) return;
  if (G.time >= sky.next) {
    sky.next = G.time + rand(...fx.gap);
    const t0 = G.time;
    sky.pulses = fx.pulses().map(([dt, amp]) => ({ t: t0 + dt, amp }));
    const far = rand(...fx.thunder);
    setTimeout(() => A.thunder(sky.kind === 'hell' ? 0.6 : 1 - far / 3), far * 1000);
  }
  let f = 0;
  for (const p of sky.pulses) if (G.time >= p.t) f = Math.max(f, p.amp * Math.exp(-(G.time - p.t) * fx.decay));
  if (sky.kind === 'hell') f *= 0.5 + 0.5 * Math.sin(G.time * 18);   // flickering hellfire
  scene.backgroundIntensity = 1 + f * 1.6;
  sky.hemi.intensity = sky.base * (1 + f * 2.2);
  sky.hemi.color.copy(sky.color).lerp(sky.flash.set(fx.tint), Math.min(1, f));
  if (sky.sun) sky.sun.intensity = sky.sunBase * (1 + f * 1.2);
}
export function animateLiquids(dt) {
  for (const t of M.liquidTex || []) { t.offset.x += dt * 0.03; t.offset.y = Math.sin(G.time * 0.6) * 0.05; }
}
