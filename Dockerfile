# syntax=docker/dockerfile:1
# Voxel Typer container image: a static `dist/` behind unprivileged nginx (deploy/README.md).
#
# The build stage always runs on the build machine's own platform ($BUILDPLATFORM), because
# `dist/` is plain HTML/JS/CSS and the same for every architecture. The final stage has no RUN
# steps, so building the arm64 variant needs no QEMU emulation and costs almost nothing.

FROM --platform=$BUILDPLATFORM node:26-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY . .
# The Vite manifest is a build-time file; it has no business being served.
RUN npm run build && rm -rf dist/.vite

FROM nginxinc/nginx-unprivileged:alpine
LABEL org.opencontainers.image.title="Voxel Typer" \
      org.opencontainers.image.description="A voxel-world typing game for kids. Local-only, offline, no accounts." \
      org.opencontainers.image.source="https://github.com/chimericdream/voxel-typer"
# Our nginx.conf replaces the image's and doesn't include conf.d/, so the stock default.conf is unused.
COPY deploy/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
# uid 101 is the image's `nginx` user. Files above are root-owned and world-readable, so the
# server can read but never modify what it serves.
USER 101
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/ || exit 1
# Run nginx directly. The image's entrypoint scripts edit files under /etc/nginx, which would
# fail on a read-only root filesystem, and this config needs none of them.
ENTRYPOINT ["nginx", "-g", "daemon off;"]
