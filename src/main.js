// Entry point: boot, input, state machine (title -> connecting -> playing <-> paused) and the frame loop.
// Online and practice share one path: a connection (net.js) feeds the client netcode (client.js), which feeds the view (game.js).
import { THREE, G, ART, ui, ctx, camera, renderer, scene, resize, renderFrame, compileScene, postMat, loadAssets, onResize, rand, clamp, drawText } from './core.js';
import { A } from './audio.js';
import { WEAPONS, DIFFICULTIES, EYE, los } from './sim.js';
import { MAPS } from './maps.js';
import { animateLiquids, animateSky, sky } from './world.js';
import { V, loadLevel, syncActors, syncWorld, updateView, localShot, onEvent } from './game.js';
import { drawHUD, drawTitle, drawLoading, buildBar } from './ui.js';
import { LocalConn, OnlineConn } from './net.js';
import { Client, STEP_DT } from './client.js';

const SENS = 0.0022;
const keys = {};
let mouseDown = false, viewY = 0, viewYaw = 0, viewPitch = 0, wantWeapon = -1, stepAcc = 0;
let conn = null, client = null, lastHp = 100, needCompile = false;
const savedMenu = (() => { try { return JSON.parse(localStorage.getItem('dread_menu')) || {}; } catch { return {}; } })();
const urlName = new URLSearchParams(location.search).get('name');
if (urlName) localStorage.setItem('dread_name', urlName);
Object.assign(G, {
  menu: { mode: 0, map: 0, bots: 5, diff: 1, omap: -1, odiff: -1, row: 0, ...savedMenu }, name: localStorage.getItem('dread_name') || '',
  shake: 0, feed: [], center: null, match: { over: false, map: 0 }, roster: [], practice: false, netStatus: '', menuError: '',
  player: { pos: { x: 0, z: 0 }, vel: { x: 0, z: 0 }, y: 0, yaw: 0, pitch: 0, onGround: true, bob: 0, stepAcc: 0, dead: true, deathT: 0, hp: 100, armor: 0, armorAbs: 0,
    rage: 0, weapon: 1, next: 1, switching: 0, ammo: { shells: 0, bullets: 0, rockets: 0, cells: 0 }, owned: [true, true], frags: 0, lastShot: -9, shotN: 0, grin: 0, hurt: 0, pick: 0 },
});
G.centerMsg = (text, t) => { G.center = { text, t }; };

onResize.push(buildBar);
resize();

// ---------- input ----------
function askName() {
  const n = prompt('Your name for online deathmatch (max 12 letters):', G.name || '');
  if (n === null) return false;
  G.name = n.toUpperCase().replace(/[^A-Z0-9 .!?'-]/g, '').trim().slice(0, 12) || 'PLAYER';
  localStorage.setItem('dread_name', G.name);
  return true;
}
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'Tab') e.preventDefault();
  if (G.state === 'title') {
    const mn = G.menu, online = mn.mode === 0;
    // online the bot count is fixed (rooms fill to 6), so that row is skipped
    const rows = online ? [0, 1, 3] : [0, 1, 2, 3], ri = Math.max(0, rows.indexOf(mn.row));
    if (e.code === 'ArrowUp' || e.code === 'KeyW') mn.row = rows[(ri + rows.length - 1) % rows.length];
    if (e.code === 'ArrowDown' || e.code === 'KeyS') mn.row = rows[(ri + 1) % rows.length];
    const step = e.code === 'ArrowLeft' || e.code === 'KeyA' ? -1 : e.code === 'ArrowRight' || e.code === 'KeyD' ? 1 : 0;
    // online map / difficulty also offer -1 = DEFAULT (keep the room's rotation / mixed bots)
    const cycle = (v, n) => ((v + 1 + step + n + 1) % (n + 1)) - 1;
    if (step) {
      if (mn.row === 0) mn.mode = 1 - mn.mode;
      else if (mn.row === 1) { if (online) mn.omap = cycle(mn.omap, MAPS.length); else mn.map = (mn.map + MAPS.length + step) % MAPS.length; }
      else if (mn.row === 2) mn.bots = clamp(mn.bots + step, 1, 7);
      else if (online) mn.odiff = cycle(mn.odiff, DIFFICULTIES.length);
      else mn.diff = (mn.diff + DIFFICULTIES.length + step) % DIFFICULTIES.length;
      A.init(); A.click();
    }
    if (e.code === 'KeyN' && online) askName();
    localStorage.setItem('dread_menu', JSON.stringify({ mode: mn.mode, map: mn.map, bots: mn.bots, diff: mn.diff, omap: mn.omap, odiff: mn.odiff }));
    return;
  }
  if (G.state === 'paused' && e.code === 'KeyQ') { quitToTitle(); return; }
  if (G.state !== 'playing') return;
  const m = /^Digit([1-7])$/.exec(e.code);
  if (m) requestWeapon(+m[1] - 1);
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouseDown = false; });
addEventListener('mousemove', e => {
  if (G.state !== 'playing' || document.pointerLockElement !== ui || G.player.dead) return;
  viewYaw -= e.movementX * SENS;
  viewPitch = clamp(viewPitch - e.movementY * SENS, -1.45, 1.45);
});
addEventListener('mousedown', e => {
  if (e.button !== 0 || G.state !== 'playing') return;
  mouseDown = true;
  if (G.player.dead && G.player.deathT > 1 && !G.match.over) conn.send('respawn');
});
addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
addEventListener('wheel', e => {
  if (G.state !== 'playing' || !client) return;
  const P = client.P;
  let i = P.switching > 0 ? P.next : P.weapon;
  for (let k = 0; k < 7; k++) { i = (i + (e.deltaY > 0 ? 1 : 6)) % 7; if (P.owned[i]) break; }
  requestWeapon(i);
});
addEventListener('contextmenu', e => e.preventDefault());
function requestWeapon(i) {
  const P = client && client.P;
  if (!P || !P.owned[i] || (i === P.weapon && P.switching <= 0) || (i === P.next && P.switching > 0)) return;
  wantWeapon = i;
  A.click();
}
const lock = () => { const r = ui.requestPointerLock(); if (r && r.catch) r.catch(() => {}); };
ui.addEventListener('click', () => {
  A.init();
  if (G.state === 'title') {
    if (G.menu.mode === 0 && !G.name && !askName()) return;
    startGame();
  } else if (G.state === 'paused') lock();
  else if (G.state === 'playing' && G.match.over && G.practice && G.match.overT > 3) conn.send('next');
  else if (G.state === 'playing' && document.pointerLockElement !== ui) lock();
});
document.addEventListener('pointerlockchange', () => {
  if (document.pointerLockElement === ui) { if (G.state === 'paused') G.state = 'playing'; }
  else if (G.state === 'playing' && !G.match.over) { G.state = 'paused'; mouseDown = false; }
});

// ---------- game flow ----------
async function startGame() {
  G.menuError = '';
  G.practice = G.menu.mode === 1;
  G.state = 'connecting';
  G.feed = []; G.center = null; G.netStatus = ''; G.roster = [];
  G.match = { over: false, map: G.menu.map, overT: 0 };
  lock();
  conn = G.practice ? new LocalConn({ map: G.menu.map, bots: G.menu.bots, diff: G.menu.diff }) : new OnlineConn(G.name, { map: G.menu.omap, diff: G.menu.odiff });
  client = new Client(conn);
  client.onMap = mi => {
    G.match.map = mi; G.menu.map = G.practice ? mi : G.menu.map;
    const decor = loadLevel(mi);
    needCompile = true;
    return decor;
  };
  client.onSelfDeath = () => { G.player.deathT = 0; };
  client.onSelfSpawn = yaw => { viewYaw = yaw; viewPitch = 0; viewY = client.P.y + EYE; stepAcc = 0; };
  try {
    await conn.start({
      state: s => client.onState(s),
      events: d => { const age = Math.max(0, client.serverNow() - d.st); for (const e of d.e) onEvent(e, { selfId: client.selfId, nameOf: id => client.nameOf(id), age }); },
      status: t => { G.netStatus = t; },
    });
    V.selfId = conn.selfId;
  } catch (err) {
    console.error(err);
    G.menuError = 'COULD NOT CONNECT: ' + String(err && err.message || err).toUpperCase().slice(0, 40);
    conn = client = null;
    G.state = 'title';
    if (document.pointerLockElement) document.exitPointerLock();
  }
}
function quitToTitle() {
  if (conn) conn.leave();
  conn = client = null;
  G.state = 'title';
}
async function finishEntering() {
  G.state = 'entering';
  needCompile = false;
  updateCamera(0, client.renderPos(1, 0));
  try { await compileScene(); } catch (e) { console.warn('shader precompile failed', e); }
  if (G.state === 'entering') G.state = document.pointerLockElement === ui ? 'playing' : 'paused';
}

// ---------- per-frame ----------
function readInput() {
  let f = 0, s = 0;
  if (keys.KeyW || keys.ArrowUp) f++;
  if (keys.KeyS || keys.ArrowDown) f--;
  if (keys.KeyD || keys.ArrowRight) s++;
  if (keys.KeyA || keys.ArrowLeft) s--;
  const live = G.state === 'playing';
  const inp = { f: live ? f : 0, s: live ? s : 0, jump: live && !!keys.Space, yaw: viewYaw, pitch: viewPitch, fire: live && mouseDown && !G.match.over, w: wantWeapon };
  wantWeapon = -1;
  return inp;
}
function inputStep() {
  const P = client.P, r = client.step(readInput(), G.match.over);
  if (r.flags & 1) A.jump(P.x, P.z, 110);
  if (r.flags & 2) A.land(P.x, P.z);
  if (r.flags & 4) viewYaw = P.yaw;   // teleporters set the facing
  if (r.fired === 1) G.shots = (G.shots || 0) + 1;
  if (r.fired === 1) localShot({ x: P.x, y: P.y, z: P.z, yaw: r.cmd.yaw, pitch: r.cmd.pitch, weapon: P.weapon }, r.cmd);
  else if (r.fired === 2) A.empty();
}
// copy the predicted actor + server-owned stats into the object the HUD and camera read
function syncSelf(rp, dt) {
  const P = client.P, p = G.player;
  if (P.hp < lastHp && !P.dead) p.hurt = Math.min(1, p.hurt + (lastHp - P.hp) / 40);
  lastHp = P.hp;
  const hs = Math.hypot(P.vx, P.vz);
  if (!P.dead && P.og && hs > 1) { p.bob += dt * hs * 0.95; p.stepAcc += hs * dt; if (p.stepAcc > 2.4) { p.stepAcc = 0; A.footstep(rp.x, rp.z); } }
  if (P.dead) p.deathT += dt;
  Object.assign(p, { y: rp.y, yaw: viewYaw, pitch: viewPitch, onGround: P.og, dead: P.dead, hp: P.hp, armor: P.armor, armorAbs: P.armorAbs, rage: P.rage,
    weapon: P.weapon, next: P.next, switching: P.switching, ammo: P.ammo, owned: P.owned, frags: P.frags });
  p.pos.x = rp.x; p.pos.z = rp.z; p.vel.x = P.vx; p.vel.z = P.vz;
  const sv = V.actors.get(client.selfId);
  if (sv) { p.lastShot = sv.lastShot; p.shotN = sv.shotN; }
  p.hurt = Math.max(0, p.hurt - dt * 1.5);
  p.pick = Math.max(0, p.pick - dt * 3);
  if (p.grin > 0) p.grin -= dt;
}
function updateCamera(dt, rp) {
  const p = G.player;
  if (p.dead) {
    viewY += (rp.y + 0.35 - viewY) * Math.min(1, dt * 4);
    camera.position.set(rp.x, viewY, rp.z);
    camera.rotation.set(viewPitch * 0.5, viewYaw, Math.min(0.7, p.deathT * 1.5));
    return;
  }
  const target = rp.y + EYE;
  viewY = Math.abs(target - viewY) > 1.2 ? target : viewY + (target - viewY) * Math.min(1, dt * 16);
  const hs = Math.hypot(p.vel.x, p.vel.z);
  const sh = G.shake * G.shake * 0.04;
  camera.position.set(rp.x, viewY + Math.sin(p.bob * 2) * 0.05 * Math.min(1, hs / 6) * (p.onGround ? 1 : 0), rp.z);
  camera.rotation.set(viewPitch + rand(-sh, sh), viewYaw + rand(-sh, sh), 0);
  G.shake = Math.max(0, G.shake - dt * 2.5);
  A.listener.x = rp.x; A.listener.z = rp.z; A.listener.yaw = viewYaw;
}
function tint() {
  const p = G.player, v = postMat.uniforms.tint.value;
  const hurt = Math.min(0.6, p.hurt * 0.55 + (p.dead ? 0.3 : 0));
  if (hurt > p.pick * 0.25) v.set(0.75, 0, 0, hurt);
  else if (p.pick > 0) v.set(0.9, 0.8, 0.3, p.pick * 0.25);
  else if (p.rage > 0) v.set(0.6, 0.1, 0.8, 0.12 + 0.04 * Math.sin(G.time * 6));
  else v.set(0, 0, 0, 0);
}

const clock = new THREE.Clock();
let loadFrac = 0, lastError = null, errorCount = 0;
function showError() {
  if (!lastError) return;
  ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(0, 0, G.LW, 22);
  drawText(`ERROR (${errorCount}): ${lastError}`.slice(0, 70), 3, 3, '#ff5040');
  drawText('PLEASE REPORT THIS MESSAGE', 3, 12, '#a89888');
}
renderer.domElement.addEventListener('webglcontextlost', e => {
  e.preventDefault();
  G.state = 'ctxlost';
  setTimeout(() => location.reload(), 2500);
});
function loop() {
  requestAnimationFrame(loop);
  try { frame(); } catch (e) {
    errorCount++;
    if (lastError !== e.message) { lastError = e.message; console.error(e); }
  }
  showError();
}
function blackScreen(text) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, G.LW, ui.height);
  drawText(text, G.LW / 2, 110, '#e03020', 1, 'center');
}
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  G.time += dt;
  if (G.state === 'error') return;
  ctx.clearRect(0, 0, G.LW, ui.height);
  if (G.state === 'loading') { drawLoading(loadFrac); return; }
  if (G.state === 'title') { drawTitle(); return; }
  if (G.state === 'ctxlost') { blackScreen('GRAPHICS DRIVER RESET - RELOADING'); return; }
  if (!conn || !client) return;
  // practice pauses the world; online the room keeps running, so keep sending (idle) inputs
  const running = !(G.practice && G.state === 'paused');
  if (running) conn.update(dt);
  if (G.state === 'connecting') {
    if (client.hasSelf && client.mi >= 0) finishEntering();
    blackScreen(G.practice ? `ENTERING ${MAPS[G.menu.map].name}` : 'CONNECTING TO THE ARENA...');
    return;
  }
  if (needCompile && G.state !== 'entering') { finishEntering(); }
  if (G.state === 'entering') { blackScreen(`ENTERING ${MAPS[G.match.map].name}`); if (running) { stepAcc += dt; while (stepAcc >= STEP_DT) { stepAcc -= STEP_DT; client.step({ f: 0, s: 0, yaw: viewYaw, pitch: viewPitch, w: -1 }, true); } } return; }
  if (running) {
    stepAcc = Math.min(stepAcc + dt, 0.25);
    while (stepAcc >= STEP_DT) { stepAcc -= STEP_DT; inputStep(); }
  }
  // match state from the room
  const sh = client.shared;
  if (sh.mo && !G.match.over) G.match.overT = 0;
  if (!sh.mo) G.match.winnerId = null;
  G.match.over = sh.mo; G.match.nt = sh.nt; G.match.winnerName = sh.win;
  G.match.won = sh.mo && (G.match.winnerId ? G.match.winnerId === client.selfId : sh.win === client.P.name);
  if (G.match.over) G.match.overT += dt;
  G.roster = client.roster();
  // actors: remote ones interpolated in the past, ourselves predicted
  V.selfId = client.selfId = conn.selfId;
  const rp = client.renderPos(running ? stepAcc / STEP_DT : 1, dt);
  syncSelf(rp, dt);
  const P = client.P;
  const samples = client.remotes(client.renderST());
  samples.push({ id: client.selfId, x: rp.x, y: rp.y, z: rp.z, yaw: viewYaw, pitch: viewPitch, vx: P.vx, vz: P.vz, g: P.og ? 1 : 0, dd: P.dead ? 1 : 0, gb: P.gibbed ? 1 : 0, w: P.weapon, k: (client.me && client.me.k) || 1 });
  syncActors(samples, dt);
  syncWorld(sh.it, client.drops);
  updateView(dt);
  animateLiquids(dt);
  animateSky();
  G.feed.forEach(m => m.t -= dt);
  G.feed = G.feed.filter(m => m.t > 0);
  if (G.center) { G.center.t -= dt; if (G.center.t <= 0) G.center = null; }
  updateCamera(dt, rp);
  tint();
  renderFrame();
  drawHUD(keys);
}
loop();
loadAssets(f => { loadFrac = f; }).then(() => {
  // upload every texture to the GPU now, so sprites don't hitch the first time they appear
  for (const frames of Object.values(ART.sprites)) for (const f of frames) renderer.initTexture(f.tex);
  for (const t of [...Object.values(ART.tex), ...Object.values(ART.sky)]) renderer.initTexture(t);
  G.state = 'title';
}).catch(err => {
  console.error(err);
  G.state = 'error';
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, G.LW, ui.height);
  drawText('FAILED TO LOAD ASSETS', G.LW / 2, 100, '#ff4040', 1, 'center');
  drawText('RUN PLAY.BAT (NEEDS A LOCAL SERVER)', G.LW / 2, 114, '#a89888', 1, 'center');
});

// test hook for automated checks
window.__dread = { G, V, keys, los, scene, sky, renderer, get client() { return client; }, get conn() { return conn; }, startGame, setView: (y, p) => { viewYaw = y; viewPitch = p; } };
