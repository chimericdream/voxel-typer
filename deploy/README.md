# Running Voxel Typer on Proxmox

The game is a static web app. GitHub Actions builds it into a container image and pushes it to
GHCR (`ghcr.io/chimericdream/voxel-typer`). The Proxmox host runs that image with Docker Compose,
and **Watchtower** pulls new images on its own. A **Tailscale sidecar** gives the game an HTTPS
address on your tailnet. Nothing is exposed to the internet, and GitHub never connects to your
server.

| Tag            | Published when                                        | Who uses it            |
| -------------- | ----------------------------------------------------- | ---------------------- |
| `:stable`      | a milestone or release tag (`m2`, `v1.0.0`) is pushed | the kids' instance     |
| `:m<N>`, `:v…` | the same tag push                                     | rolling back (pin one) |
| `:edge`        | CI passes on `main` (every merge)                     | optional owner preview |
| `:sha-<short>` | CI passes on `main`                                   | pinning an exact build |

Images are built for `linux/amd64` and `linux/arm64`.

## Why HTTPS (and why Tailscale)

Offline play and "install app" need a service worker, and browsers only allow service workers on
HTTPS (a "secure context"). Over plain `http://192.168.x.x` the game still works but loses
offline support and install. `tailscale serve` gets a real certificate for a `*.ts.net` name, so
no device needs to trust a home-made certificate. The catch: **every device that plays needs the
Tailscale app and must be on your tailnet**. See "Kids' devices" below, and the appendix if
that doesn't work for you.

## One-time setup in other places

Do these once, before the first `docker compose up`.

1. **Make the GHCR package public.** After the first image is published (it happens on the first
   merge to `main` after this file landed), go to github.com → your profile → **Packages** →
   `voxel-typer` → **Package settings** → **Change visibility** → **Public**. Watchtower then
   needs no login. The images contain only the built game, nothing private.
   - _If you'd rather keep it private:_ create a classic personal access token with only
     `read:packages`, then on the host run `docker login ghcr.io -u <your-github-user>` with the
     token as the password, and add `- /root/.docker/config.json:/config.json:ro` to the
     `watchtower` service's `volumes` (use the path of the config file `docker login` wrote).
2. **Turn on MagicDNS and HTTPS certificates** in the Tailscale admin console → **DNS**:
   enable **MagicDNS**, then under **HTTPS Certificates** click **Enable HTTPS**. Without both,
   `tailscale serve` can't get a certificate and the game won't load over HTTPS.
3. **Create an auth key** in the admin console → **Settings** → **Keys** → **Generate auth key**.
   Make it **not ephemeral** (the device should survive restarts), and give it a tag such as
   `tag:voxel-typer` (define the tag under **Access controls** first: `"tagOwners":
   {"tag:voxel-typer": ["autogroup:admin"]}`). A tagged device's key doesn't expire. Make it
   **reusable** only if you'll also run the edge preview. Keep the key somewhere safe; it goes in
   `.env` on the host and nowhere else.
4. Optional: in **Access controls**, let the kids' devices reach only `tag:voxel-typer` on port
   443, if your tailnet has other things on it.

## Install on Proxmox

1. **Create a container for Docker.** In the Proxmox web UI: **Create CT**, Debian 13 (or 12)
   template, 1 core, 512 MB RAM, 4 GB disk is plenty. On the **Options** tab after creating it,
   set **Features** → **Nesting** (and **keyctl** for an unprivileged CT). Docker needs nesting
   to run inside an LXC. A small Debian VM works too, if you'd rather not run Docker in an LXC.
2. **Install Docker** inside it, following Docker's Debian instructions
   (`https://docs.docker.com/engine/install/debian/`). Check with `docker compose version`.
3. **Copy this `deploy/` directory** to the host, for example to `/opt/voxel-typer`. Only
   `docker-compose.yml`, `serve.json` and `.env.example` are needed there.
4. **Configure:**
   ```sh
   cd /opt/voxel-typer
   cp .env.example .env
   nano .env            # paste the auth key into TS_AUTHKEY
   chmod 600 .env
   ```
5. **Start it:** `docker compose up -d`. Then `docker compose ps` should show `voxel-typer` as
   `healthy` within a minute, and `docker compose logs tailscale` should show the device logging
   in.
6. **Find the address:** it's `https://voxel-typer.<your-tailnet>.ts.net` (the tailnet name is in
   the admin console under **DNS**). The first load can take a few seconds while Tailscale gets the
   certificate. Open it from any device on the tailnet.

### Gotchas

- **The game is reachable only over the tailnet, not by the host's LAN IP.** `voxel-typer` shares
  the Tailscale container's network namespace (`network_mode: service:tailscale`) and publishes no
  port. That's on purpose. If you also want LAN access, see the appendix.
- **Check that `${TS_CERT_DOMAIN}` gets filled in.** `serve.json` uses `${TS_CERT_DOMAIN}` and the
  Tailscale container replaces it with the device's `*.ts.net` name when it starts. Confirm with
  `docker compose exec tailscale tailscale serve status`: it should list
  `https://voxel-typer.<tailnet>.ts.net` proxying to `http://127.0.0.1:8080`. If it shows the
  literal `${TS_CERT_DOMAIN}` (an older or changed Tailscale image), replace it in `serve.json`
  with the full name, for example `voxel-typer.example-tailnet.ts.net:443`, and
  `docker compose restart tailscale`.
- **Don't recreate the `tailscale` container on its own.** `voxel-typer` lives in its network, so
  after `docker compose up -d --force-recreate tailscale`, also restart `voxel-typer`
  (`docker compose up -d` does both when needed).
- **Another Watchtower on the same host** (for example the home dashboard's) only touches
  containers with its own scope. This one uses the scope `voxel-typer`. An _unscoped_ Watchtower
  started with `--label-enable` may also update these containers. That's harmless (same tag), but
  you can give the other one its own `--scope` to keep them apart.
- **Read-only container.** `voxel-typer` runs as an unprivileged user with a read-only filesystem,
  no Linux capabilities and a small tmpfs on `/tmp`. If you change `docker-compose.yml`, keep
  those.

## Kids' devices

Each device that plays needs the **Tailscale app**, signed in to your tailnet (Windows, macOS,
Linux, ChromeOS, iPad and Android all have one). Then open the `https://voxel-typer…ts.net`
address and, in Chrome or Edge, use **Install app** from the address bar so it opens like a normal
app and works offline.

**School-managed Chromebooks usually won't allow this:** schools often block installing apps and
joining other networks. If a kid's only computer is a school Chromebook, use the appendix route
instead, or play on a home device.

## Updates

Watchtower checks GHCR every 5 minutes. When a new `:stable` is pushed (after a milestone gate),
it pulls the image, recreates `voxel-typer`, and deletes the old image.

- **See what happened:** `docker compose logs --since 1h watchtower`. Look for lines saying it found a
  new `ghcr.io/chimericdream/voxel-typer:stable` image and stopped and recreated `/voxel-typer`.
  Lines saying it checked and updated nothing are normal.
- **Check the running build:**
  `docker inspect voxel-typer --format '{{ index .Config.Labels "org.opencontainers.image.version" }} {{ index .Config.Labels "org.opencontainers.image.revision" }}'`
  prints the tag and commit.
- **Update now** instead of waiting: `docker compose pull && docker compose up -d`.
- Kids' browsers pick up the new version the next time the game is opened (the page and service
  worker are always revalidated; only hashed files are cached long-term).

## Rolling back

Pin a milestone tag in `.env`:

```sh
VOXEL_TYPER_TAG=m2
```

then `docker compose up -d`. Watchtower keeps watching `:m2`, which never changes, so the
rollback sticks. Set it back to `stable` to follow new releases again. Tags are listed at
github.com/chimericdream/voxel-typer/pkgs/container/voxel-typer.

## Backups

**There is nothing to back up on the server.** The container holds only the game's files. All
game data (profiles, progress, settings) lives in each kid's browser, on their own device. If a
browser's data is cleared or a device is replaced, that progress is gone. Parents: use the
in-game **export** (in the grown-ups settings) now and then, and keep the file. It can be imported on
any device.

Back up `.env` (or just keep the auth key in your password manager) and the `ts-state` Docker
volume if you want the device to keep its Tailscale identity after rebuilding the host. Without
it, create a new auth key and the device re-registers.

## Optional: edge preview

To try every merge to `main` before the kids get it, uncomment `tailscale-edge`,
`voxel-typer-edge` and the `ts-state-edge` volume in `docker-compose.yml`, then
`docker compose up -d`. It appears as `https://voxel-typer-edge.<tailnet>.ts.net`. It uses
`TS_AUTHKEY_EDGE` from `.env`, or `TS_AUTHKEY` (which must then be reusable).

## Appendix: reverse proxy instead of Tailscale

If installing Tailscale on every device stops being practical (for example school Chromebooks),
serve the game from a reverse proxy on your LAN with a real domain instead:

1. In `docker-compose.yml`, remove the `tailscale` service and `network_mode`, and give
   `voxel-typer` `ports: ["127.0.0.1:8080:8080"]` (or put it on the proxy's Docker network).
2. Point a name you own, such as `typer.home.example.com`, at the proxy's LAN IP in your local DNS.
3. Have the proxy (Caddy, Traefik, nginx Proxy Manager…) get a Let's Encrypt certificate with the
   **DNS-01** challenge (works without opening any port to the internet) and forward to
   `http://<host>:8080`. Keep the response headers the image sends; don't add caching.

Devices then need nothing installed. Don't serve it over plain HTTP: it would work, but without
offline play or install.
