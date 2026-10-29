# API and background worker image (docs/modules/files-monitoring.md §4).
# Build from the repository root:  docker build -f infra/docker/api.Dockerfile -t ultimate-erp-api .
# Run the API:      docker run ultimate-erp-api
# Run the worker:   docker run ultimate-erp-api node --enable-source-maps dist/worker.js
# Run migrations:   docker run -e DATABASE_MIGRATOR_URL=... ultimate-erp-api \
#                     node node_modules/@ultimate-erp/db/dist/cli/migrate.js

FROM node:24.22.2-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@ultimate-erp/api...
# A self-contained copy of the API with production dependencies only.
RUN pnpm --filter @ultimate-erp/api deploy --prod /out/api

FROM node:24.22.2-alpine AS runtime
ENV NODE_ENV=production \
    API_HOST=0.0.0.0 \
    API_PORT=3000
WORKDIR /app
COPY --from=build --chown=node:node /out/api ./
# Never run as root inside the container.
USER node
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=3s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:3000/api/v1/health/live || exit 1
CMD ["node", "--enable-source-maps", "dist/main.js"]
