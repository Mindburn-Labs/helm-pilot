# ─── Stage 1: Build ───
FROM node:22.22.2-slim AS builder
WORKDIR /app

# Copy workspace config
COPY package.json package-lock.json turbo.json tsconfig.base.json ./

# Copy web app and its dependencies
COPY apps/web/ apps/web/

# Install dependencies, including platform-native optional packages used by
# Next.js during production image builds.
RUN npm ci --include=optional --ignore-scripts

# Build the web app
RUN npx turbo build --filter=@pilot/web

# ─── Stage 2: Production ───
FROM node:22.22.2-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# Copy standalone output
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static

# The app does not use next/image; do not ship optional Sharp/libvips binaries.
RUN rm -rf node_modules/sharp node_modules/@img/sharp-*

RUN groupadd --system nextjs && useradd --system --gid nextjs --create-home nextjs \
  && chown -R nextjs:nextjs /app
USER nextjs

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
