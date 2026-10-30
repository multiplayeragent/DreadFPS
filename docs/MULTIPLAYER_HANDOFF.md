# DREAD → Multiplayer Agent: handoff

Everything a fresh session needs to make DREAD a hosted, server-authoritative multiplayer deathmatch.

## Current state (single-player, working)
- Retro sprite FPS (Quake/Blood/DOOM style) in Three.js r160, ES modules, 240p render + dither pass.
- Run locally: `PLAY.bat` (or `node serve.js` → http://localhost:8642). A server is required (WebGL won't use `file://` textures).
- Deathmatch vs bots, first to 15 frags, 3 maps that rotate: Gallows Hill, Slipgate Keep, Hellgate Outpost.
- Title menu: map / bot count (1–7) / difficulty (EASY, NORMAL, HARD, NIGHTMARE), saved in localStorage `dread_menu`.
- Art: generated with the Codex CLI, processed by `art/process.py` into `assets/` + `assets/manifest.json` (~1.8 MB: ~102 sprite PNGs, 16 textures, 3 skies, title). That is 132 files, over publish_game's 100-file cap → pack sprites into a few atlas PNGs in `process.py` and slice them into per-frame canvases at load time in `core.js loadAssets` (keep `ART.sprites[name][i] = { img, tex, w, h, ax }` unchanged for the rest of the code).

## Status (2026-10-29): multiplayer shipped
- Share link: https://dreaddeathmatch.play.multiplayeragent.com/ · rooms `dread-1..4` (maxClients 8, logic v4, tickRate 20).
- Sprites are packed into `assets/atlas_0.png` (`python art/process.py pack` rebuilds it from `art/frames/`); 33 hosted files.
- New layout: `src/sim.js` pure sim (grid/collision/nav, movement, weapons, lag-comp hitscan, projectiles, items, barrels, bots, match, `mirror(state)`);
  `server/glue.js` room handlers; `tools/build-logic.mjs` -> `dist/dread_logic.js`; `tools/test-logic.mjs` sandbox test (vm, fake clock);
  `src/net.js` LocalConn (practice, Sim at 60 Hz) / OnlineConn (MP SDK); `src/client.js` prediction + reconciliation + interpolation;
  `src/game.js` view only (sprites/fx/events); `bots.js` folded into sim.js.
- Deploy: build -> create_upload one copy per room -> curl.exe -> deploy_room_logic {uploadId} for dread-1..4. Host: publish_game mode "patch".
- Platform gotcha: all-digit string fields come back to clients as numbers (`"1101..."` -> `1.1e+25`), so masks are sent as `'m' + digits`.
- Online bots: per-bot difficulty, ~60% EASY / rest NORMAL (`Sim` option `mix`); kicks keep the ratio. Practice uses the menu difficulty.
- Room settings: the first human's hello carries `cfg { map, diff }` (-1 = default); `Sim.configure` applies it. Spawns face the most open direction (`openYaw`).
- Cosmetic, client-only: ejected shotgun shells, tesla idle crackle, sky weather (`animateSky`), muzzle flashes shrunk 50% at atlas pack time (`art/process.py shrink_flashes`).
- Verified: Chrome + Edge in the same room, bots kicked/re-added, prediction corrections < 0.1 units, lag-comp hits confirmed, map rotation, no room-log errors.

## File map (original single-player)
- `src/core.js` renderer, post pass, bitmap font, asset loading, shared `G` state
- `src/maps.js` map DSL + 3 maps (pure data, no imports): reusable on the server as-is
- `src/world.js` level geometry (Three.js) AND pure logic: grid heights, collision (`moveCollide`, `groundUnder`, `ceilOver`), `trace`/`los`, nav graph + `navSearch` (Dijkstra). Fixed light pool (14) so shaders never recompile on map change
- `src/game.js` Actor, weapons (7), projectiles, items, decor/barrels, damage/kill/respawn, tracers, tesla beam, match flow; `DIFFICULTIES`
- `src/bots.js` bot AI (perceive, item goals via nav, strafe, lead aim, weapon choice, stuck recovery)
- `src/ui.js` HUD/status bar/scoreboard/menus · `src/audio.js` synthesized audio · `src/main.js` input, state machine, loop
- Hard-won fixes to keep: `navSearch` uses **Float64Array** (Float32 rounding caused an infinite loop on Slipgate Keep) + an iteration guard; fixed light pool; shader precompile on map entry; textures pre-uploaded at load.

## Multiplayer Agent facts
- Connect the owner's account with `connect_account` (they log in on the page; never handle passwords in chat).
- Game: **DREAD Deathmatch** (its publishable key is in `index.html`). ALWAYS pass `game` to the tools: a studio can hold many games and unnamed calls fall back to the primary one.
- Endpoints: `wss://live.multiplayeragent.com`, apiUrl `https://api.multiplayeragent.com`, SDK `https://cdn.multiplayeragent.com/sdk/mp.global.js`. Read `get_sdk_reference` (with `game`) before coding.
- New tools (plugin ≥1.0.4): `create_upload({ game, files:[{path,size}] })` → per-file URLs; upload with `curl.exe -sS -T "<file>" "<url>"` (exact byte size, 15 min expiry); then `publish_game` with `{ path, uploadId }` for binaries and inline `{ path, content }` for text. `publish_game` also has `mode: "patch"` + `remove`. `deploy_room_logic` accepts `{ code }` or `{ uploadId }`; also `get_room_logs`, `list_room_logic`, `rollback_room_logic`.
- Server logic runs in a V8 isolate: synchronous handlers only (`onJoin`, `onLeave`, `onInput`, `onEvent`, `onTick(dt)`), no imports/fetch/timers, ≤256 KB, tickRate ≤60 (use 20), ≥25 ms kill budget per call, state must be plain JSON. `emit(type,data)`/`emitTo(id,...)` to clients. Bots belong in their own collection, e.g. `state.entities.bots`. Check whether `onTick` dt is seconds or ms (treat dt > 2 as ms).
- Limits: 64 fields per entity, 2048 chars per field/event payload, 60 client msgs/s, state broadcast ~20/s, room default 32 players.

## Multiplayer design (agreed with the user)
- **Server-authoritative.** Refactor the game rules out of rendering into a pure `src/sim.js` (+ `maps.js`) with no Three.js: Actor physics, weapons/hitscan/projectiles, items, barrels, damage, bots, match rules. A build script concatenates `maps.js` + `sim.js` (strip import/export) + handler glue into one logic file for `deploy_room_logic`. The same `Sim` also runs in the browser for offline practice (a LocalConn adapter with the same interface as the online connection).
- **Bots fill slots:** 6 slots per match. Bots fill empty slots; when a human joins, kick a bot (lowest frags) and show "X WAS KICKED TO MAKE ROOM"; when a human leaves, add a bot back. Room `maxClients` 8; the client tries `dread-1`, `dread-2`, … until a join succeeds (deploy the logic to each room name).
- **Inputs:** the client steps local movement at a fixed 30 Hz and sends `{ seq, dt, f, s, jump, yaw, pitch, fire, w, rt }` via `sendInput`. The server applies movement in `onInput` (dt clamped by a per-player time budget, to stop speed hacks) and echoes `ack = seq`. The client predicts its own movement with the same physics code and reconciles (snap to server, replay unacked inputs).
- **Remote actors:** interpolate ~100 ms in the past from a snapshot buffer keyed by `state.shared.st` (server time).
- **Lag compensation:** the server keeps ~0.6 s of position history per actor; hitscan/melee from humans rewinds targets to the shooter's render time `rt` (clamped ≤ 250–400 ms). Projectiles are not rewound.
- **Events:** the server batches per-tick events into one `emit('ev', { st, e: [...] })` (split if > ~1800 chars): shot, impacts (puffs/blood points), proj spawn (client simulates the visual, fast-forwarded by latency), boom, tesla on/off, kill (feed/gibs), pain, pickup, tele, item respawn, bot join/kick.
- **Shared state:** map index, match over/winner, server time `st`, item availability mask string, barrel mask, dropped weapons list. The map rotates automatically ~10 s after a win.
- The local player's muzzle flash, sound and view kick are predicted client-side; damage, ammo and frags come from the server.
- Player name: prompt once, store in localStorage, send via `send('hello', { name })`.

## Test plan (from the Multiplayer Agent team — report each result)
1. `list_games` shows `connectedAs` and DREAD.
2. Deploy the server logic with `deploy_room_logic`; check `get_room_logs`.
3. Host the full build with real art: list every asset with its exact byte size → one `create_upload` call → run every curl from the game folder (each prints `{"ok":true,...}`) → `publish_game` with text inline + `{ path, uploadId }` for assets → share link.
4. Open the share link in a real browser: art loads (no 404s) and the multiplayer join works (test with two different browsers, not two tabs).
5. Make a small visible change to one text file, republish only that file with `mode: "patch"`, and confirm the change is live and the art is still there.
If anything fails: report the tool name, the arguments (without file contents) and the full error. Don't fall back to inline base64.
