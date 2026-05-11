FROM node:20-bookworm AS build

WORKDIR /app

# native modules (sharp / better-sqlite3) + runtime dependency poppler
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm install

COPY . .

RUN npm run build


FROM node:20-bookworm-slim AS runtime

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    poppler-utils \
  && rm -rf /var/lib/apt/lists/*

# keep production install simple with workspace support
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm install

# backend runtime artifacts
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/src ./backend/src

# frontend static assets (served by backend route if configured)
COPY --from=build /app/frontend/dist ./frontend/dist

# app data dirs
RUN mkdir -p /home/jovyan/storage /home/jovyan/data \
  && rm -rf /app/storage /app/data \
  && ln -s /home/jovyan/storage /app/storage \
  && ln -s /home/jovyan/data /app/data

ENV NODE_ENV=production
ENV PORT=8888

EXPOSE 8888

CMD ["bash", "-lc", "cd /app && while true; do npx tsx backend/src/server.ts; echo 'server exited, restarting in 2s...'; sleep 2; done"]
