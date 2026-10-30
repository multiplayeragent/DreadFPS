# DREAD — Deathmatch

Retro sprite-based FPS in the spirit of Quake, Blood and DOOM. Online, server-authoritative deathmatch on
[Multiplayer Agent](https://github.com/multiplayeragent/multiplayer-agent), plus offline practice against bots. First to 15 frags wins.

**Play online:** https://dreaddeathmatch.play.multiplayeragent.com/

## Play locally

Double-click `PLAY.bat` (or run `node serve.js` and open http://localhost:8642). A local server is required because
browsers block WebGL textures loaded from `file://`. Three.js and the Multiplayer Agent SDK load from CDNs.

Controls: WASD move · Space jump · mouse aim/fire · 1–7 / wheel weapons · Tab scores · Esc pause.
Title screen: Left/Right on MODE switches between ONLINE DEATHMATCH and PRACTICE VS BOTS; practice also picks the map,
bot count (1–7) and difficulty. N changes your online name.

## Multiplayer

- Server-authoritative: the room logic is `src/maps.js` + `src/sim.js` + `server/glue.js`, built into one file.
  Clients send inputs only; damage, frags, ammo and pickups are decided on the server.
- 6 slots per room, filled by bots (online: mostly EASY, some NORMAL). A bot is kicked when a human joins and added back
  when one leaves. Rooms `dread-1`..`dread-4`, 8 clients max; the client tries them in order.
- Client-side prediction with reconciliation, remote actors interpolated 100 ms in the past, lag-compensated hitscan
  (the server rewinds targets to what the shooter saw), projectiles simulated server-side.
- Practice runs the same `Sim` in the browser through `LocalConn`, which has the same interface as the online connection.

Build and test the room logic:

```
node tools/build-logic.mjs     # -> dist/dread_logic.js
node tools/test-logic.mjs 240  # runs it in a sandbox: joins/leaves, bot fill, timings, payload sizes
```

Deploy with the Multiplayer Agent MCP tools (`create_upload` + `deploy_room_logic` for each room, `publish_game` for the
client). Details and platform notes: `docs/MULTIPLAYER_HANDOFF.md`.

## Layout

- `src/sim.js` pure simulation (no Three.js): grid/collision/nav, movement, weapons, projectiles, items, bots, match rules
- `src/net.js` LocalConn (practice) / OnlineConn (Multiplayer Agent) · `src/client.js` prediction + interpolation
- `src/game.js` presentation: sprites, effects, tracers, tesla beams, server events → fx/sound
- `src/core.js` renderer (240p + dither/palette pass), pixel font, asset loading (sprite atlas sliced at load)
- `src/maps.js` the three maps · `src/world.js` level geometry + lights · `src/ui.js` HUD and menus
- `src/audio.js` synthesized sound · `src/main.js` input, menus, loop · `server/glue.js` room handlers · `tools/` build + test

## Art pipeline

All sprites, textures, skies and title art were generated with the Codex CLI's image generation tool.

1. `python art/gen_art.py 1` then `python art/gen_art.py 2` writes raw images to `art/raw/` (phase 2 uses the phase-1
   character sheets as references). Existing files are skipped, so delete one to regenerate it.
2. `python art/process.py` chroma-keys, slices, downscales and writes `art/frames/`, the sprite atlas `assets/atlas_0.png`,
   textures, skies and `assets/manifest.json`. `python art/process.py pack` rebuilds only the atlas from `art/frames/`.

Maps are original designs. Design references: the DM4-style layout notes at strlen.com (`dm4ish.txt`) and
mariteaux's "The Drop" write-up; Freedoom and LibreQuake (BSD-licensed) were consulted as open references only.
