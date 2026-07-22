# Railway build. Repo root is the build context (not web/) so web's
# file:../matching dependency can see matching/ -- see CLAUDE.md.
FROM node:22-slim

# node:sqlite (used by web/lib/server/grader.ts and gameDb.ts) needs this.
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN npm --prefix web ci
RUN npm --prefix web run build

EXPOSE 3000
CMD ["npm", "--prefix", "web", "run", "start"]
