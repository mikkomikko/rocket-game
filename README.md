# Rocket duel

Two-ship cave duel built with Three.js. Originally a single-file claude.ai artifact.

## Develop

```sh
npm install
npm run dev       # Vite dev server
npm run build     # production build to packages/client/dist
npm run preview   # serve the production build
npm test          # shared package tests (Node, no browser)
```

## Layout

- `packages/client`: the browser game (Vite).
  - `index.html`: markup; `src/styles/`: CSS; `public/fonts/`: the Allo font.
  - `src/main.js`: startup. `src/loop.js`: fixed-step `step()` and render `frame()`.
  - `src/config.js` (player colours, saved-tuning key), `src/state.js` (tuning panel monitor).
  - `src/render/field.js`: the level as the GPU draws it (softened mask, rock colours), repainted on level events.
  - `src/ships/`: ship meshes, physics, weapons, Big laser.
  - `src/fx/`: bullets, trails, explosions, debris, particles, smoke (fixed pools).
  - `src/maps/`: per-map content (forest, desert, floors, starship, hangar). Each theme has an `index.js` exporting one object of hooks; `maps/index.js` lists them, documents every hook and gives the core `activeMap()`. A new map theme is a new folder plus one line there.
  - `src/systems/boxes.js`: floating supply boxes on every map.
  - `src/render/`: Three.js scene and shaders, the drawing field, cameras and split screen, debug drawing.
  - `src/ui/`: HUD, header, map picker and art, tuning panel, skins, start screen.
  - `src/audio/sfx.js`: synthesized sound effects.
- `packages/shared`: code the browser and a future multiplayer server both run. Plain JS: no Three.js, DOM or audio, and it never imports from the client. Import it as `@rocket-duel/shared/<file>`.
  - `config.js` (tuning `P`, presets, weapons, practice toggles), `state.js` (`game`), `math.js`.
  - `level/mask.js`: the collision mask, carving, and level events (`onLevel('resized' | 'painted' | 'carved', fn)`).
  - `level/terrain.js`: every map's terrain generator and the `MAPS` list; `level/generate.js`: builds the chosen map into the mask.
  - `test/`: Vitest tests. `level.test.js` checks every map builds the same mask as before.

Modules import each other in cycles (map code calls back into the core). That works because cross-module calls happen inside functions; code that runs at load time only uses modules that load earlier. `level/mask.js` reaches the scene and the active map through `levelHooks` for that reason.
