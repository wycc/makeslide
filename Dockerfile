FROM node:20-bookworm AS build

WORKDIR /app

# native modules (sharp / better-sqlite3) + runtime dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    make \
    g++ \
    ffmpeg \
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

# python3 (>= 3.10) is required to run the yt-dlp zipapp; bookworm ships 3.11.
# ca-certificates provides the system CA bundle that Python's ssl uses to verify
# HTTPS certs (the slim base image ships none, breaking yt-dlp's TLS).
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    poppler-utils \
    python3 \
    make \
    g++ \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# keep production install simple with workspace support
COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm install

# backend runtime artifacts
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/src ./backend/src
COPY --from=build /app/.env.example ./.env.example

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

CMD ["bash", "-lc", "mkdir -p /home/jovyan/data /home/jovyan/storage && [ -f /home/jovyan/.env ] || cp /app/.env.example /home/jovyan/.env && cd /app && while true; do npx tsx backend/src/server.ts; echo 'server exited, restarting in 2s...'; sleep 2; done"]
