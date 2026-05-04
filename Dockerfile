# syntax=docker/dockerfile:1.7

# ─── Stage 1: Build ───
FROM node:22.22.2-slim AS node-base

FROM node-base AS builder
WORKDIR /app

# Copy workspace config
COPY package.json package-lock.json turbo.json tsconfig.base.json ./

# Copy all workspace packages (needed for dependency resolution)
COPY packages/ packages/
COPY services/ services/
COPY apps/telegram-bot/ apps/telegram-bot/
COPY apps/telegram-miniapp/ apps/telegram-miniapp/

# Install all dependencies, including platform-native optional packages used by
# Vite/esbuild during production image builds.
RUN npm ci --include=optional --ignore-scripts

# Build everything (turbo handles topological ordering)
RUN npx turbo build --concurrency=1 --filter=@pilot/gateway --filter=@pilot/telegram-bot --filter=@pilot/telegram-miniapp

# ─── Stage 2: Python Runtime ───
FROM python:3.11-slim-bookworm AS python-runtime
WORKDIR /app

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV VIRTUAL_ENV=/opt/venv
ENV PATH=/opt/venv/bin:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY pipelines/requirements.txt pipelines/requirements.txt

RUN --mount=type=cache,target=/root/.cache/pip \
  python -m venv "$VIRTUAL_ENV" \
  && pip install --timeout 180 --retries 10 --index-url https://download.pytorch.org/whl/cpu torch==2.6.0 \
  && pip install --timeout 180 --retries 10 -r pipelines/requirements.txt \
  && pip install --timeout 180 --retries 10 awscli \
  && python -m playwright install chromium \
  && python -m patchright install chromium

# ─── Stage 3: Production ───
FROM python:3.11-slim-bookworm AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="Pilot"
LABEL org.opencontainers.image.description="Open-source, self-hostable autonomous founder operating system"
LABEL org.opencontainers.image.version="0.1.0"
LABEL org.opencontainers.image.source="https://github.com/Mindburn-Labs/pilot"
LABEL org.opencontainers.image.license="MIT"

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV VIRTUAL_ENV=/opt/venv
ENV PATH=/opt/venv/bin:$PATH

COPY --from=node-base /usr/local/bin/node /usr/local/bin/node
COPY --from=node-base /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -sf ../lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm \
  && ln -sf ../lib/node_modules/npm/bin/npx-cli.js /usr/local/bin/npx \
  && ln -sf ../lib/node_modules/corepack/dist/corepack.js /usr/local/bin/corepack

# Create non-root user
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    gnupg \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcairo2 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libx11-xcb1 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    fonts-liberation \
  && install -d /usr/share/postgresql-common/pgdg \
  && curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg \
  && echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.gpg] https://apt.postgresql.org/pub/repos/apt bookworm-pgdg main" > /etc/apt/sources.list.d/pgdg.list \
  && apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client-17 \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system helm \
  && useradd --system --gid helm --create-home helm

# Copy workspace config
COPY package.json package-lock.json ./

# Copy built packages
COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/services/ services/
COPY --from=builder /app/apps/telegram-bot/ apps/telegram-bot/
COPY --from=builder /app/apps/telegram-miniapp/dist/ apps/telegram-miniapp/dist/
COPY pipelines/ pipelines/

# Copy scripts for backup tooling
COPY scripts/ scripts/

# Install production dependencies only
RUN npm ci --omit=dev --include=optional --ignore-scripts

COPY --from=python-runtime /opt/venv /opt/venv
COPY --from=python-runtime /ms-playwright /ms-playwright

# Create data directories with correct ownership
RUN mkdir -p /app/data/storage /app/backups /ms-playwright \
  && chown -R helm:helm /app/data /app/backups /ms-playwright

# Switch to non-root user
USER helm

EXPOSE 3100

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "services/gateway/dist/server.js"]
