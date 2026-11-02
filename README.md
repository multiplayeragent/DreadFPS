# DreadFPS

Retro sprite-based FPS in the spirit of Quake, Blood and DOOM. Online, server-authoritative deathmatch on
[Multiplayer Agent](https://github.com/multiplayeragent/multiplayer-agent), plus offline practice against bots. First to 15 frags wins.

**Play online:** https://dreaddeathmatch.play.multiplayeragent.com/

## Play locally

Double-click `PLAY.bat` (or run `node serve.js` and open http://localhost:8642). A local server is required because
browsers block WebGL textures loaded from `file://`. Three.js and the Multiplayer Agent SDK load from CDNs.

Practice vs bots works straight away. Online deathmatch needs your own game on Multiplayer Agent.

Controls: WASD move · Space jump · mouse aim/fire · 1–7 / wheel weapons · Tab scores · Esc pause.
Title screen: Left/Right on MODE switches between ONLINE DEATHMATCH and PRACTICE VS BOTS. Practice picks the map, bot count
(1–7) and difficulty. Online, MAP and DIFFICULTY default to the room's rotation and mixed bots; a choice applies when you are
the first human in a room. N changes your online name.

## Make it yours

In [Claude Code](https://claude.com/claude-code) with the
[Multiplayer Agent plugin](https://github.com/multiplayeragent/multiplayer-agent), run:

```
/multiplayer-agent:remix dreadfps
```

Or just ask it to "remix DreadFPS". You get your own copy online at a share link to send your friends. No server to run,
and the free tier is enough to start.

By hand instead:

1. Create a game with the Multiplayer Agent MCP's `create_game` (or `remix_game` with `dreadfps`).
2. Put its publishable key in a new file `mp.config.local.js` next to `index.html`:
   `window.MP_CONFIG.key = 'pk_live_...';`
   It's gitignored, so your key never ends up in a commit. `mp.config.js` holds the placeholder.
3. Deploy the room logic and publish the client (see `docs/HOW_IT_WORKS.md`).

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
client). Details and platform notes: `docs/HOW_IT_WORKS.md`.

## Layout

- `src/sim.js` pure simulation (no Three.js): grid/collision/nav, movement, weapons, projectiles, items, bots, match rules
- `src/net.js` LocalConn (practice) / OnlineConn (Multiplayer Agent) · `src/client.js` prediction + interpolation
- `src/game.js` presentation: sprites, effects, tracers, tesla beams, server events → fx/sound
- `src/core.js` renderer (240p + dither/palette pass), pixel font, asset loading (sprite atlas sliced at load)
- `src/maps.js` the three maps · `src/world.js` level geometry + lights · `src/ui.js` HUD and menus
- `src/audio.js` synthesized sound · `src/main.js` input, menus, loop · `server/glue.js` room handlers · `tools/` build + test

## Art pipeline

All sprites, textures, skies and title art were generated with the Codex CLI's image generation tool.

1. With the Codex CLI on PATH (or `CODEX_BIN` set to it), `python art/gen_art.py 1` then `python art/gen_art.py 2` writes raw images to `art/raw/` (phase 2 uses the phase-1
   character sheets as references). Existing files are skipped, so delete one to regenerate it.
2. `python art/process.py` chroma-keys, slices, downscales and writes `art/frames/`, the sprite atlas `assets/atlas_0.png`,
   textures, skies and `assets/manifest.json`. `python art/process.py pack` rebuilds only the atlas from `art/frames/`.

Maps are original designs. Design references: the DM4-style layout notes at strlen.com (`dm4ish.txt`) and
mariteaux's "The Drop" write-up; Freedoom and LibreQuake (BSD-licensed) were consulted as open references only.

## License

[MIT](LICENSE). Take it, change it, ship it.
