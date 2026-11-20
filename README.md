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

Start the server, then open the game with `?server=` in two browsers (or two tabs):

```sh
npm run server                     # PORT=8787 MAP=cave SEED=7 by default; LAG=200 simulates a slow connection
npm run dev
# open http://localhost:5173/?server=ws://localhost:8787 twice
```

The first browser to connect flies ship 1, the second ship 2; either set of keys steers your ship, and each player sees one full view of their own ship. The server runs the match; each browser predicts its own ship and its own shots from the player's keys, so steering and firing respond at once even over a slow connection, and eases in the server's corrections. For now online play covers the rock maps (cave, clear, open, pillars, maze, divide) without supply boxes.

## Layout

- `packages/client`: the browser game (Vite).
  - `index.html`: markup; `src/styles/`: CSS; `public/fonts/`: the Allo font.
  - `src/main.js`: startup. `src/loop.js`: fixed-step `step()` (shared `stepSim`, then effects, map, boxes) and render `frame()`.
  - `src/config.js` (player colours, saved-tuning key), `src/state.js` (tuning panel monitor).
  - `src/render/field.js`: the level as the GPU draws it (softened mask, rock colours), repainted on level events.
  - `src/ships/view.js`: each ship's meshes, colours and camera (`views[s.id]`); the ship's state lives in shared.
  - `src/fx/`: trails, debris, particles, smoke (fixed pools). `fx/effects.js` turns simulation events into sound, particles, shake and UI, and runs the per-step looks (exhaust, frost, beam sparks, trails).
  - `src/maps/`: per-map content (forest, desert, floors, starship, hangar). Each theme has an `index.js` exporting one object of hooks; `maps/index.js` lists them, documents every hook and gives the core `activeMap()`. A new map theme is a new folder plus one line there.
  - `src/systems/boxes.js`: floating supply boxes on every map.
  - `src/render/`: Three.js scene and shaders, the drawing field, the Big laser beam, cameras and split screen, debug drawing.
  - `src/ui/`: HUD, header, map picker and art, tuning panel, skins, start screen.
  - `src/audio/sfx.js`: synthesized sound effects.
  - `src/net/online.js`: online mode (`?server=`): sends numbered inputs, predicts the player's own ship and shots and reconciles them with each snapshot (a predicted shot hands over to the server's bullet fired by the same input), draws the other ship between snapshots, and replays the server's events.
- `packages/server`: the online game server (Node + `ws`). `src/server.js` seats two players, steps each ship once per input its player sent (`stepSim` with `inputsFor`), and broadcasts snapshots and events; `test/` plays against it with real WebSocket clients.
- `packages/shared`: code the browser and the server both run. Plain JS: no Three.js, DOM or audio, and it never imports from the client. Import it as `@rocket-duel/shared/<file>`.
  - `config.js` (tuning `P`, presets, weapons, practice toggles), `state.js` (`game`), `math.js`, `random.js` (seeded gameplay randomness).
  - `sim.js`: `stepSim(h)`, one fixed step of the duel. `ships/` (state, physics, weapons, Big laser), `bullets.js` (the bullet pool), `explosions.js`.
  - `net.js`: the online protocol (messages, snapshot encoding) used by both the server and the browser.
  - `events.js`: the simulation reports what happened (`simEvent('fired', ship, ...)`); listeners add sound and looks. `maps.js`: `mapRules()`, the active map's hooks, plugged in by whoever runs the game.
  - `level/mask.js`: the collision mask, carving, and level events (`onLevel('resized' | 'painted' | 'carved', fn)`).
  - `level/terrain.js`: every map's terrain generator and the `MAPS` list; `level/generate.js`: builds the chosen map into the mask.
  - `test/`: Vitest tests. `level.test.js` checks every map builds the same mask as before; `duel.test.js` plays a duel in Node (flying, firing, digging, kills, respawn), checks that the same seed and inputs replay exactly, and that replaying inputs from a snapshot predicts a ship exactly.

Modules import each other in cycles (map code calls back into the core). That works because cross-module calls happen inside functions; code that runs at load time only uses modules that load earlier. `level/mask.js` reaches the scene and the active map through `levelHooks` for that reason.
