// Connections. Both expose the same interface, so the client code never knows whether it is online or offline:
//   start(handlers{ state(s), events({st,e}), status(text) }) -> Promise · update(dt) · sendInput(cmd) · send(type, data) · leave()
//   selfId · interp (seconds of remote interpolation delay) · practice
import { Sim, SLOTS } from './sim.js';

export const MP_CFG = {
  key: (window.DREAD_MP && window.DREAD_MP.key) || 'pk_live_0f841d4e97c4e3e7f1a26661f813c61a447cbc7c590c2ce6',
  endpoint: 'wss://live.multiplayeragent.com',
  apiUrl: 'https://api.multiplayeragent.com',
  rooms: 4,
};

// Offline practice: the authoritative Sim runs right here, ticking at 60 Hz, producing the same state + events a room would.
export class LocalConn {
  constructor({ map, bots, diff }) {
    this.practice = true;
    this.selfId = 'me';
    this.interp = 1.5 / 60;
    this.sim = new Sim({ slots: bots + 1, diff, rotate: false });
    this.sim.startMap(map);
    this.sim.addHuman('me', 'YOU');
    this.sim.fillBots(false);
    this.sim.ev.length = 0;
    this.state = { shared: {}, entities: { players: {}, bots: {} } };
    this.acc = 0;
  }
  async start(h) {
    this.h = h;
    this.publish();
  }
  publish() {
    this.sim.mirror(this.state);
    this.h.state(this.state);
    if (this.sim.ev.length) { this.h.events({ st: this.sim.t, e: this.sim.ev.slice() }); this.sim.ev.length = 0; }
  }
  update(dt) {
    const step = 1 / 60;
    this.acc = Math.min(this.acc + dt, 0.25);
    while (this.acc >= step) { this.acc -= step; this.sim.tick(step); this.publish(); }
  }
  sendInput(cmd) { this.sim.input('me', JSON.parse(JSON.stringify(cmd))); }
  send(type) {
    if (type === 'respawn') this.sim.requestRespawn('me');
    else if (type === 'next' && this.sim.match.over) { this.sim.nextMap(); this.publish(); }
  }
  leave() {}
}

// Online: authoritative room logic on Multiplayer Agent. Tries dread-1, dread-2, ... until a join succeeds.
export class OnlineConn {
  constructor(name, cfg) { this.practice = false; this.name = name; this.cfg = cfg; this.interp = 0.1; this.mp = null; }
  async start(h) {
    if (!window.MP) throw new Error('multiplayer sdk did not load');
    let lastErr = null;
    for (let n = 1; n <= MP_CFG.rooms && !this.mp; n++) {
      try {
        // a full room (maxClients) rejects the join, so this moves on to the next one
        this.mp = await window.MP.join({ key: MP_CFG.key, room: `dread-${n}`, endpoint: MP_CFG.endpoint, apiUrl: MP_CFG.apiUrl });
        this.room = `dread-${n}`;
      } catch (e) { lastErr = e; }
    }
    if (!this.mp) throw lastErr || new Error('all rooms are full');
    const mp = this.mp;
    this.selfId = mp.sessionId;
    mp.onState(s => h.state(s));
    mp.on('ev', d => h.events(d));
    if (mp.onDisconnect) mp.onDisconnect(() => h.status('CONNECTION LOST - RECONNECTING...'));
    if (mp.onReconnect) mp.onReconnect(() => h.status(''));
    mp.send('hello', { name: this.name, cfg: this.cfg });
    this.onHide = () => this.leave();
    addEventListener('pagehide', this.onHide);
    if (mp.state && mp.state.shared) h.state(mp.state);
  }
  update() {}
  sendInput(cmd) { if (this.mp) this.mp.sendInput(cmd); }
  send(type, data) { if (this.mp) this.mp.send(type, data || {}); }
  leave() {
    if (!this.mp) return;
    removeEventListener('pagehide', this.onHide);
    const mp = this.mp;
    this.mp = null;
    try { mp.leave(); } catch {}
  }
}
export { SLOTS };
