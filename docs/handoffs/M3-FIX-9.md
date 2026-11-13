# M3-FIX-9 Import/export leftovers

Status: done

## What changed

- **Two-tab safety** (new `src/save/tab-sync.ts`, plus `src/app/shell.ts`, `src/app/play-host.ts`, `src/main.ts`):
  - `announcingStore(store, channel, tabId)` wraps the IndexedDB store. After each successful `save`, `remove` or `importAll` it posts `{ v: 1, type: "saved" | "removed" | "changed", id?, from }` on `BroadcastChannel("voxel-typer-saves")`. A failed write posts nothing. A message holds only a profile id and a random tab id.
  - `browserLocks()` returns one Web Lock per player (`voxel-typer:profile:<id>`), or null where `navigator.locks` is missing (plain HTTP on a LAN, old browsers). `openTabChannel()` returns null where there is no `BroadcastChannel`.
  - Shell (`ShellDeps.tabs?`, set only for the real IndexedDB store; `?nosave` and `?profile` memory stores belong to one tab):
    - It keeps, per player, the stored record (JSON) this tab last wrote or read (`known`).
    - Every save runs one at a time in the tab, under that player's lock. It first reads the stored record and compares it with `known`.
    - **Another tab saved since:** this tab takes the newer copy first (`adopt`). A plain `saveProfile(p)` made from the old copy is refused (returns false) and the screen shows the newer copy. A lesson result, placement result, badges or a Builder save goes through the new `updateProfile(base, derive)` and is **added to the newer copy**, so neither tab loses progress.
    - **On a message:** the tab holding that player reloads it at once, the same way. A plain save asked for before that reload ran is refused too (a `generation` counter).
    - **Removed in another tab:** this tab drops the player, goes to Players, and never writes it back (`gone`). An import there that saves the id again clears this.
    - Notices: `otherTab` ("You played in another window too. This window has your newest blocks and stars now.") and `otherTabRemoved` ("This player was taken off in another window. Pick a player to keep going."), through `t()` in `app.save.*`. `Notice.kind` is now `NoticeKind = SaveProblemKind | "otherTab" | "otherTabRemoved"`.
    - With no `tabs`, saves work exactly as before (no queue, no extra read). This is what unit tests and memory stores use.
  - Play host:
    - New optional dep `updateProfile`. Lesson and placement finishes now start from the **live** profile (`liveProfile(r)`), not the copy from when the lesson began, like Builder and abandoned runs already did. A Settings change made during a pause is no longer written back over either.
    - `derive` reruns `applyResult` / `applyPlacement` on a newer copy and adds the run's new badges with `withUnlocks`, which never removes any.
    - Builder saves use `patchOnto`. The inventory is rebased: newer counts + (this visit's counts − the counts its last save started from), never below 0, keys at 0 kept (`rebaseCounts`). So blocks another tab found while the island was open are kept.
    - If another tab changed the **island itself**, the save is refused (two islands can't be merged), and the shell ends that Builder visit with the `otherTab` notice.
- **N4** (`ImportExport.tsx`, `import-export-logic.ts` `hasIsland`): each side of a conflict now ends with "Has an island." or "No island yet.". When this device's copy has an island, the file's copy has none, and "Use the file's copy" is offered, a line says so: "The file's copy of {name} has no island. If you use the file's copy, the island on this device goes away." (`data-island-gone`).
- **N5:** `dateText(at, lang = locale())` formats in the game's i18n locale. New `locale()` getter in `src/i18n/index.ts`, which is additive. The internal variable is renamed `current`.
- Strings: `importexport.import.{hasIsland,noIsland,islandGone}`, `app.save.{otherTab,otherTabRemoved}`.
- Tests:
  - `tests/unit/app/two-tabs.test.ts` (new, 10 tests): two shells over one shared backend, with a fake `BroadcastChannel` (async delivery that can be held or dropped) and fake shared locks.
  - `tests/unit/save/tab-sync.test.ts` (new, 6 tests).
  - `import-export.test.tsx`: N4 and N5, 4 new tests.

## Acceptance

- [x] **A two-tab test (unit, with a fake channel) proves the stale tab reloads or refuses to save.** `tests/unit/app/two-tabs.test.ts`:
  - "after another tab saves, the other tab reloads that player and says so kindly": B reloads A's copy, gets the `otherTab` notice, and every check-and-save ran under the player's lock.
  - "a stale tab refuses to save over newer progress when the message never came": messages dropped. B's save from its old copy returns false, A's change stays in the store, and B now shows it.
  - "a save asked for from the old copy, before the reload ran, is refused too": the generation guard.
  - "a lesson finished in the stale tab is added to the newer copy: nothing is lost", plus the same with the message delivered.
  - "a player removed in another tab is never written back".
  - "Builder keeps blocks another tab found…" and "two islands can't be merged: the stale Builder tab leaves, and its island isn't written".
  - "an import in another tab that replaces the player is taken, not written over" (M3-12 guard 10).
  - I removed each guard by hand to check it matters. Without the stored-record check, 8 of 10 tests fail. Without the generation check, 1 fails.
- [x] `npm run verify` passes: 4,413 unit tests, all bundle budgets met (main JS 58.24 kB gzip).
- No local e2e: it was evening (owner rule), so CI runs it. No screenshot should change: the new lines show only on the import check, and that has no baseline.

## Decisions

- **BroadcastChannel and a save-time check, with Web Locks when present. Not a lock that keeps a player to one tab.**
  - A lock held for as long as a player is open would block a sibling's tab with a "playing elsewhere" screen. It would need a steal flow. And where Web Locks are missing (plain HTTP), the fallback would protect nothing.
  - The check compares the stored record with the one this tab last saw. It is what guarantees a stale tab never wins, even if a message is late or there is no channel at all.
  - The message makes the other tab update right away, so the screen and the next lesson start from the newest copy.
  - Locks only make check-then-write atomic across tabs. Without them the gap is one IndexedDB read.
  - All of it stays on the device.
- **Refuse, or add on top?** Progress (lessons, placement, badges, Builder inventory) is added to the newer copy, so neither tab loses it. A plain save from an old copy (a settings tweak, a rename) is refused and the newer copy is shown with a kind notice. That loses one small change, never progress.
- **Two Builder visits of one player that both change the island** are the one case that can't be merged. The tab that saves second keeps the other tab's island and leaves the island. Building since its last autosave (at most 30 s, `AUTOSAVE_MS`) is not kept. Writing it would wipe the other tab's building.
- **Lessons now finish onto the live profile** (was: the copy from the lesson's start). This matches what Builder and abandoned runs already did. No existing test depended on the old base.
- No schema change. `SCHEMA_VERSION` stays 1, and nothing new is stored: `known` lives in memory and messages are not saved.

## New dependencies

- None.

## Notes for downstream tasks

- Settings keeps a local copy for display (`useState(start)`). After another tab's change, its controls can show the old values until the next change, but saves are built from `app.profile()`, so nothing stale is written. A small follow-up could make Settings follow `app.profile()`.
- Each save in tabs mode reads the record once more first, so saves are serialised per tab. A screen that saves on every slider step still works, but writes queue up.
- `PlayHostDeps.updateProfile` and `ShellDeps.tabs` are additive and optional. `AppApi` is unchanged.

## Contract change request / Questions

- None. Additive only: `src/save/tab-sync.ts` (new module), `locale()` in `src/i18n/index.ts` (next to `setLocale`, §11), and optional `ShellDeps.tabs` / `PlayHostDeps.updateProfile`.
- I touched files outside "the import/export screen and `src/save/` import code": `src/app/shell.ts`, `src/app/play-host.ts`, `src/main.ts`, `src/i18n/index.ts` and `src/i18n/en/app.ts`. Two-tab safety can't live in the import code alone, because every save goes through the shell.

Closes #179
