# M3-FIX-9 Import/export leftovers

Status: done (rework after data-safety review 1)

## What changed

- **Two-tab safety, the guard** (`src/save/store.ts`, approved contract change, see below):
  - New `SaveStore.saveIfUnchanged(p, expected)` and `StaleSaveError`. The compare runs **inside the save's own readwrite transaction** (`backend.write`'s plan), so another tab can't commit between the check and the write, with or without Web Locks.
  - Rules inside the transaction:
    - A newer game's record still rejects with `NewerSaveError`.
    - No record at all: removed in another tab, so `StaleSaveError` with `current: null`, and the player is never written back.
    - A readable record that isn't `expected`: another tab's save, so `StaleSaveError` carrying that profile and its JSON.
    - **A damaged record** is nobody's save. The write goes ahead and repairs it, and the good `:prev` stays (review B1).
  - `save` is now `put(p)` with no `expected`. Its behaviour is unchanged.
- **Messages and locks** (`src/save/tab-sync.ts`):
  - `guardedStore(store, { tabId, channel, locks })` replaces `announcingStore`.
  - It posts on `BroadcastChannel("voxel-typer-saves")` after each successful write.
  - Every write of one player (`save`, `saveIfUnchanged`, `remove`) holds that player's Web Lock. That covers the shell, ImportExport's per-player saves, the Players screen's edits of a non-active player, and removes. The locks are an extra guard, not the guard.
  - `importAll` takes no lock: it never writes over a stored id, because a clash gets a fresh one. Nothing in the UI calls it.
- **Shell** (`src/app/shell.ts`). With `tabs`, every save is `saveIfUnchanged(next, known[id])`, one at a time within the tab.
  - **On `StaleSaveError`** the tab takes the stored copy (`adopt`).
    - `updateProfile` runs `derive` again on that copy, up to 5 times, so a lesson, placement or Builder save is added to the newer progress.
    - A plain `saveProfile` made from the old copy is refused.
    - With `current: null` the player is dropped (`gone`), the tab goes to Players, and it shows the `otherTabRemoved` notice.
  - **On a message** the tab holding the player loads it and adopts it if it differs, so the screen updates at once. A plain save asked for before that ran is refused (`generation`).
  - **`updateProfile`** now returns null whenever nothing was saved: refused, read-only, or a storage failure (review item 6).
  - The shell no longer takes locks itself; `guardedStore` does. Web Locks aren't re-entrant, so a lock in both places would deadlock.
- **Play host** (`src/app/play-host.ts`):
  - `derive` is now pure: it may run once per newer copy.
  - Builder remembers every island it started with or handed out to save (`Run.islands`, JSON → its inventory). A stored island on that list is this visit's own. Any other island was changed by another tab, and `patchOnto` returns null.
  - This replaces "the last save's base", which went wrong when a save was still in flight (`builder.test.ts` › "the save on leaving builds on the profile as it is now", from `main`).
  - **Review B2:** when `patchOnto` is null on the finish path, the visit keeps the other tab's island **and** inventory, so each block is counted once. It still saves the practice session (history, keyStats, bigramStats, sessionCounter, weekly/daily) and the badges earned live. `found` is untouched. Autosaves that hit a changed island still save nothing.
- **Players screen** (`src/ui/screens/Profiles.tsx`, one line): `pick` calls `app.setProfile(loaded)` before saving the placement-test mark. The save then starts from the copy just loaded, and the mark isn't refused (review item 7).
- `import-export-logic.ts`: the `lessonsDone` doc comment is back above `lessonsDone` (review nit).
- **Unchanged from the first round:**
  - **N4:** "Has an island." / "No island yet." on each side, plus the `data-island-gone` warning.
  - **N5:** `dateText(at, lang = locale())`, with `locale()` in `src/i18n/index.ts`.
  - Notices `otherTab` and `otherTabRemoved` (`app.save.*`, through `t()`).
- Tests:
  - `tests/unit/app/two-tabs.test.ts`: 15 tests, 5 of them new, for B1, B2, removal with a lost message, lock coverage and the placement mark.
  - `tests/unit/app/two-tabs-race.test.ts` (new): the reviewer's race harness.
  - `tests/unit/save/save-if-unchanged.test.ts` (new): 5 tests.
  - `tests/unit/save/tab-sync.test.ts`: 6 tests.
  - `import-export.test.tsx`: N4 and N5.

## Acceptance

- [x] **A two-tab test (unit, with a fake channel) proves the stale tab reloads or refuses to save.** `two-tabs.test.ts`: "…reloads that player and says so kindly", "a stale tab refuses to save over newer progress when the message never came", "a save asked for from the old copy, before the reload ran, is refused too".
- [x] **Review B1:** "one tab, damaged current record: the next save keeps everything, no 'other window'". After two lessons the current record is damaged, and the next save keeps every lesson record, both loot ids in `inventory` and `found`, and the full history. There's no `otherTab` notice.
- [x] **Review B2:** "two islands can't be merged: B keeps A's island and blocks, and still saves its session". The store holds A's island and inventory exactly, `foundBlocks` is unchanged, and history and sessionCounter are +1.
- [x] **Removed with the message lost:** neither a lesson finish nor a plain save brings the player back (`map.has(id) === false`), and B shows `otherTabRemoved`.
- [x] **Lock coverage:** "imports, the Players screen's edits and removes take the player's lock".
- [x] **Placement mark:** "picking a player whose copy changed elsewhere keeps the placement-test mark".
- [x] **Randomized race** (`two-tabs-race.test.ts`): 40 seeds × {Web Locks, no locks} × {0 %, 50 %, 100 % of messages lost}. Delivered messages come 0–5 tasks late, so some are on time and some late. Every read and write waits 0–2 tasks. Each tab finishes 4 lessons with its own loot.
  - The result is **zero lost lessons and zero double counts in all 240 runs**: plays, history and sessions are each +8, and every loot id is in `inventory` and `found` exactly once.
  - I ran it once with the reviewer's `setTimeout` waits (240/240 clean, 235 s). The committed version waits with microtasks so it runs in under a second.
  - With the in-transaction compare disabled, all 6 cells fail, so the test does catch the race.
- [x] `npm run verify` passes: 4,437 unit tests, all bundle budgets met (main JS 58.56 kB gzip).
- No local e2e: it was evening (owner rule), so CI runs it.

## Contract change (approved by the orchestrator, README §4.3, additive)

Text for `docs/impl/contracts.md` §15. In the `SaveStore` interface, after `save`:

```ts
  saveIfUnchanged(p: Profile, expected: string): Promise<string>;  // M3-FIX-9: `save`, only if the stored record is still `expected` (the JSON this tab last wrote or read), checked in the write's own transaction; resolves with the JSON now stored
```

After the "Newer saves are never overwritten" paragraph:

> **Two tabs (M3-FIX-9).** `saveIfUnchanged(p, expected)` compares the stored current record with `expected` inside the write's readwrite transaction. If the record is gone (removed elsewhere), or readable and different (another tab saved), it rejects with `StaleSaveError { profileId, current: Profile | null, record: string | null }` and writes nothing. A damaged current record counts as unchanged: the save repairs it and keeps the good `<id>:prev`. A newer record still rejects with `NewerSaveError`. The app's IndexedDB store is wrapped by `guardedStore` (`src/save/tab-sync.ts`). It posts `{ v: 1, type: 'saved' | 'removed' | 'changed', id?, from }` on `BroadcastChannel('voxel-typer-saves')` after each write, and holds the Web Lock `voxel-typer:profile:<id>` for each write when `navigator.locks` exists. Messages hold only ids and stay in the browser.

## Decisions

- **The guard is the in-transaction compare-and-swap. Messages and Web Locks are extras.**
  - The compare runs where the write runs, so it holds with no locks (plain HTTP on a LAN), with late or lost messages, and across every writer.
  - The message makes the other tab update at once.
  - Locks keep one player's writes from different tabs in order.
  - A lock that keeps a player to one tab was rejected: it blocks a sibling's tab, needs a steal flow, and protects nothing where locks are missing.
- **Refuse, or add on top?** Progress (lessons, placement, badges, Builder) is added to the newer copy, so neither tab loses it. A plain save from an old copy (a settings tweak, a rename) is refused, and the newer copy is shown with a kind notice. That can lose one small change, never progress.
- **Two Builder visits that both change the island** can't be merged. The visit that saves second keeps the other tab's island and inventory. It still saves its practice session and badges, and the tab returns to the map. What it doesn't keep is **its own island edits since its last successful save**, and the blocks those edits used go back to the counts the other tab saved. Every block is still counted once (island plus inventory per block). That can be more than 30 s of building when its autosaves were refused too.
- **Lessons finish onto the live profile** (was: the copy from the lesson's start), like Builder and abandoned runs already did.
- No schema change, `SCHEMA_VERSION` stays 1, nothing new is stored.

## New dependencies

- None.

## Notes for downstream tasks

- **PR #196 (M3-06)** also touches `src/app/shell.ts` (remedial lesson lookup) and `src/app/progress.ts`. My shell changes sit in one block, "Two-tab safety (M3-FIX-9)", between `setProfile` and `removeProfile`, plus the channel listener just before the initial `pick`. `lessonById` and `enter` are untouched.
- Settings keeps a local copy for display (`useState(start)`). After another tab's change, its controls can show the old values until the next change, but saves are built from `app.profile()`, so nothing stale is written. A small follow-up could make Settings follow `app.profile()`.
- **Known small edge:** a message-driven reload uses `store.load`, and if the current record is damaged, `load` returns `:prev`. A tab could then show `:prev` after another tab's message. It needs a message and a damaged record at once, and the in-transaction check still stops any write over newer data.
- **Known small edge:** when the player is already active in this tab and its known copy is stale (a lost message), the placement-test mark saved on pick is refused once. The tab then shows the newer copy, and the next pick offers the test again.
- `PlayHostDeps.updateProfile` and `ShellDeps.tabs` are additive and optional. `AppApi` is unchanged.

## Contract change request / Questions

- The `saveIfUnchanged` / `StaleSaveError` change above is approved. Please copy the text into contracts.md §15.
- Out-of-Owns files touched: `src/app/shell.ts`, `src/app/play-host.ts`, `src/main.ts`, `src/i18n/index.ts`, `src/i18n/en/app.ts`, plus one line in `src/ui/screens/Profiles.tsx`. The reviewer agreed these are needed (review item 8).

Closes #179
