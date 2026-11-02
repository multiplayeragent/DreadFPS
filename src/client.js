// Client netcode, identical for online and practice: snapshot buffer + server clock estimate, local prediction with
// reconciliation (snap to the server, replay unacknowledged inputs), and interpolation of remote actors in the past.
import { makeActor, moveActor, weaponTick, AMMO, ITEM_TYPES, mapEntities } from './sim.js';

export const STEP_DT = 1 / 30;   // fixed client input/prediction rate
const r4 = v => Math.round(v * 10000) / 10000;

export class Client {
  constructor(conn) {
    this.conn = conn;
    this.selfId = null;
    this.snaps = [];            // [{ st, a: { id: actorSnapshot } }]
    this.offset = 0; this.haveOffset = false;
    this.P = makeActor('me', 'YOU', 'marine', false);
    this.P.dead = true;
    this.pending = []; this.seq = 0;
    this.prev = { x: 0, y: 0, z: 0 }; this.corr = { x: 0, y: 0, z: 0 };
    this.mi = -1; this.decor = []; this.shared = {}; this.dropsJson = ''; this.drops = [];
    this.me = null; this.hasSelf = false;
    this.onMap = () => {}; this.onSelfDeath = () => {}; this.onSelfSpawn = () => {};
  }
  now() { return performance.now() / 1000; }
  serverNow() { return this.now() + this.offset; }
  renderST() { return this.serverNow() - this.conn.interp; }

  // ---------- incoming state ----------
  onState(s) {
    const sh = s.shared || {}, ents = s.entities || {};
    this.selfId = this.conn.selfId;
    if (sh.st === undefined || sh.mi === undefined) return;
    if (sh.mi !== this.mi && sh.mi >= 0) {
      this.mi = sh.mi; this.snaps = []; this.pending = [];
      // the view loads the level (grid + meshes) and hands back its decor list, shared for prediction obstacles
      this.decor = this.onMap(sh.mi) || mapEntities().decor;
    }
    const sample = sh.st - this.now();
    if (!this.haveOffset || sample > this.offset) this.offset = sample;
    else this.offset += (sample - this.offset) * 0.02;
    this.haveOffset = true;
    const last = this.snaps[this.snaps.length - 1];
    if (!last || sh.st > last.st) {
      const a = {};
      for (const [coll, bot] of [[ents.players || {}, false], [ents.bots || {}, true]]) for (const id in coll) {
        const e = coll[id];
        if (e.x === undefined) continue;
        a[id] = { x: e.x, y: e.y, z: e.z, yaw: e.yw, pitch: e.pt, vx: e.vx, vz: e.vz, g: e.g, dd: e.dd, gb: e.gb, w: e.w, k: e.k, n: String(e.n), f: e.f, d: e.d, bot };
      }
      this.snaps.push({ st: sh.st, a });
      while (this.snaps.length > 2 && this.snaps[1].st < sh.st - 1.5) this.snaps.shift();
    }
    const mask = v => typeof v === 'string' ? v.slice(1) : '';   // 'm' + digits (see Sim.mirror)
    this.shared = { mo: !!sh.mo, win: String(sh.win || ''), nt: sh.nt || 0, it: mask(sh.it), br: mask(sh.br) };
    let bi = 0;
    for (const d of this.decor) if (d.barrel) d.dead = this.shared.br[bi++] === '0';
    if (sh.dw !== this.dropsJson) {
      this.dropsJson = sh.dw || '[]';
      try { this.drops = JSON.parse(this.dropsJson).map(([id, ti, x, z]) => ({ id, type: ITEM_TYPES[ti], x, z })); } catch { this.drops = []; }
    }
    const me = (ents.players || {})[this.selfId];
    if (me && me.x !== undefined) this.reconcile(me);
  }

  // ---------- prediction ----------
  reconcile(e) {
    const P = this.P, wasDead = P.dead, first = !this.hasSelf;
    this.hasSelf = true;
    this.me = e;
    P.name = String(e.n); P.hp = e.hp; P.armor = e.ar; P.armorAbs = e.aa; P.rage = e.rg; P.frags = e.f; P.deaths = e.d;
    P.owned = [0, 1, 2, 3, 4, 5, 6].map(i => !!(e.ow & (1 << i)));
    const am = String(e.am || '').split(',');
    AMMO.forEach((k, i) => { P.ammo[k] = +am[i] || 0; });
    while (this.pending.length && this.pending[0].seq <= e.ack) this.pending.shift();
    P.dead = !!e.dd; P.gibbed = !!e.gb;
    if (P.dead) {
      P.x = e.x; P.y = e.y; P.z = e.z; P.vx = e.vx; P.vz = e.vz;
      if (!wasDead) this.onSelfDeath();
      return;
    }
    const ox = P.x, oy = P.y, oz = P.z;
    P.x = e.x; P.y = e.y; P.z = e.z; P.vx = e.vx; P.vy = e.vy; P.vz = e.vz; P.og = !!e.g; P.teleCd = e.tc;
    P.weapon = e.w; P.next = e.nx; P.switching = e.sw; P.cooldown = e.cd;
    for (const c of this.pending) { moveActor(P, c, c.dt, this.decor, null); weaponTick(P, c.dt, c.fire, c.w); }
    const dx = P.x - ox, dy = P.y - oy, dz = P.z - oz;
    if (wasDead || first || Math.hypot(dx, dy, dz) > 3) {
      this.prev = { x: P.x, y: P.y, z: P.z }; this.corr = { x: 0, y: 0, z: 0 };
      if (wasDead || first) this.onSelfSpawn(e.yw);
    } else {
      // hide the correction: keep the rendered position where it was and let the offset decay
      this.corr.x -= dx; this.corr.y -= dy; this.corr.z -= dz;
      this.prev.x += dx; this.prev.y += dy; this.prev.z += dz;
    }
  }
  // one fixed input step: predict locally, remember it, send it. Returns { moved flags, fire result, cmd }
  step(input, matchOver) {
    const P = this.P;
    const cmd = { seq: ++this.seq, dt: STEP_DT, f: input.f, s: input.s, jump: input.jump ? 1 : 0, yaw: r4(input.yaw), pitch: r4(input.pitch),
      fire: input.fire ? 1 : 0, w: input.w, rt: Math.round(this.renderST() * 1000) / 1000 };
    this.prev = { x: P.x, y: P.y, z: P.z };
    let flags = 0, fired = 0;
    if (this.hasSelf && !P.dead) {
      flags = moveActor(P, cmd, cmd.dt, this.decor, null);
      if (!matchOver) fired = weaponTick(P, cmd.dt, cmd.fire, cmd.w);
    }
    this.pending.push(cmd);
    if (this.pending.length > 120) this.pending.shift();
    this.conn.sendInput(cmd);
    return { flags, fired, cmd };
  }
  // smoothed render position of the local player (alpha = fraction of the current input step elapsed)
  renderPos(alpha, dt) {
    const P = this.P, k = Math.exp(-dt * 12);
    this.corr.x *= k; this.corr.y *= k; this.corr.z *= k;
    if (P.dead) return { x: P.x, y: P.y, z: P.z };
    return { x: this.prev.x + (P.x - this.prev.x) * alpha + this.corr.x, y: this.prev.y + (P.y - this.prev.y) * alpha + this.corr.y, z: this.prev.z + (P.z - this.prev.z) * alpha + this.corr.z };
  }

  // ---------- interpolation ----------
  sample(id, rst) {
    const S = this.snaps;
    if (!S.length) return null;
    let b = S.findIndex(s => s.st >= rst);
    if (b < 0) b = S.length - 1;
    const B = S[b].a[id], A = b > 0 ? S[b - 1].a[id] : null;
    if (!B) return A ? { ...A } : null;
    if (!A) return { ...B };
    const t0 = S[b - 1].st, t1 = S[b].st, k = Math.min(1, Math.max(0, (rst - t0) / (t1 - t0 || 1)));
    if (Math.hypot(B.x - A.x, B.z - A.z) > 4 || A.dd !== B.dd) return k < 0.5 ? { ...A } : { ...B };   // teleport / respawn: no streak
    let dy = B.yaw - A.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    return { ...A, x: A.x + (B.x - A.x) * k, y: A.y + (B.y - A.y) * k, z: A.z + (B.z - A.z) * k, yaw: A.yaw + dy * k, pitch: A.pitch + (B.pitch - A.pitch) * k, vx: B.vx, vz: B.vz };
  }
  // every other actor at render time rst
  remotes(rst) {
    const S = this.snaps;
    if (!S.length) return [];
    const out = [];
    for (const id in S[S.length - 1].a) {
      if (id === this.selfId) continue;
      const s = this.sample(id, rst);
      if (s) { s.id = id; out.push(s); }
    }
    return out;
  }
  // the roster from the newest snapshot (scoreboard)
  roster() {
    const S = this.snaps;
    if (!S.length) return [];
    return Object.entries(S[S.length - 1].a).map(([id, a]) => ({ id, name: a.n, frags: a.f, deaths: a.d, bot: a.bot, self: id === this.selfId }));
  }
  nameOf(id) {
    const S = this.snaps;
    for (let i = S.length - 1; i >= 0; i--) if (S[i].a[id]) return S[i].a[id].n;
    return '?';
  }
}
