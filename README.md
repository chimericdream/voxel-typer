# Voxel Typer

> Type to mine. Type to build. Type to survive the night.

Voxel Typer is a typing game for kids aged 6–13. It runs in the browser and is set in a blocky voxel
world. Every action in the game (breaking blocks, fending off mobs, placing blocks, driving
minecarts) happens by typing the right keys. Under the game is a home-row-first curriculum that
adapts to each key, so kids learn to touch type while they play.

It is early in development. [`PLAN.md`](PLAN.md) describes the game, and
[`docs/progress.md`](docs/progress.md) shows how far along it is.

## Privacy

- No accounts, no chat, no ads and no tracking.
- The game makes no network requests while it runs. The finished game will install as an offline
  app.
- Profiles use a nickname, and all progress stays in the browser on that device. Parents will be
  able to export or delete it from inside the game.

These promises come from `PLAN.md` §1 and §6.7.

## Running it

The repo pins its Node version (and with it npm) in [`mise.toml`](mise.toml). With
[mise](https://mise.jdx.dev) installed:

```sh
mise trust && mise install   # once per clone: installs the pinned Node and npm
npm ci
npm run dev       # dev server at http://localhost:5173
npm run verify    # typecheck, lint, tests, build, bundle size
npm run e2e       # browser tests (Playwright, Chromium)
```

Without mise, use the Node version in `.nvmrc`. [`CLAUDE.md`](CLAUDE.md) lists every command.

## Docs

- [`PLAN.md`](PLAN.md): the game design and technical plan.
- [`docs/impl/`](docs/impl/README.md): how the work is split into tasks, the module contracts and the
  dependency graph.
- [`CONTRIBUTING.md`](CONTRIBUTING.md): how a change gets from a branch to `main`.
- [`docs/decisions.md`](docs/decisions.md): decisions made so far, with dates.
- [`docs/handoffs/`](docs/handoffs/): one note per finished task.

## Disclaimer

Voxel Typer is an independent game and is not affiliated with Mojang or Microsoft. All of its
blocks, creatures, textures, names, sounds and music are original.
