# ─── Stage 1: Build ───
FROM node:22-slim AS builder
WORKDIR /app

# Copy workspace config
COPY package.json package-lock.json turbo.json tsconfig.base.json ./

# Copy all workspace packages (needed for dependency resolution)
COPY packages/ packages/
COPY services/ services/
COPY apps/telegram-bot/ apps/telegram-bot/
COPY apps/telegram-miniapp/ apps/telegram-miniapp/

# Install all dependencies
RUN npm ci --ignore-scripts

# Build everything (turbo handles topological ordering)
RUN npx turbo build --filter=@helm-pilot/gateway --filter=@helm-pilot/telegram-bot --filter=@helm-pilot/telegram-miniapp

# ─── Stage 2: Production ───
FROM node:22-slim AS runner
WORKDIR /app

LABEL org.opencontainers.image.title="HELM Pilot"
LABEL org.opencontainers.image.description="Open-source, self-hostable autonomous founder operating system"
LABEL org.opencontainers.image.version="0.1.0"
LABEL org.opencontainers.image.source="https://github.com/Mindburn-Labs/helm-pilot"
LABEL org.opencontainers.image.license="MIT"

ENV NODE_ENV=production

# Create non-root user
RUN groupadd --system helm && useradd --system --gid helm --create-home helm

# Copy workspace config
COPY package.json package-lock.json ./

# Copy built packages
COPY --from=builder /app/packages/ packages/
COPY --from=builder /app/services/ services/
COPY --from=builder /app/apps/telegram-bot/ apps/telegram-bot/
COPY --from=builder /app/apps/telegram-miniapp/dist/ apps/telegram-miniapp/dist/

# Copy scripts for backup tooling
COPY scripts/ scripts/

# Install production dependencies only
RUN npm ci --omit=dev --ignore-scripts

# Create data directories with correct ownership
RUN mkdir -p /app/data/storage /app/backups && chown -R helm:helm /app/data /app/backups

# Switch to non-root user
USER helm

EXPOSE 3100

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:3100/health').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "services/gateway/dist/server.js"]
