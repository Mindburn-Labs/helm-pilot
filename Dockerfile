# syntax=docker/dockerfile:1.7

# ─── Stage 1: Build ───
FROM node:22.22.2-slim AS builder
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
RUN npx turbo build --filter=@helm-pilot/gateway --filter=@helm-pilot/telegram-bot --filter=@helm-pilot/telegram-miniapp

# ─── Stage 2: Python Runtime ───
FROM node:22.22.2-slim AS python-runtime
WORKDIR /app

ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV VIRTUAL_ENV=/opt/venv
ENV PATH=/opt/venv/bin:$PATH

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    build-essential \
    ca-certificates \
    python3 \
    python3-dev \
    python3-pip \
    python3-venv \
  && rm -rf /var/lib/apt/lists/*

COPY pipelines/requirements.txt pipelines/requirements.txt

RUN --mount=type=cache,target=/root/.cache/pip \
  python3 -m venv "$VIRTUAL_ENV" \
  && pip install --timeout 180 --retries 10 -r pipelines/requirements.txt \
  && python -m playwright install chromium \
  && python -m patchright install chromium

# ─── Stage 3: Production ───
FROM node:22.22.2-slim AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="HELM Pilot"
LABEL org.opencontainers.image.description="Open-source, self-hostable autonomous founder operating system"
LABEL org.opencontainers.image.version="0.1.0"
LABEL org.opencontainers.image.source="https://github.com/Mindburn-Labs/helm-pilot"
LABEL org.opencontainers.image.license="MIT"

ENV NODE_ENV=production
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
ENV VIRTUAL_ENV=/opt/venv
ENV PATH=/opt/venv/bin:$PATH

# Create non-root user
RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    python3 \
    python3-pip \
    python3-venv \
    awscli \
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
    postgresql-client \
    fonts-liberation \
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
