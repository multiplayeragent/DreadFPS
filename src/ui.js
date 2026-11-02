// HUD, weapon view, scoreboard and menus, drawn on the low-res 2D canvas.
import { G, ctx, ART, LOW_H, BAR, drawText, textW, cv, mulberry, clamp, rand } from './core.js';
import { WEAPONS, FRAG_LIMIT, DIFFICULTIES, M, idx } from './sim.js';
import { MAPS } from './maps.js';
import { V } from './game.js';

let barBg = null;
const BX = () => Math.floor((G.LW - 320) / 2);
export function buildBar() {
  barBg = cv(G.LW, BAR);
  const g = barBg.getContext('2d'), r = mulberry(5);
  g.fillStyle = '#3a2e26'; g.fillRect(0, 0, G.LW, BAR);
  for (let i = 0; i < G.LW * BAR / 2; i++) { g.fillStyle = r() < 0.5 ? '#2a201a' : '#4a3a2e'; g.fillRect((r() * G.LW) | 0, (r() * BAR) | 0, 1, 1); }
  g.fillStyle = '#6a5040'; g.fillRect(0, 0, G.LW, 1); g.fillStyle = '#140e0a'; g.fillRect(0, 1, G.LW, 1);
  const x0 = BX();
  [[0, 36], [36, 58], [94, 58], [152, 74], [226, 50], [276, 44]].forEach(([sx, sw]) => {
    const x = x0 + sx + 1, y = 3, w = sw - 2, h = BAR - 5;
    g.fillStyle = '#1e1612'; g.fillRect(x, y, w, h);
    g.fillStyle = '#0c0806'; g.fillRect(x, y, w, 1); g.fillRect(x, y, 1, h);
    g.fillStyle = '#6a5446'; g.fillRect(x, y + h - 1, w, 1); g.fillRect(x + w - 1, y, 1, h);
  });
  drawText('HEALTH', x0 + 65, BAR - 10, '#a89888', 1, 'center', '#000', g);
  drawText('ARMOR', x0 + 123, BAR - 10, '#a89888', 1, 'center', '#000', g);
  drawText('FRAGS', x0 + 251, BAR - 10, '#a89888', 1, 'center', '#000', g);
}

function icon(sheet, i, x, y, h) {
  const fr = ART.sprites[sheet][i], s = h / fr.h;
  ctx.drawImage(fr.img, Math.round(x - fr.w * s / 2), Math.round(y - fr.h * s), Math.round(fr.w * s), Math.round(fr.h * s));
}
const AMMO_ICON = { shells: 0, bullets: 1, rockets: 2, cells: 3 };

function rank() {
  const sorted = [...G.roster].sort((a, b) => b.frags - a.frags);
  return sorted.findIndex(a => a.self) + 1;
}
const ord = n => n + (n === 1 ? 'ST' : n === 2 ? 'ND' : n === 3 ? 'RD' : 'TH');

function drawBar() {
  const p = G.player, y0 = G.VH, x0 = BX(), red = '#e03020';
  ctx.drawImage(barBg, 0, y0);
  // face
  const faces = ART.sprites.face;
  let fi = p.dead ? 5 : (p.grin > 0 || p.rage > 0) ? 4 : p.hp > 75 ? 0 : p.hp > 50 ? 1 : p.hp > 25 ? 2 : 3;
  const f = faces[fi];
  ctx.drawImage(f.img, x0 + 18 - Math.round(f.w / 2), y0 + 1);
  drawText(Math.max(0, Math.ceil(p.hp)), x0 + 65, y0 + 5, p.hp > 25 ? red : '#ff6040', 2, 'center');
  drawText(p.armor, x0 + 128, y0 + 5, red, 2, 'center');
  if (p.armor > 0) icon('pick_items1', p.armorAbs > 0.5 ? 4 : 3, x0 + 101, y0 + 20, 13);
  // ammo + current weapon
  const w = WEAPONS[p.weapon];
  if (w.ammo) { icon('pick_items2', AMMO_ICON[w.ammo], x0 + 166, y0 + 22, 15); drawText(p.ammo[w.ammo], x0 + 200, y0 + 5, red, 2, 'center'); }
  drawText(w.name.length > 12 ? w.name.split(' ')[0] : w.name, x0 + 189, BAR - 10 + y0, '#a89888', 1, 'center');
  drawText(p.frags, x0 + 251, y0 + 5, '#ffe040', 2, 'center');
  // weapon slots
  for (let i = 0; i < 7; i++) {
    const col = !p.owned[i] ? '#4a3a30' : i === p.weapon ? '#ffffff' : '#d0a040';
    drawText(String(i + 1), x0 + 282 + (i % 4) * 9, y0 + 7 + Math.floor(i / 4) * 10, col);
  }
  if (p.rage > 0) drawText(`RAGE ${Math.ceil(p.rage)}`, x0 + 298, y0 + 26, '#e060ff', 1, 'center');
}

// ---------- tesla idle: arcs crackle off the coil tips and the glass tube pulses while it sits in your hands ----------
const TESLA_EMIT = [[25, 9], [50, 7], [76, 9]];      // coil balls + centre tip, in idle-frame pixels
const tesla = { next: 0, arcs: [] };
function pxLine(x0, y0, x1, y1, col) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let e = dx + dy;
  ctx.fillStyle = col;
  for (let n = 0; n < 64; n++) {
    ctx.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * e;
    if (e2 >= dy) { e += dy; x0 += sx; }
    if (e2 <= dx) { e += dx; y0 += sy; }
  }
}
function jagged(ax, ay, bx, by, segs) {
  const pts = [[ax, ay]];
  for (let i = 1; i < segs; i++) { const t = i / segs; pts.push([ax + (bx - ax) * t + rand(-2, 2), ay + (by - ay) * t + rand(-2, 2)]); }
  pts.push([bx, by]);
  return pts;
}
function teslaIdle(x0, y0) {
  if (G.time >= tesla.next) {
    tesla.next = G.time + rand(0.04, 0.09);
    tesla.arcs = [];
    TESLA_EMIT.forEach(([ex, ey], i) => {
      if (Math.random() < 0.35) return;
      const ang = -Math.PI / 2 + (i - 1) * 0.7 + rand(-0.9, 0.9), len = rand(3, 8);
      tesla.arcs.push(jagged(ex, ey, ex + Math.cos(ang) * len, ey + Math.sin(ang) * len, 3));
    });
    // now and then a bolt jumps from a coil ball to the centre tip
    if (Math.random() < 0.22) { const [ex, ey] = TESLA_EMIT[Math.random() < 0.5 ? 0 : 2]; tesla.arcs.push(jagged(ex, ey, TESLA_EMIT[1][0], TESLA_EMIT[1][1], 5)); }
  }
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = `rgba(70,140,255,${(0.16 + 0.1 * Math.sin(G.time * 9) + Math.random() * 0.06).toFixed(3)})`;
  ctx.fillRect(x0 + 45, y0 + 42, 11, 27);
  for (const pts of tesla.arcs) for (let i = 1; i < pts.length; i++) {
    pxLine(x0 + pts[i - 1][0], y0 + pts[i - 1][1], x0 + pts[i][0], y0 + pts[i][1], i === 1 ? '#ffffff' : '#7fb4ff');
  }
  ctx.restore();
}

function drawWeaponView() {
  const p = G.player, w = WEAPONS[p.weapon], fr = ART.sprites['wpn_' + w.id], ft = G.time - p.lastShot;
  let k = 0, ry = 0;
  switch (w.id) {
    case 'axe': k = ft < 0.1 ? 1 : ft < 0.3 ? 2 : 0; break;
    case 'shotgun': k = ft < 0.08 ? 1 : ft > 0.22 && ft < 0.45 ? 2 : 0; if (ft >= 0.08 && ft < 0.2) ry = -6; break;
    case 'sshotgun': k = ft < 0.1 ? 1 : ft > 0.3 && ft < 0.8 ? 2 : 0; if (ft >= 0.1 && ft < 0.3) ry = -8; break;
    case 'tommy': k = ft < 0.06 ? 1 + (p.shotN % 2) : 0; break;
    case 'grenade': k = ft < 0.1 ? 1 : ft < 0.35 ? 2 : 0; break;
    case 'rocket': k = ft < 0.1 ? 1 : ft < 0.4 ? 2 : 0; break;
    // the 3D beam shows the bolt; the view sprite just buzzes and kicks while firing
    case 'tesla': k = 0; if (ft < 0.15) ry = (Math.floor(G.time * 40) % 2) * 2 - 1; break;
  }
  const img = fr[k];
  const hs = Math.hypot(p.vel.x, p.vel.z), amt = Math.min(1, hs / 7) * (p.onGround ? 1 : 0.3);
  const bx = Math.cos(p.bob) * 7 * amt, by = Math.abs(Math.sin(p.bob)) * 6 * amt;
  let lower = p.switching > 0 ? (1 - Math.abs(p.switching / 0.3 * 2 - 1)) * 110 : 0;
  if (p.dead) lower = Math.min(140, p.deathT * 200);
  // light the sprite like the spot the player stands in
  const i = idx(p.pos.x, p.pos.z);
  let L = i >= 0 && M.c[i] < Infinity ? 0.62 : 0.92;
  for (const d of V.decor) if (d.light) L += Math.max(0, 1 - Math.hypot(d.x - p.pos.x, d.z - p.pos.z) / 9) * 0.35;
  if (ft < 0.08 && !w.melee) L += 0.175;
  // sit the weapons lower than the raw art so the crosshair area stays clear; the tesla drops further so its bolt shows
  const drop = w.id === 'tesla' ? 40 : 18;
  const top = G.VH - img.h + 8 + drop;
  G.teslaTip = w.id === 'tesla' ? G.VH - fr[0].h + 8 + drop + 6 + by + lower : null;
  ctx.filter = `brightness(${clamp(L, 0.5, 1.4).toFixed(2)})`;
  const sx = Math.round(G.LW / 2 - img.ax + bx), sy = Math.round(top + by + ry + lower);
  ctx.drawImage(img.img, sx, sy);
  ctx.filter = 'none';
  if (w.id === 'tesla' && !p.dead) teslaIdle(sx, sy);
}

function drawScoreboard(title) {
  const list = [...G.roster].sort((a, b) => b.frags - a.frags || a.deaths - b.deaths);
  const w = 220, h = 34 + list.length * 11, x = Math.round(G.LW / 2 - w / 2), y = Math.round(G.VH / 2 - h / 2 + 6);
  ctx.fillStyle = 'rgba(10,4,4,0.82)'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = '#6a3020'; ctx.fillRect(x, y, w, 1); ctx.fillRect(x, y + h - 1, w, 1);
  drawText(title, G.LW / 2, y + 5, '#e03020', 1, 'center');
  drawText('NAME', x + 8, y + 18, '#8a7a6a'); drawText('FRAGS', x + 150, y + 18, '#8a7a6a', 1, 'right'); drawText('DEATHS', x + 212, y + 18, '#8a7a6a', 1, 'right');
  list.forEach((a, i) => {
    const col = a.self ? '#ffe040' : '#d8cfc4', yy = y + 30 + i * 11;
    drawText(`${i + 1}. ${a.name}${a.bot && !G.practice ? ' (BOT)' : ''}`, x + 8, yy, col);
    drawText(a.frags, x + 150, yy, col, 1, 'right');
    drawText(a.deaths, x + 212, yy, col, 1, 'right');
  });
}

export function drawHUD(keys) {
  const p = G.player;
  if (!p.dead || p.deathT < 1) drawWeaponView();
  if (!p.dead && G.state === 'playing') {
    const cx = G.LW >> 1, cy = G.VH >> 1;
    ctx.fillStyle = 'rgba(230,220,200,0.8)';
    ctx.fillRect(cx - 4, cy, 3, 1); ctx.fillRect(cx + 2, cy, 3, 1); ctx.fillRect(cx, cy - 4, 1, 3); ctx.fillRect(cx, cy + 2, 1, 3);
  }
  G.feed.forEach((m, i) => { ctx.globalAlpha = clamp(m.t, 0, 1); drawText(m.text, 4, 4 + i * 9, m.color); });
  ctx.globalAlpha = 1;
  const leader = [...G.roster].sort((a, b) => b.frags - a.frags)[0];
  drawText(`FRAG LIMIT ${FRAG_LIMIT}`, G.LW - 4, 4, '#a89888', 1, 'right');
  if (leader) drawText(`LEADER ${leader.name} ${leader.frags}`, G.LW - 4, 13, leader.self ? '#ffe040' : '#e03020', 1, 'right');
  drawText(`YOU ${ord(rank())}`, G.LW - 4, 22, '#d8cfc4', 1, 'right');
  if (G.netStatus) drawText(G.netStatus, G.LW / 2, G.VH * 0.3 - 14, '#ff9030', 1, 'center');
  if (G.center) {
    ctx.globalAlpha = clamp(G.center.t / 0.4, 0, 1);
    drawText(G.center.text, G.LW / 2, G.VH * 0.3, '#e03020', 1, 'center');
    ctx.globalAlpha = 1;
  }
  if (p.dead && !G.match.over && p.deathT > 1) drawText('CLICK TO RESPAWN', G.LW / 2, G.VH * 0.3 + 14, '#d8cfc4', 1, 'center');
  drawBar();
  if (G.match.over) {
    const won = G.match.won;
    drawText(won ? 'YOU WIN!' : `${G.match.winnerName} WINS`, G.LW / 2, 14, won ? '#ffe040' : '#e03020', 3, 'center', '#300');
    drawScoreboard(MAPS[G.match.map].name);
    if (!G.practice) drawText(`NEXT MAP IN ${G.match.nt}`, G.LW / 2, G.VH - 18, '#d8cfc4', 1, 'center');
    else if (G.match.overT > 3) drawText('CLICK FOR THE NEXT MAP', G.LW / 2, G.VH - 18, '#d8cfc4', 1, 'center');
  } else if (keys.Tab || G.state === 'paused') drawScoreboard(G.state === 'paused' ? 'PAUSED - CLICK TO RESUME' : MAPS[G.match.map].name);
  if (G.state === 'paused') drawText(G.practice ? 'Q - QUIT TO MENU' : 'Q - LEAVE THE MATCH', G.LW / 2, G.VH - 14, '#a89888', 1, 'center');
}

export function drawTitle() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, G.LW, LOW_H);
  if (ART.title) {
    const s = Math.max(G.LW / ART.title.width, LOW_H / ART.title.height);
    ctx.drawImage(ART.title, (G.LW - ART.title.width * s) / 2, (LOW_H - ART.title.height * s) / 2, ART.title.width * s, ART.title.height * s);
  }
  ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, G.LW, LOW_H);
  const cx = G.LW / 2;
  ctx.globalAlpha = Math.random() < 0.04 ? 0.4 : 1;
  drawText('DREAD', cx, 14, '#c81a10', 6, 'center', '#300');
  ctx.globalAlpha = 1;
  drawText('DEATHMATCH', cx, 62, '#d8cfc4', 2, 'center');
  const mn = G.menu, diffCol = ['#80d060', '#ffe040', '#ff9030', '#ff3020'][mn.diff], online = mn.mode === 0;
  const rows = online
    ? [['MODE', 'ONLINE DEATHMATCH'], ['MAP', mn.omap < 0 ? 'DEFAULT' : MAPS[mn.omap].name], ['BOTS', 'FILL TO 6'], ['DIFFICULTY', mn.odiff < 0 ? 'DEFAULT (MIXED)' : DIFFICULTIES[mn.odiff].name]]
    : [['MODE', 'PRACTICE VS BOTS'], ['MAP', MAPS[mn.map].name], ['BOTS', mn.bots], ['DIFFICULTY', DIFFICULTIES[mn.diff].name]];
  const dcol = online ? (mn.odiff < 0 ? '#ffe040' : ['#80d060', '#ffe040', '#ff9030', '#ff3020'][mn.odiff]) : diffCol;
  rows.forEach(([label, val], i) => {
    const sel = mn.row === i, off = online && i === 2;
    const col = off ? '#4a3e36' : sel ? (i === 3 ? dcol : '#ffe040') : '#8a7a6a';
    drawText(sel && !off ? `${label}  < ${val} >` : `${label}  ${val}`, cx, 82 + i * 11, col, 1, 'center');
  });
  drawText(online ? `PLAYING AS ${G.name || '?'}   (N: CHANGE NAME)` : `FIRST TO ${FRAG_LIMIT} FRAGS WINS`, cx, 130, '#a89888', 1, 'center');
  if (G.menuError) drawText(G.menuError, cx, 164, '#ff5040', 1, 'center');
  else if (online) drawText('MAP + DIFFICULTY APPLY WHEN YOU OPEN AN EMPTY ROOM', cx, 166, '#7a6a5e', 1, 'center');
  if (Math.sin(G.time * 4) > -0.3) drawText(online ? 'CLICK TO JOIN' : 'CLICK TO FIGHT', cx, 146, '#ffffff', 2, 'center');
  ['UP/DOWN: SELECT    LEFT/RIGHT: CHANGE', 'WASD MOVE  SPACE JUMP  MOUSE AIM/FIRE', '1-7 / WHEEL WEAPONS  TAB SCORES  ESC PAUSE'].forEach((l, i) => drawText(l, cx, 180 + i * 11, '#b8a898', 1, 'center'));
  drawText(online ? 'SERVER-AUTHORITATIVE ON MULTIPLAYER AGENT' : 'OFFLINE PRACTICE', cx, 224, '#e03020', 1, 'center');
}

export function drawLoading(f) {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, G.LW, LOW_H);
  drawText('DREAD', G.LW / 2, 80, '#c81a10', 4, 'center');
  ctx.fillStyle = '#3a1a14'; ctx.fillRect(G.LW / 2 - 80, 140, 160, 6);
  ctx.fillStyle = '#e03020'; ctx.fillRect(G.LW / 2 - 80, 140, Math.round(160 * f), 6);
  drawText('SUMMONING...', G.LW / 2, 152, '#a89888', 1, 'center');
}
export { textW };
