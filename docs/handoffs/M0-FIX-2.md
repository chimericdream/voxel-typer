# M0-FIX-2 Purity enforcement: allow-list and banned globals

Status: done

## What changed

- `tools/check-boundaries.ts`: the old relative-path denylist is replaced by an **import allow-list**. Every import, `export … from`, dynamic `import()`, `import x = require()` and `typeof import()` in a pure file is resolved (`@/` → `src/`, relative paths, `..`; on disk when the file exists, in bundler order `.ts` → … → `/index.ts`, `.js` → `.ts`). It passes only if the target is a pure-zone file, the import is type-only (`import type`, `export type`, `export type *`, every specifier inline `type`, `typeof import()`), or the specifier is a package on `PURE_PACKAGES` (empty). New rules `impure-import` and `package-import` replace `relative-import`. The messages name the pure file, the specifier, where it resolves to, and the rule. The global-object checks (`globalThis.fetch`, `self["navigator"]`, `globalThis.Intl.DateTimeFormat`) now read their names from the Oxlint override's `no-restricted-globals` and `no-restricted-properties`, so the two lists can't drift apart.
- `.oxlintrc.json`, pure-zone override: `env.browser` is off and `no-undef` is on, so any browser global that isn't listed fails by default. Only `console` and `structuredClone` are added back as globals. `no-restricted-globals` now covers `globalThis`, `self`, `window`, `document`, `navigator`, `location`, `localStorage`, `sessionStorage`, `indexedDB`, `fetch`, `XMLHttpRequest`, `WebSocket`, `crypto`, `setTimeout`, `setInterval` and `requestAnimationFrame`, each with a message. `no-restricted-properties` adds `Intl.DateTimeFormat`. `typescript/no-import-type-side-effects` is on (see Decisions). The `@/ui`, `@/audio`, `@/app` and `@/render` patterns are removed from `no-restricted-imports`, because the allow-list covers them by resolved path and allows their `import type`. The three, preact and idb patterns stay.
- `tests/unit/purity.test.ts`: 29 new fixture cases. `PURE_LOCATIONS` now comes from the one zone list (`pureZoneGlobs()`), so a newly listed pure file gets tested automatically. New unit tables cover resolution, type-only forms, packages, the message text and on-disk resolution order.
- `tests/fixtures/purity/cases/`: 29 new fixtures. `allowed-pure-imports.ts` now also covers `import type` and `export type` from `@/ui`, `@/render/scene`, `@/save/store`, `@/app` and `@/modes`, plus `typeof import()`, a `..` alias between pure folders, content JSON, `structuredClone` and `Intl.NumberFormat`.
- `CLAUDE.md`, purity section: a short paragraph on the allow-list, the browser env being off, and where the zone list lives.
- `docs/ci.md`: the `lint` row names the import allow-list.

## Acceptance

- [x] **Fixtures prove each case fails, and the allowed cases pass.** `npx vitest run tests/unit/purity.test.ts`: 799 passed. Each fixture is copied into all 6 pure locations, where it must fire, and 6 impure ones, where it must stay clean.
  - Transitive impure import through `@/`: `import-transitive-alias-store` (`@/save/store`, which pulls in idb) and `import-transitive-alias-modes` (`@/modes/mine`, which pulls in three). Through a relative path: `import-transitive-relative` (`../save/store`). Through `..`: `import-transitive-relative-dotdot` (`../engine/../save/store`) and `import-transitive-alias-dotdot` (`@/engine/../save/store`). The unit table also covers `src/save/schema.ts` → `./store` and `src/engine/x.ts` → `@/save/store` / `@/modes/mine` exactly as the card describes them. Related cases: `import-mixed-inline-type`, `export-star-impure`, `import-dynamic-impure`, `import-dynamic-computed`, `import-package`, `import-package-type`, `import-node-builtin`.
  - Banned globals, one fixture each: `global-crypto-getrandomvalues`, `global-crypto-randomuuid`, `global-fetch`, `global-xmlhttprequest`, `global-websocket`, `global-navigator`, `global-location`, `global-sessionstorage`, `global-localstorage`, `global-indexeddb`, `global-settimeout`, `global-setinterval`, `global-requestanimationframe`, `intl-datetimeformat`, `intl-datetimeformat-destructured`. `global-unlisted-browser` (`Notification`) proves that `no-undef` catches a browser global that is on no list. `globalthis-fetch` and `globalthis-intl-datetimeformat` cover check-boundaries.
  - Allowed: `allowed-pure-imports` (pure → pure, plus `import type` / `export type` from `@/render/scene`, `@/ui`, `@/save/store` and others) has no purity hits anywhere. `structuredClone` is allowed.
- [x] **Mutation check.** I replaced `if (isPureTarget(target, globs, opts.root)) return;` in `checkSource` with a bare `return;`, which removes the allow-list for internal imports, then ran `npx vitest run tests/unit/purity.test.ts`. Result: **125 failed, 674 passed**. That is all 16 internal-import fixtures (the 5 transitive ones, the 6 old alias ones, `import-relative-ui`, `import-alias-dotdot`, `import-mixed-inline-type`, `export-star-impure` and `import-dynamic-impure`) in all 6 pure locations (96 tests), plus 29 unit rows. Oxlint alone catches none of the transitive fixtures. I then restored the file.
- [x] **`npm run verify` green (exit 0)**, and nothing under `src/` changed. `src/` only has `main.ts` and `dev/hello-voxel.ts`, both outside the pure zones, so there are no real violations.
- [x] **The allow-list is described** in the `CLAUDE.md` purity section, with one line in `docs/ci.md`.

## Decisions

- The zone list stays in one place: the `files` of the `.oxlintrc.json` override that sets `no-restricted-imports`. Oxlint needs it there, check-boundaries reads it from there (`loadPureConfig`), and the test builds its pure locations from it. **For M1-01, add `"src/render/atlas/painters.ts",` to that `files` array, next to `"src/render/atlas/recipes.ts"`.** Nothing else needs editing. The test then copies every fixture to that path too, and `./painters` from `recipes.ts` becomes allowed. Remove or flip the `["src/render/atlas/recipes.ts", "./painters", true]` row in `purity.test.ts`, which records that painters isn't pure yet.
- Bare package specifiers fail even when they are type-only, because the card says packages must be on an explicit list and the existing `import-three-type` case already banned three's types. Type-only imports are allowed from any file inside the repo.
- `import { type A } from "@/ui/x"`, where every specifier is inline `type`, counts as type-only, as the brief asks. But with `verbatimModuleSyntax` TypeScript emits `import {} from "@/ui/x"`, so the impure module would still load at runtime. To close that hole I turned on `typescript/no-import-type-side-effects` in the pure zones, which makes authors write `import type { A }`. Fixture: `import-inline-type-side-effect`.
- `globalThis` is banned outright in pure zones. Pure code doesn't need it, and that also bans every `globalThis.x` route in Oxlint. check-boundaries keeps its own global-object check as a second layer.
- An import that can't be resolved on disk is accepted if any candidate path is pure, so fixtures and files not written yet don't fail. An unresolved import fails `typecheck` anyway. When the file exists, the first match on disk decides, so `src/engine.ts` beats `src/engine/index.ts` (tested).
- These now fail in pure zones: Vite `?query` imports, `import()` with a computed specifier, `node:` builtins, URLs and `#subpath` imports.

## New dependencies

- none

## Notes for downstream tasks

- Pure code can't use `setTimeout`, `crypto`, `Intl.DateTimeFormat` or any browser global. `console.warn` / `console.error` and `structuredClone` are allowed. To allow another global, add it to `globals` in the pure-zone override, and only if it is deterministic and does no I/O.
- Code that needs a type from an impure module (a `Scene` from `@/render/scene`, for example) must use `import type`.
- `Violation["rule"]` changed. `relative-import` is gone, replaced by `impure-import` and `package-import`. Nothing outside the test used it.

## Contract change request / Questions

- (none)

Closes #98
