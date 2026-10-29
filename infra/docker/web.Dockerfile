# Web app image: the built single-page app served by nginx, which also forwards /api/ to the
# API so every company address stays same-origin (host-only cookies, no CORS).
# Build from the repository root:  docker build -f infra/docker/web.Dockerfile -t ultimate-erp-web .

FROM node:24.22.2-alpine AS build
WORKDIR /repo
RUN corepack enable
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@ultimate-erp/web...

# Runs as a non-root user and listens on 8080.
FROM nginxinc/nginx-unprivileged:1.30.6-alpine AS runtime
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
EXPOSE 8080
