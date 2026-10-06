# The live demo, containerised (ROADMAP P1, ADR-0004). One image, one origin: `apps/server` serves
# the game's socket (`/play`), its probes and the built page (`/`) from one port, so the deployed
# page needs no CORS, no second host and no proxy.
#
#   docker build -t ricochet .
#   docker run --rm -p 8080:8080 -e RICOCHET_LAB=on ricochet     →  http://localhost:8080/
#
# A production server. The network lab is a host's choice (`RICOCHET_LAB=on` — render.yaml makes
# it), since it touches only the socket that asks for it (docs/protocol.md § 3.1).
FROM node:22-bookworm-slim AS build
ENV npm_config_fetch_retries=5 \
    npm_config_fetch_retry_maxtimeout=120000
WORKDIR /repo

# The pnpm that package.json pins (`packageManager`), as its own layer. Through npm, not corepack:
# corepack's download has no retry, and one connection cut mid-tarball fails the build.
COPY package.json ./
RUN npm install -g "$(node -p "require('./package.json').packageManager")" && pnpm --version

# The layer-cache split: the install depends on the lockfile and the manifests, which change
# rarely, not on source, which changes daily. Every manifest is listed because --frozen-lockfile
# checks the lockfile against the whole workspace.
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/server/package.json apps/server/
COPY apps/web/package.json apps/web/
COPY packages/bots/package.json packages/bots/
COPY packages/geom/package.json packages/geom/
COPY packages/netcode/package.json packages/netcode/
COPY packages/protocol/package.json packages/protocol/
COPY packages/renderer/package.json packages/renderer/
COPY packages/sim/package.json packages/sim/
COPY tools/bench/package.json tools/bench/
COPY tools/load/package.json tools/load/
RUN pnpm install --frozen-lockfile --filter "@ricochet/server..." --filter "@ricochet/web..."

COPY . .
# Each unit and everything under it, in dependency order; the page's production bundle.
RUN pnpm --filter "@ricochet/server..." --filter "@ricochet/web..." run build
# A standalone production tree for the server (its workspace packages as their built `dist/`),
# with the page's static bundle beside it.
RUN pnpm --filter @ricochet/server --prod --legacy deploy /out \
 && cp -r apps/web/dist /out/web

FROM node:22-bookworm-slim
ENV NODE_ENV=production \
    RICOCHET_STATIC_DIR=/app/web
WORKDIR /app
COPY --from=build --chown=node:node /out .
USER node
# 8080 unless the host says otherwise: a platform that injects PORT (Render) is obeyed.
EXPOSE 8080
# /ready answers once the tick is running.
HEALTHCHECK --interval=10s --timeout=4s --start-period=10s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/ready').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["node", "dist/main.js"]
