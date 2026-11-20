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

- `packages/client`: the browser game (Vite). `src/main.js` holds the game code, `src/styles/` the CSS, `public/fonts/` the Allo font.
- `packages/shared`: the game simulation shared with a future multiplayer server (plain JS, no Three.js, DOM or audio). Empty for now.
