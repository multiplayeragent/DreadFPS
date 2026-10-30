// Runs dist/dread_logic.js in a sandbox the way the room host does: plain-JSON state, emit/emitTo, synchronous handlers.
// Two scripted humans join, walk/shoot, one leaves; checks bot fill/kick, JSON state, event sizes and handler timings.
// Usage: node tools/test-logic.mjs [gameSeconds]
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const secs = +process.argv[2] || 240;
const code = readFileSync(new URL('../dist/dread_logic.js', import.meta.url), 'utf8');
const events = [], counts = {};
let fakeNow = 1e12; // the host's wall clock, advanced 50 ms per simulated tick
let maxPayload = 0;
const ctx = {
  state: { shared: {}, entities: { players: {} } },
  emit: (type, data) => { const n = JSON.stringify(data).length; maxPayload = Math.max(maxPayload, n); if (n > 2048) throw new Error('payload too big ' + n); events.push(data); for (const e of data.e) counts[e[0]] = (counts[e[0]] || 0) + 1; },
  emitTo: () => {}, Math, JSON, Date: { now: () => fakeNow }, console,
};
vm.createContext(ctx);
vm.runInContext(code, ctx, { timeout: 2000 });
const call = (name, ...args) => { const t0 = performance.now(); ctx[name](...args); return performance.now() - t0; };
const times = { onTick: [], onInput: [] };
const roster = () => Object.values(ctx.state.entities.players).map(p => p.n).concat(Object.values(ctx.state.entities.bots).map(b => b.n + '(bot)'));

call('onJoin', 'h1'); ctx.onEvent('h1', 'hello', { name: 'nate' });
console.log('after h1 join:', roster().join(', '));
call('onJoin', 'h2'); ctx.onEvent('h2', 'hello', { name: 'Tester' });
console.log('after h2 join:', roster().join(', '));
const kicks = events.flatMap(b => b.e).filter(e => e[0] === 'j').map(e => e[1]);
console.log('announcements:', kicks.join(' | '));

let seq1 = 0, seq2 = 0, t = 0, maps = new Set();
for (let tick = 0; tick < secs * 20; tick++) {
  // ~1.5 inputs per 50 ms tick at 30 Hz
  for (let k = 0; k < (tick % 2 ? 2 : 1); k++) {
    const st = ctx.state.shared.st;
    times.onInput.push(call('onInput', 'h1', { seq: ++seq1, dt: 1 / 30, f: 1, s: Math.sin(t) > 0 ? 1 : -1, jump: tick % 40 === 0, yaw: t * 0.7, pitch: 0, fire: true, w: tick % 200 === 0 ? 5 : -1, rt: st - 0.1 }));
    if (tick < secs * 10) times.onInput.push(call('onInput', 'h2', { seq: ++seq2, dt: 1 / 30, f: 0.5, s: 0, jump: false, yaw: -t, pitch: 0.05, fire: tick % 3 === 0, w: -1, rt: st - 0.1 }));
    t += 1 / 30;
  }
  if (tick === secs * 10) { call('onLeave', 'h2'); console.log('after h2 leave:', roster().join(', ')); }
  if (ctx.state.entities.players.h1 && ctx.state.entities.players.h1.dd && tick % 30 === 0) ctx.onEvent('h1', 'respawn', {});
  fakeNow += 50;
  times.onTick.push(call('onTick', 50));
  maps.add(ctx.state.shared.mi);
  JSON.parse(JSON.stringify(ctx.state)); // must stay plain JSON
}
const stat = a => { const s = [...a].sort((x, y) => x - y); return `avg ${(a.reduce((x, y) => x + y, 0) / a.length).toFixed(3)}ms p99 ${s[Math.floor(s.length * 0.99)].toFixed(3)}ms max ${s[s.length - 1].toFixed(3)}ms`; };
console.log('onTick', stat(times.onTick));
console.log('onInput', stat(times.onInput));
console.log('event counts', JSON.stringify(counts));
console.log('max emit payload', maxPayload, 'chars; maps visited', [...maps].join(','));
console.log('scores', Object.values(ctx.state.entities.players).concat(Object.values(ctx.state.entities.bots)).map(a => `${a.n}:${a.f}/${a.d}`).join(' '));
const fields = Math.max(...Object.values(ctx.state.entities.bots).map(b => Object.keys(b).length));
console.log('fields per entity', fields, '| shared', JSON.stringify(ctx.state.shared).length, 'chars', '| state', JSON.stringify(ctx.state).length, 'chars');
if (ctx.state.shared.__error) console.log('ERROR', ctx.state.shared.__error);
