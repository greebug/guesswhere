# Railway build. Repo root is the build context (not web/) so web's
# file:../matching dependency can see matching/ -- see CLAUDE.md.
FROM node:22-slim

# node:sqlite (used by web/lib/server/grader.ts and gameDb.ts) needs this.
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN npm --prefix web ci

# NEXT_PUBLIC_* vars get inlined into the client JS at build time, not read
# at runtime -- Railway only makes service Variables visible to `RUN` steps
# if they're re-declared as ARG here (its own Dockerfile docs are explicit
# about this: no ARG means no access, even though the var exists on the
# service). CITIES_DB/GAME_DB_PATH don't need this -- they're read server-side
# via process.env at request time, so plain runtime env vars are enough.
ARG NEXT_PUBLIC_MAPBOX_TOKEN
ARG NEXT_PUBLIC_TILES_URL
ENV NEXT_PUBLIC_MAPBOX_TOKEN=$NEXT_PUBLIC_MAPBOX_TOKEN
ENV NEXT_PUBLIC_TILES_URL=$NEXT_PUBLIC_TILES_URL

RUN npm --prefix web run build

EXPOSE 3000
CMD ["npm", "--prefix", "web", "run", "start"]
