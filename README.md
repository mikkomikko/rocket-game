# Rocket duel

Two-ship cave duel built with Three.js. Originally a single-file claude.ai artifact.

## Develop

```sh
npm install
npm run dev       # Vite dev server
npm run build     # production build to packages/client/dist
npm run preview   # serve the production build
```

## Layout

- `packages/client`: the browser game (Vite).
  - `index.html`: markup; `src/styles/`: CSS; `public/fonts/`: the Allo font.
  - `src/main.js`: startup. `src/loop.js`: fixed-step `step()` and render `frame()`.
  - `src/config.js` (tuning `P`, weapons), `src/state.js` (`game`), `src/util/`.
  - `src/level/`: the collision/drawing mask, terrain generators, level building.
  - `src/ships/`: ship meshes, physics, weapons, Big laser.
  - `src/fx/`: bullets, trails, explosions, debris, particles, smoke (fixed pools).
  - `src/maps/`: per-map content (forest, desert, floors, starship, hangar). Each theme has an `index.js` exporting one object of hooks; `maps/index.js` lists them, documents every hook and gives the core `activeMap()`. A new map theme is a new folder plus one line there.
  - `src/systems/boxes.js`: floating supply boxes on every map.
  - `src/render/`: Three.js scene and shaders, cameras and split screen, debug drawing.
  - `src/ui/`: HUD, header, map picker and art, tuning panel, skins, start screen.
  - `src/audio/sfx.js`: synthesized sound effects.
- `packages/shared`: the game simulation shared with a future multiplayer server (plain JS, no Three.js, DOM or audio). Empty for now.

Modules import each other in cycles (map code calls back into the core). That works because cross-module calls happen inside functions; code that runs at load time only uses modules that load earlier. `level/mask.js` reaches the scene and the active map through `levelHooks` for that reason.
