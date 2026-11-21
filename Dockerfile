# One image for the whole game: the server runs the rooms and serves the built browser game from the
# same address, so players open https://<app>/ and the page connects to wss://<app>/ by itself.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/client/package.json packages/client/
COPY packages/server/package.json packages/server/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY packages packages
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production PORT=8080 STATIC_DIR=/app/packages/client/dist
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/shared/package.json packages/shared/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev && npm cache clean --force
COPY packages/server/src packages/server/src
COPY packages/shared/src packages/shared/src
COPY --from=build /app/packages/client/dist packages/client/dist
USER node
EXPOSE 8080
CMD ["node", "packages/server/src/index.js"]
