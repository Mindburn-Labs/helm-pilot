# ─── Stage 1: Build ───
FROM node:22.22.2-slim AS builder
WORKDIR /app

# Copy workspace config
COPY package.json package-lock.json turbo.json tsconfig.base.json ./

# Copy web app and its dependencies
COPY apps/web/ apps/web/

# Install dependencies
RUN npm ci --ignore-scripts

# Build the web app
RUN npx turbo build --filter=@helm-pilot/web

# ─── Stage 2: Production ───
FROM node:22.22.2-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0

# Copy standalone output
COPY --from=builder /app/apps/web/.next/standalone ./
COPY --from=builder /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./apps/web/public

EXPOSE 3000

CMD ["node", "apps/web/server.js"]
