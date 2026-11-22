# Rocket duel

Two-ship cave duel built with Three.js. Originally a single-file claude.ai artifact.

## Develop

```sh
npm install
npm run dev       # Vite dev server
npm run build     # production build to packages/client/dist
npm run preview   # serve the production build
npm test          # shared and server tests (Node, no browser)
npm run server    # online game server on ws://localhost:8787
```

## Play online

```sh
npm run server     # the game server on port 8787 (LAG=200 simulates a slow connection, SEED=7 fixes every room's map)
npm run dev        # open http://localhost:5173
```

New game → Online → pick a map → Create online game. The page shows a link (`?room=abc123`) to send to a friend; they open it, pick a colour and join. Either set of keys steers your ship, and each player sees one full view of their own ship. While online, the local-only controls (New game, Restart, Pause, the tuning panel, changing maps) are hidden; Leave game goes back to local play.

The server runs each room's match in a worker thread of its own. Each browser predicts its own ship, shots and weapon switches from the player's keys, so they respond at once even over a slow connection, and eases in the server's corrections. A dropped connection reconnects by itself and takes back the same seat and score (the server holds it for 30 s; reloading the page rejoins too). The other player sees "Your opponent dropped out" meanwhile.

## Deploy

One Node process serves both the built game and the rooms, so players open one address and the page connects back to it over `wss://`.

```sh
npm run build
STATIC_DIR=packages/client/dist ORIGINS=https://your.domain npm run server
```

Server settings (environment): `PORT`, `STATIC_DIR` (serve the built game), `ORIGINS` (pages allowed to connect, comma separated; empty allows any), `MAX_ROOMS` (200), `LAG`, `SEED`. `GET /health` answers `{"ok":true,"rooms":n}` for the host's health check.

**Fly.io** (the `Dockerfile` and `fly.toml` are ready): install `flyctl`, then

```sh
fly launch --copy-config --no-deploy     # choose your own app name and region
fly secrets set ORIGINS=https://<app>.fly.dev
fly deploy
```

Rooms live in memory on one machine, so keep it to one machine (`fly scale count 1`). Render and Railway work the same way with the Dockerfile (they need WebSockets enabled, which both have).

To host the page somewhere else (a static host) and the server on its own, build the client with the server's address: `VITE_SERVER_URL=wss://game-server.example.com npm run build`, and set `ORIGINS` on the server to the page's address. `?server=ws://…` on the page overrides the address for testing.

## Layout

- `packages/client`: the browser game (Vite).
  - `index.html`: markup; `src/styles/`: CSS; `public/fonts/`: the Allo font.
  - `src/touch.js`: touch controls on phones and tablets (a stick bottom right that sets heading and thrust, Fire and Weapon buttons bottom left). A touch device plays one ship: no split screen and no key legends (`html.touch`, `styles/touch.css`). `?touch` forces them on with a mouse.
  - `src/main.js`: startup. `src/loop.js`: fixed-step `step()` (shared `stepSim`, then effects, map, boxes) and render `frame()`.
  - `src/config.js` (player colours, saved-tuning key), `src/state.js` (tuning panel monitor).
  - `src/render/field.js`: the level as the GPU draws it (softened mask, rock colours), repainted on level events.
  - `src/ships/view.js`: each ship's meshes, colours and camera (`views[s.id]`); the ship's state lives in shared.
  - `src/fx/`: trails, debris, particles, smoke (fixed pools). `fx/effects.js` turns simulation events into sound, particles, shake and UI, and runs the per-step looks (exhaust, frost, beam sparks, trails).
  - `src/maps/`: per-map content (forest, desert, floors, starship, hangar). Each theme has an `index.js` exporting one object of hooks; `maps/index.js` lists them, documents every hook and gives the core `activeMap()`. A new map theme is a new folder plus one line there.
  - `src/systems/boxes.js`: how the floating supply boxes look (they run in shared `boxes.js`).
  - `src/render/`: Three.js scene and shaders, the drawing field, the Big laser beam, the Missile sight (green on the opponent when a missile would reach them, red where it would stop), point lights on the rock (`lights.js`: a flying Frag grenade, blast flashes), cameras and split screen, debug drawing.
  - `src/ui/`: HUD, header, map picker and art, tuning panel, skins, start screen.
  - `src/audio/sfx.js`: synthesized sound effects, plus the recorded samples (`*.mp3`) next to it, played on top.
  - `src/net/online.js`: online mode: connects to a room (and reconnects), the waiting and connection card, sends numbered inputs (a weapon switch rides on one), predicts the player's own ship, shots and switches and reconciles them with each snapshot (a predicted shot hands over to the server's bullet fired by the same input), draws the other ship and the map's creatures between snapshots, and replays the server's events.
- `packages/server`: the online game server (Node + `ws`). `src/server.js` is the front: HTTP (health check, the built game), rooms and invite names, allowed origins, and passing messages between browsers and rooms. `src/match.js` is one match, run in a worker thread per room (`src/room.js`), since the shared simulation's state lives in modules: it seats two players (holding a dropped player's seat), steps each ship once per input its player sent (`stepSim` with `inputsFor`), and broadcasts snapshots and events; `test/` plays against it with real WebSocket clients.
- `packages/shared`: code the browser and the server both run. Plain JS: no Three.js, DOM or audio, and it never imports from the client. Import it as `@rocket-duel/shared/<file>`.
  - `config.js` (tuning `P`, presets, weapons, practice toggles), `state.js` (`game`), `math.js`, `random.js` (seeded gameplay randomness).
  - `sim.js`: `stepSim(h)`, one fixed step of the duel. `victory.js`: the match to `P.winsToWin` wins (`game.winner`). `cpu.js`: the computer pilot that flies ship 2 in a one-player game (path finding on a coarse grid of the cave, flying, aiming; `P.cpuSkill`). `ships/` (state, physics, weapons, Big laser), `bullets.js` (the bullet pool), `missile.js` (the homing Missile's steering, and `missileReach()`: would a missile fired now reach the other ship), `explosions.js` (craters, blasts, and the Frag grenade's burst into shards, each a bullet of its own).
  - `net.js`: the online protocol (messages, snapshot encoding, `ONLINE_MAPS`) used by both the server and the browser.
  - `boxes.js`: the supply boxes (the client's `systems/boxes.js` draws them).
  - `maps/`: map rules, the gameplay half of a map theme (creatures, pickups, enemies) that the server runs too; `maps/index.js` lists them by theme and documents the hooks. The client's theme spreads them in and adds the looks.
  - `events.js`: the simulation reports what happened (`simEvent('fired', ship, ...)`); listeners add sound and looks. `maps.js`: `mapRules()`, the active map's hooks, plugged in by whoever runs the game.
  - `level/mask.js`: the collision mask, carving, and level events (`onLevel('resized' | 'painted' | 'carved', fn)`).
  - `level/terrain.js`: every map's terrain generator and the `MAPS` list; `level/generate.js`: builds the chosen map into the mask.
  - `test/`: Vitest tests. `level.test.js` checks every map builds the same mask as before; `duel.test.js` plays a duel in Node (flying, firing, digging, kills, respawn), checks that the same seed and inputs replay exactly, and that replaying inputs from a snapshot predicts a ship exactly.

Modules import each other in cycles (map code calls back into the core). That works because cross-module calls happen inside functions; code that runs at load time only uses modules that load earlier. `level/mask.js` reaches the scene and the active map through `levelHooks` for that reason.
