# M3-FIX-1 World map polish from the M3-04 review

Status: done. Waiting on the required visual and accessibility review.

## What changed

- **Meta line (review N1).** `src/ui/screens/WorldMap.tsx`, `src/i18n/en/map.ts`: an island's label reads "0 of 6 done" (`map.island.count` is now `"{done} of {total} done"`). The star count shows only once there are stars, after the words: "6 of 6 done ★ 16". The screen-reader name is unchanged ("Meadow Home, 0 of 6 lessons done, 0 stars. Go here next!"); it already said all of this in words.
- **Labels (N2).** `layoutLabels` in `src/ui/screens/map-logic.ts` (plain numbers, unit-tested) places every island label: centered under its island, then pushed down out of the heading and the "Change player" corner, kept 10 px inside the window (the focus ring reaches 7 px out), and pushed sideways from its neighbours, with a 12 px gap. If a row has no room left, the later label moves below the earlier one. `WorldMap.tsx` measures the buttons and calls it on every camera move, on resize, and through a `ResizeObserver` when label sizes change (fonts arriving, a new text size). A label is at most a third of the window wide (`--label-max`), so a long name wraps and three labels always fit side by side. The focused label's spot gets `z-index: 2` (`.spot:focus-within`), so its ring always shows.
- **Locked islands (N3, N4).** `src/render/map/tiles.ts`: `WASH_GRAY` 0.82 → 0.55 and `WASH_MIST` 0.5 → 0.35, so the clouds keep a hint of each biome's colour (snow pale blue, mushrooms red, crystals purple). `WorldMap.module.css`: the locked-label stripes use the plate's text colour at 22 % (32 % in high contrast), not black at 16 %, and a locked label shows a small blocky cloud before its name.
- **Clicking a locked island (N7).** It wobbles sideways for 0.38 s (Web Animations, skipped under reduced motion), plays a soft `pop` at half gain, and shows a kind line under the heading for 4 s: "Finish Meadow Home to open this island!" (`map.island.notYet`; `notYetFirst` for an island with nothing before it). The line is an `<output>`, a polite live region, and floats under the heading, so the labels don't move. Any key clears it. It doesn't navigate.
- **Rebuilds (N6).** The 3D effect is keyed on `profile.id` and the sorted unlocked biomes, not the profile object. When it does rebuild, it starts on the path that is open now, not the one from the first mount, and reads reduced motion from the current profile.
- **Tests.**
  - `tests/unit/ui/map.test.tsx`: meta line words and stars, the locked click (note, sound, no navigation, cleared by a key, gone after 4 s), `notYetLine`, and 5 `layoutLabels` cases. These use the real 1024×720 anchors with label sizes for scale 1.5 and 2, and a too-narrow row.
  - `tests/unit/ui/map-rebuild.test.tsx` (new): with a fake scene and a mocked view, a settings-style profile change doesn't rebuild the view, and a newly opened island rebuilds it close on the open path. This test fails against the old `[app, profile]` dependency list.
  - `tests/unit/render/map.test.ts`: the wash keeps each hue.
  - `tests/e2e/map.spec.ts` › "labels fit at large text": 1024×720 and 1280×720, text scales 1.5 and 2, a new and a veteran player (8 tests). It checks that no label box (with the "Go here next!" tag) is clipped, counting a 7 px ring, that no two labels overlap, that no label overlaps the heading or the corner button, and that a focused label's own button is what's under it.

### Outside Owns (kept small)

- `tests/unit/ui/screens/harness.tsx`: an optional `acquireScene` for `mount()` (default unchanged: no scene).

## Acceptance

- [x] **Each item fixed, or listed with a reason.** All five are fixed (above). Not done, on purpose: the Pixelify bold C/O and 5/S issue (N5) belongs to M3-FIX-2, and nothing here changes fonts.
- [ ] **Map baselines refreshed through the Update snapshots workflow; visual and a11y review passes.** Baselines are regenerated on CI (paths below). The review is for the reviewer.
- `npm run verify` exits 0.
- Local e2e (after midnight, one worker, private port): `map.spec.ts` › "labels fit at large text" (8) and the keyboard-only trip pass. I also looked at local screenshots at 1024×720 and 1280×720, scales 1.5 and 2, for a new and a veteran player: every label is inside the window and clear of the others, and "Sparkstone Factory" and "Crystal Caverns" wrap to two lines at 1024 px, scale 2.

## Decisions

- **Labels are laid out by a small solver, not left to CSS.** They hang from points that move with the camera, so only script knows where they collide. It is plain arithmetic over nine boxes and runs only when the picture or a label's size changes.
- **A label is at most a third of the window wide**, so three always fit across and a long name ("Sparkstone Factory" at scale 2) wraps to two lines instead of covering its neighbour.
- **The "not yet" line goes under the heading, not by the island.** A bubble by the island would need its own collision handling, and the wobble already answers at the spot the child clicked. The line never moves the labels.
- **Locked stripes use the plate's text colour.** Black stripes vanish on the dark plate. At 22 % (32 % in high contrast) white text stays at least 5:1 even on the light stripes over a white sky (about 5.3:1 on the day plate, 6.0:1 on the high-contrast one).
- **The screen-reader name keeps "0 stars".** Hiding the count only fixes a visual problem (two numbers side by side). Spoken words don't have that problem, and the review found the spoken name fine as it is.

## New dependencies

- None.

## Notes for downstream tasks

- **M3-08 (settings):** a text-size change on the map re-lays out the labels by itself (`ResizeObserver`), and a settings save no longer rebuilds the 3D view.
- **M3-07 (high-contrast baselines):** the locked stripes have a high-contrast strength (`:root[data-theme="contrast"]`).
- **Any new label-like DOM over the map** (an achievement badge, say) should be added to the keep-out list in `place()` in `WorldMap.tsx`, or it can be covered.
- **Baselines:** `map-new-player.png` changes with the wash (locked islands) and the meta line; `map-all-open.png` with the meta line.

## Contract change request / Questions

- None.

Closes #151
