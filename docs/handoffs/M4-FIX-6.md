# M4-FIX-6 Art: move three looks further from famous games

Status: done. Screenshot baselines are remade on CI (see "Baselines"). This card needs a visual
and IP review.

## What changed

- `src/render/atlas/painters.ts`, `paintOverlayTop` (the grass, snowy-stone and moss block
  sides): the top layer now ends in a **smooth wave**, two gentle humps across the tile. Neighbouring
  columns differ by at most one row, and the two tile edges meet, so a row of blocks shows one
  long wave. A darker rim runs along the edge, with a soft shadow on the base under it. On green
  tops (grass, moss) two or three small grass tufts (a tiny "v" of three pixels) sit on the dirt
  below. Snow gets no tufts. The old edge was a random drip per column (−1 to +2 rows), the familiar
  ragged fringe.
- `painters.ts`, `lamp` (the Lantern block, `lamp:ore-amber`): a **round paper lantern**. It is a
  glowing globe with three faint ribs across it, a dark halo, a small metal cap above and below,
  on a dark **wooden** board (`oak-bark`). The old one had four square orange panes in a grey metal
  frame with a cross bar. That is gone, and there is no grey grid now. The painter table in the doc
  comment says it uses `oak-bark` too.
- `src/content/mobs/moss-golem.model.json`: the flower on the golem's mossy cap (`petals`,
  `flower-heart`) is now a **mushroom**: a cream stem (`mushroom-stem`, 2×3×2) and a wide red-brown
  cap (`mushroom-cap`, 5×2×5, `#b8473a`). It is still 10 parts and flat colours, so the Defense
  draw-call counts (85 parts, `defense-view.test.ts`) don't change. The cap is a flat colour
  because `mushroom-cap` is an island block, not a registered `BlockId`.
- `src/ui/screens/WorldMap.module.css` (optional item 4): the "Go here next!" tag no longer has a
  negative top margin, so it sits inside its plate and no longer pokes up over the Meadow island's
  base.
- `tests/unit/atlas/painters.test.ts`: two fast-check properties (seed 211, 200 runs). The
  overlay edge moves at most one row between neighbouring columns, the two tile edges included,
  and stays within depth ±1. Grass and moss get 2–3 tufts, all below the edge's deepest row and
  above the bottom row; snow gets none.

## How each look differs from famous blocky games (IP check)

- **Grass side:** the familiar picture is a grass layer that ends in a ragged, random pixel drip
  over plain dirt. Ours ends in a smooth, regular wave with a dark rim and a shadow line, plus
  separate little tufts lower on the dirt. It still reads as grass: green top, green band on
  brown. It keeps the 16×16 pixel style and the palette.
- **Lantern:** the familiar lit-lamp block is a square grid of orange glass panes in a grey
  frame. Ours is a round lantern shape (a globe with ribs and caps, like a paper lantern) on brown
  wood, with no panes and no grey frame. The amber glow still says "a light" to a child.
- **Moss Golem:** the well-known stone golem holds a red flower. Ours has a mushroom growing on its
  mossy head, which fits a moss creature in the woods. The body, mossy cap, amber eyes and arms
  are as before (M4-03).
- I checked the results by eye at 8× (atlas preview), as cube icons (My Blocks), on the map
  islands and in the Model Lab, in local screenshots that are not attached here. The remade baselines
  show the same changes: `atlas.png` (grass side, lantern), `inventory-rich.png` (cube icons),
  `diorama.spec.ts/meadow-overview.png` (wavy grass edges) and `map-all-open.png` (round lanterns
  on Meadow Home, the tag inside its plate). No CI baseline shows the Moss Golem.

## Acceptance

- [x] Lantern block has a different look and still reads as a lantern: round glowing lantern on
      wood (atlas preview, My Blocks, map).
- [x] Moss Golem's flower swapped for a mushroom. 10 parts (≤ 32), §8.4 rules kept;
      `tests/unit/content/mobs.test.ts`, `tests/unit/dom/defense-view.test.ts` (draw calls) and
      `tests/unit/models` pass.
- [x] Grass side treatment changed (soft wave and tufts). Still clearly grass. Property test in
      `painters.test.ts`.
- [x] Optional: "Go here next!" moved off the Meadow island's base (the tag sits inside the
      plate).
- [x] Recipes stay procedural and pure. No image files were added. `paintTile` and the recipe
      types are unchanged, so the contract holds.
- [x] Affected baselines remade on CI with the Update snapshots workflow (see "Baselines").
- [x] `npm run verify` passes.

## Baselines

The grass and lantern changes alter every screenshot that shows the world, islands or block
icons. Those baselines were remade with `update-snapshots.yml` on this branch, never on Windows.

## Decisions

- The grass painter change is in the shared `overlay-top` painter, so the snowy-stone and moss
  sides get the same soft wave. That keeps one family look. Tufts are drawn only for the `grass`
  and `moss` ramps; snow-coloured "tufts" looked like specks.
- The golem's mushroom is flat-coloured, not atlas-tiled, so there are no spots. Spots would need
  another part (that changes the draw-call pins) or a registered mushroom block.

## New dependencies

- None.

## Notes for downstream tasks

- The map's label layout (`layoutLabels`) still places the Meadow plate's top edge just under the
  island's lowest blocks, and at some camera angles it touches them. The tag no longer overlaps,
  but the plate's own anchor is unchanged.

## Contract change request / Questions

- (none)

Closes #211
