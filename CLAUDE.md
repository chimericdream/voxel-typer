# CLAUDE.md

Voxel Typer is a browser typing game for kids aged 6–13, set in an original blocky voxel world. It
runs offline and stores everything on the device. `PLAN.md` says what to build. `docs/impl/` says how
the agents build it.

**Multi-agent workflow:** roles, git and PR flow, brief templates and milestone gates are all in
[`docs/impl/README.md`](docs/impl/README.md). Read it before you start a task. This file is only a
summary.

## Commands

| Command                            | Does                                                                         |
| ---------------------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`                      | Vite dev server                                                              |
| `npm run build`                    | Production build to `dist/`                                                  |
| `npm run typecheck`                | `tsc --noEmit` (strict) for `src/` and for tools/tests                       |
| `npm run lint`                     | Oxlint, `oxfmt --check`, `check-boundaries`, `check-ui-literals`             |
| `npm run format`                   | Oxfmt (writes changes)                                                       |
| `npm test`                         | Vitest unit and property tests                                               |
| `npm run test:cov`                 | Vitest with v8 coverage                                                      |
| `npm run e2e`                      | Playwright, headless Chromium; skips screenshot comparisons outside CI       |
| `npm run e2e:docker`               | The e2e suite in the Linux Playwright container, with screenshot comparisons |
| `npm run verify`                   | `typecheck && lint && test && build && size`: the merge gate                 |
| `npm run size`                     | Bundle budgets (`docs/impl/contracts.md` §14)                                |
| `npm run tool -- <name> [...args]` | Runs `tools/<name>.ts` through tsx                                           |

Run `npm run verify` before every push. Oxlint prints nothing when the code is clean, so check the
exit code.

## Purity rule (`PLAN.md` §6.3)

The typing engine is a pure library. These paths are **pure zones**:

- `src/engine/`
- `src/content/`
- `src/render/mesher/`
- `src/render/atlas/recipes.ts`
- `src/save/schema.ts`, `src/save/migrations.ts`

Pure code imports no DOM, no `three`, no Preact, no `idb`, and nothing from `@/ui`, `@/audio`,
`@/app` or the impure parts of `@/render`. It never reads the clock or randomness itself
(`Date.now()`, `new Date()`, `performance.now()`, `Math.random()`). Time and seeds come in as
parameters. Oxlint (`.oxlintrc.json`) and `tools/check-boundaries.ts` enforce this, and
`tests/unit/purity.test.ts` proves it. If you need the DOM or Three.js in `engine/`, stop and
refactor.

## Contracts

`docs/impl/contracts.md` defines the interfaces between modules and the file-ownership rules (§0).
Contracts are frozen after M1-01; see `docs/impl/README.md` §4.3. Don't change a shared type
quietly. Put a **Contract change request** in your handoff note and stop.

## Code rules

- TypeScript strict with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. No `any`
  without a `// reason:` comment. No `enum`.
- Type-aware Oxlint is strict about casts. Parse JSON into `unknown` and narrow it with a type guard.
- No network requests at runtime. Fonts are self-hosted.
- Each new runtime dependency goes in the handoff note with its gzip size. Prefer none.
- Tests sit next to the area: `tests/unit/<area>/*.test.ts`. Property tests use `fast-check` with a
  fixed seed.
- **Lint and format with the Oxc stack only (Oxlint, Oxfmt). Never add ESLint, Prettier or their
  plugins.** A missing check becomes a small `tools/check-*.ts` script.

## Kid-facing copy

- All kid-facing text goes through `t()` from `src/i18n/` (`contracts.md` §11).
  `tools/check-ui-literals.ts` fails lint on text literals in JSX under `src/ui/`, and on literals in
  `title`, `alt`, `placeholder` and `aria-*` text props. Text with only numbers, punctuation or
  symbols is allowed.
- Tone: warm, short, concrete. No sarcasm and no pressure words. Write "Almost! Try that key again",
  never "Wrong!". Sprout-band strings use words a 6-year-old can read.

## IP rule (`PLAN.md` §1, `docs/impl/README.md` §4.5)

Use no Mojang/Microsoft assets, names, textures, sounds, music, logos, fonts, mobs or characters.
Don't name anything after them. "creeper", "enderman", "redstone", "nether" and "steve" are banned in
identifiers and content. Every mob, block, texture, name and sound is original. The game shows this
footer: "Voxel Typer is an independent game and is not affiliated with Mojang or Microsoft."

## Priority order (`PLAN.md` §12.8)

When requirements conflict: **child safety/privacy > accessibility > learning effectiveness >
fun/juice > visual polish > scope**.

Ask the owner, don't guess, about: branding, buying any asset or font, publishing and hosting, and
anything that would send data off the device.

## Tasks, handoffs and records

- One task card per piece of work (`docs/impl/tasks-*.md`). Live status is in GitHub issues, one per
  card (`docs/impl/HANDOFF.md` §5).
- Branch `task/<ID>`, conventional commits scoped to the ID (`feat(M1-04): …`), one PR per task.
- Handoff notes go in `docs/handoffs/<ID>.md` (format: `docs/impl/README.md` §6). The note is also
  the PR body and ends with `Closes #<issue>`.
- `docs/decisions.md` and `docs/progress.md` belong to the orchestrator. Workers write their
  decisions in the handoff note.

## Windows dev, Linux CI

- The owner develops on Windows 11 (Git Bash and PowerShell 5.1). CI runs on Linux.
- Line endings are LF everywhere (`.gitattributes`, `.oxfmtrc.json`, `.editorconfig`).
- Screenshot baselines are made only on CI's Linux runner, through the Update snapshots workflow.
  For a local pixel check run `npm run e2e:docker`. Never commit baselines made on Windows.
