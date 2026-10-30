// ---- Multiplayer Agent room handlers. tools/build-logic.mjs appends this to maps.js + sim.js (imports/exports stripped). ----
// The Sim working copy lives in a top-level variable; every tick it is mirrored into the plain-JSON `state` the platform syncs.
let sim = null;

function ensureSim() {
  if (sim) return sim;
  sim = new Sim({ slots: SLOTS, diff: 1, mix: true, rotate: true, now: () => Date.now() / 1000 });
  state.entities.players = state.entities.players || {};
  state.entities.bots = {};
  sim.startMap(0);
  // logic restarted while players were connected: take them back in
  for (const id of Object.keys(state.entities.players)) sim.addHuman(id, state.entities.players[id].n);
  sim.fillBots(false);
  sim.ev.length = 0;
  return sim;
}

// batch this tick's events into as few emits as possible, each under the payload cap
function flushEvents() {
  if (!sim.ev.length) return;
  const st = Math.round(sim.t * 1000) / 1000;
  let batch = [], len = 0;
  for (const e of sim.ev) {
    const n = JSON.stringify(e).length + 1;
    if (batch.length && len + n > 1700) { emit('ev', { st, e: batch }); batch = []; len = 0; }
    batch.push(e); len += n;
  }
  if (batch.length) emit('ev', { st, e: batch });
  sim.ev.length = 0;
}

function onJoin(id) {
  ensureSim();
  sim.addHuman(id, 'PLAYER');
  sim.mirror(state);
}

function onLeave(id) {
  ensureSim();
  const a = sim.byId[id];
  if (a) { sim.e('j', `${a.name} LEFT`); sim.removeActor(id); }
  delete state.entities.players[id];
  sim.fillBots(true);
  sim.mirror(state);
}

function onInput(id, input) {
  ensureSim();
  if (input && typeof input === 'object') sim.input(id, input);
}

function onEvent(id, type, data) {
  ensureSim();
  if (type === 'hello') sim.setName(id, data && data.name);
  else if (type === 'respawn') sim.requestRespawn(id);
  else if (type === 'ping') emitTo(id, 'pong', { c: data && data.c, st: Math.round(sim.t * 1000) / 1000 });
}

function onTick(dt) {
  ensureSim();
  if (dt > 2) dt /= 1000; // tolerate a millisecond tick delta
  dt = Math.min(Math.max(+dt || 0, 0), 0.1);
  sim.tick(dt);
  sim.mirror(state);
  flushEvents();
}
