# How DreadFPS works on Multiplayer Agent

DreadFPS is a server-authoritative deathmatch. The game rules run in a Multiplayer Agent room, clients send only
their inputs, and the same simulation runs in the browser for offline practice.

## Layout

- `src/sim.js`: the pure simulation, with no Three.js and no DOM. Grid, collision and nav, movement, weapons,
  lag-compensated hitscan, projectiles, items, barrels, bots and match rules, plus `mirror(state)` to write room state.
- `src/maps.js`: the three maps (Gallows Hill, Slipgate Keep, Hellgate Outpost) as pure data, shared by client and server.
- `server/glue.js`: the room handlers. `tools/build-logic.mjs` concatenates `maps.js`, `sim.js` and `glue.js`
  into `dist/dread_logic.js`. `tools/test-logic.mjs` runs that file in a sandbox with a fake clock.
- `src/net.js`: `LocalConn` (practice: the Sim ticking at 60 Hz in the browser) and `OnlineConn` (the Multiplayer
  Agent SDK). Both have the same interface, so the rest of the client never knows which one it has.
- `src/client.js`: prediction, reconciliation and interpolation. `src/game.js`: the view only (sprites, effects, events).

## Design

- **Inputs:** the client steps its own movement at a fixed 30 Hz and sends `{ seq, dt, f, s, jump, yaw, pitch, fire, w, rt }`
  with `sendInput`. The server applies movement in `onInput`, with `dt` clamped by a per-player time budget so speed
  hacks don't work, and echoes `ack = seq`. The client predicts with the same physics code and reconciles: it snaps
  to the server's position, then replays the inputs the server hasn't acknowledged yet.
- **Remote players** are interpolated about 100 ms in the past from a snapshot buffer keyed by server time `state.shared.st`.
- **Lag compensation:** the server keeps about 0.6 s of position history per actor. Hitscan and melee from humans rewind
  their targets to the shooter's render time `rt`, clamped to a few hundred ms. Projectiles are not rewound.
- **Events** are batched per tick into one `emit('ev', { st, e: [...] })`, split when a batch passes about 1800 characters:
  shots, impacts, projectile spawns, explosions, kills, pain, pickups, teleports, item respawns, bot joins and kicks.
- **Shared state:** map index, match result, server time, item and barrel masks, dropped weapons. The map rotates
  about 10 s after a win.
- **Bots fill slots:** 6 per match. A bot (the lowest scorer) is kicked when a human joins and added back when one
  leaves. Online bots are mostly EASY with some NORMAL. Rooms are `dread-1` to `dread-4` with 8 clients each, and the
  client tries them in order.
- **Room settings:** the first human's `hello` carries `cfg { map, diff }` (-1 means the room's default).
- **Player name:** asked once, kept in localStorage, sent with `send('hello', { name })`.

## Deploying your own copy

1. Get a game: `remix_game` on the starter, or `create_game`. Put its publishable key in `mp.config.local.js`
   (see the README). Pass `game` to every Multiplayer Agent tool, since a studio can hold many games.
2. Build and test the logic: `node tools/build-logic.mjs`, then `node tools/test-logic.mjs 240`.
3. Deploy the logic to each room name `dread-1` to `dread-4` with `deploy_room_logic` (the file is larger than an
   inline call allows, so use `create_upload`, upload with `curl -T`, then deploy with the `uploadId`).
   Check `get_room_logs` afterwards.
4. Publish the client with `publish_game`: text files inline, binaries (the PNGs) through `create_upload`. Include
   `mp.config.js` and `mp.config.local.js`. The hosted page needs the real key, and a publishable key in a live page
   is public by design. It just never goes into git. Later changes can go out with `mode: "patch"`.
5. Open the share link in two different browsers (not two tabs) to test a real two-player match.

## Platform notes

- Room logic runs in a V8 isolate. Handlers are synchronous (`onJoin`, `onLeave`, `onInput`, `onEvent`, `onTick(dt)`),
  with no imports, fetch or timers. The file is at most 256 KB, and state must be plain JSON. Use `emit` and `emitTo`
  to reach clients. Treat a `dt` over 2 as milliseconds.
- Limits: 64 fields per entity, 2048 characters per field or event payload, 60 client messages per second, state
  broadcast about 20 per second.
- All-digit string fields come back to clients as numbers (`"1101..."` arrives as `1.1e+25`), so masks are sent as
  `'m' + digits`.
- `publish_game` has a file cap, which is why the sprites are packed into `assets/atlas_0.png` (`python art/process.py pack`)
  and sliced at load time in `core.js`.

## Hard-won fixes to keep

- `navSearch` uses a **Float64Array**: Float32 rounding caused an infinite loop on Slipgate Keep. It also has an iteration guard.
- A fixed pool of 14 lights, so shaders never recompile on a map change. Shaders are precompiled on map entry and
  textures are uploaded at load.
