# ---- TON Proxy build (ARM64 only — no prebuilt binary available) ----
FROM golang:1.24-bookworm AS ton-proxy-build
ARG TARGETARCH
RUN if [ "$TARGETARCH" = "arm64" ]; then \
      git clone --depth 1 https://github.com/xssnick/Tonutils-Proxy.git /src && \
      cd /src && CGO_ENABLED=0 go build -o /tonutils-proxy-cli ./cmd/proxy-cli/; \
    else \
      touch /tonutils-proxy-cli; \
    fi

# ---- Build stage ----
FROM node:22.22.2-slim AS build

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
FROM node:22.22.2-slim

WORKDIR /app

# Copy package files and install production deps only.
# better-sqlite3 has no usable prebuilt for this image and compiles from source, so the
# build toolchain is installed, used, then purged in the same layer to keep the image slim.
# bufferutil / utf-8-validate also lack linux-arm64 prebuilds.
# package.json overrides onnxruntime-node to 1.22.0-rev (fixes SIGILL on ARM64 Cortex-A72).
COPY package.json package-lock.json ./
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 make g++ \
    && npm pkg delete scripts.prepare \
    && npm ci --omit=dev \
    && npm cache clean --force \
    && apt-get purge -y python3 make g++ \
    && apt-get autoremove -y \
    && rm -rf /var/lib/apt/lists/*

# Copy compiled code, bin wrapper, and templates
COPY --from=build /app/dist/ dist/
COPY bin/ bin/
COPY src/templates/ src/templates/

# Pre-built tonutils-proxy for ARM64 (no GitHub release exists for arm64)
# Copied to /app/ton-proxy-bin/; entrypoint script moves it to /data/bin/ on first start
COPY --from=ton-proxy-build /tonutils-proxy-cli /app/ton-proxy-bin/tonutils-proxy-cli
RUN if [ -s /app/ton-proxy-bin/tonutils-proxy-cli ]; then chmod +x /app/ton-proxy-bin/tonutils-proxy-cli; fi

# Data directory for persistence
ENV TELETON_HOME=/data
VOLUME /data

# Run as non-root
RUN chown -R node:node /app
USER node

# WebUI port (when enabled)
EXPOSE 7777

# Copy pre-built tonutils-proxy to /data/bin/ on first start (ARM64)
ENTRYPOINT ["/bin/sh", "-c", "\
  if [ -s /app/ton-proxy-bin/tonutils-proxy-cli ] && [ ! -f /data/bin/tonutils-proxy-cli-linux-arm64 ]; then \
    mkdir -p /data/bin && cp /app/ton-proxy-bin/tonutils-proxy-cli /data/bin/tonutils-proxy-cli-linux-arm64; \
  fi; \
  exec node dist/cli/index.js \"$@\"", "--"]
CMD ["start"]
