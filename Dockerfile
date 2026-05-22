# --- Build Stage ---
FROM node:22-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

# =============================================================================
# Docker build targets
# =============================================================================
#
# Direct (manual tagging, for CI or custom needs):
#   docker build --target prod -t openinspection:prod .
#   docker build --target test -t openinspection:test .
#
# The `prod` target (last stage, default) is for real deployments.
# The `test` target is for CI, demos, and local "batteries-included" testing.
# =============================================================================

# --- Base runtime image (shared by prod + test targets) ---
# Contains Chromium (for PDF generation), production node_modules, compiled
# assets, and the default CMD. This stage is never used directly as a final
# image — use one of the named targets below instead.
FROM node:22-slim AS base

# Install Chromium and dependencies for Puppeteer
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-ipafont-gothic \
    fonts-wqy-zenhei \
    fonts-thai-oe \
    fonts-kacst \
    fonts-freefont-ttf \
    libxss1 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use the installed Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy only necessary files from builder
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/public ./public

# Install only production dependencies
RUN npm ci --omit=dev

# --- Database Seeder Stage (internal, not a final target) ---
# Runs inside the full builder context (dev deps + tsx + source) to:
#   1. Run all migrations (db:build)
#   2. Start a temporary server and POST to the real /api/auth/setup
#      (creates first admin + auto-seeds recommendations, events, templates)
#   3. WAL checkpoint + shutdown
# The resulting seeded .db is copied only into the `test` target below.
FROM builder AS seeder

# No extra packages needed — the seed script uses only Node built-ins (fetch, child_process)
# plus better-sqlite3 (already in the builder image from `npm ci`).

ENV DB_PATH=/app/data/test.db
ENV JWT_SECRET=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
ENV SETUP_CODE=
ENV PORT=9876
ENV STORAGE_DIR=/app/data/storage
ENV APP_MODE=standalone

RUN mkdir -p /app/data /app/data/storage

# Apply all migrations (creates the .db file with full schema)
RUN npm run db:build

# Run the canonical seeder script. It boots a temporary server (via tsx on the
# real src/server.ts), calls the production /api/auth/setup endpoint (which
# creates the first admin + auto-seeds recommendations, event types, and the
# 6 default inspection templates), then checkpoints the WAL and exits.
# The script is idempotent (409 from setup is treated as success).
RUN node scripts/db/seed-test.js

# --- Test target (batteries-included, pre-seeded database) ---
#   docker build --target test -t openinspection:test .
#
# Produces a runnable container image whose SQLite database is already
# fully migrated + seeded. Contains the initial admin account and all
# default seeded data that the /setup wizard would create.
#
# Ideal for CI, demos, local development, or "batteries-included" test runs
# where you do not want to go through the first-run setup flow.
#
# Default credentials after first run:
#   email:    admin@test.local
#   password: TestPass123!
#
# Run:
#   docker run -p 8788:8788 --rm openinspection:test
#   
# then browse to http://localhost:8788/login — no setup required
#
# To override the baked DB (e.g. start fresh), mount a volume or pass
#   -e DB_PATH=/app/data/openinspection.db
FROM base AS test

# Inject the pre-seeded database file produced by the seeder stage
COPY --from=seeder /app/data/test.db /app/data/test.db

RUN mkdir -p /app/data/storage

# Point the app at the baked seeded DB by default
ENV DB_PATH=/app/data/test.db

EXPOSE 8788
CMD ["node", "dist/src/server.js"]

# --- Production target (clean, no pre-seeded database) ---
#   docker build --target prod -t openinspection:prod .
#   docker build -t openinspection:latest .     # (no --target) → prod (last stage)
#
# Standard production image. On first run the database will be created
# empty and the user must complete the setup wizard (or call the setup API).
FROM base AS prod

EXPOSE 8788
CMD ["node", "dist/src/server.js"]
