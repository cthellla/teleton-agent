# ---- Build stage ----
FROM node:20-slim AS build

WORKDIR /app

# Install build tools for native modules (better-sqlite3, bufferutil, etc.)
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    && rm -rf /var/lib/apt/lists/*

# Copy dependency files and SDK workspace (needed for workspace resolution)
COPY package.json package-lock.json ./
COPY packages/sdk/package.json packages/sdk/

# Install all deps (including devDependencies for build + SDK workspace)
RUN npm ci

# Copy source, build configs, and full SDK source
COPY tsconfig.json tsup.config.ts ./
COPY src/ src/
COPY packages/ packages/

# Copy frontend source and install its deps
COPY web/ web/
RUN cd web && npm ci

# Build everything: SDK → backend (tsup) → frontend (vite)
RUN npm run build

# ---- Runtime stage ----
FROM node:20-slim

WORKDIR /app

# Install build tools for native modules (bufferutil, utf-8-validate lack
# linux-arm64 prebuilds), compile, then remove build tools.
# package.json overrides onnxruntime-node to 1.22.0-rev (fixes SIGILL on ARM64 Cortex-A72)
COPY package.json package-lock.json ./
RUN apt-get update && apt-get install -y python3 make g++ \
    && npm pkg delete scripts.prepare \
    && npm ci --omit=dev \
    && apt-get purge -y python3 make g++ && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/* \
    && npm cache clean --force

# Copy compiled code, bin wrapper, and templates
COPY --from=build /app/dist/ dist/
COPY bin/ bin/
COPY src/templates/ src/templates/

# Data directory for persistence
ENV TELETON_HOME=/data
VOLUME /data

# Run as non-root
RUN chown -R node:node /app
USER node

# WebUI port (when enabled)
EXPOSE 7777

ENTRYPOINT ["node", "dist/cli/index.js"]
CMD ["start"]
