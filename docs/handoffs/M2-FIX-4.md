# M2-FIX-4 Flowers as small sprigs, not full blocks

Status: done

## What changed

- `src/content/blocks/types.ts`: `BlockShape = "cube" | "sprig"` and `BlockDef.shape?: BlockShape`
  (decision 82, approved and additive). A missing shape means cube.
- `src/content/blocks/flora.ts`: the four flowers are `shape: "sprig"`. Their bottom face now uses a
  new `flowers-under` painter instead of dirt, because the bottom tile is the bloom's underside.
- `src/render/mesher/voxel-grid.ts`: `meshChunk` meshes a sprig as four sub-voxel boxes inside its
  cell. Sizes are in 16ths of a block:
  - stem: 2 wide, 6 tall (4 side faces);
  - bloom: 6 × 4 × 6 on top of the stem, so the sprig is 10/16 tall overall (6 faces);
  - two leaf nubs: 3 × 1 × 2, at heights 2 and 3, on opposite sides of the stem (5 faces each).

  That makes 20 quads per flower. Sprigs don't use crossed billboards (IP rule).
  - A sprig counts as air to its neighbours. It hides none of their faces and darkens none of their
    AO.
  - Its own vertices are all at brightness 1.0.
  - A fixed hash of the cell's (x, z) gives half the sprigs a quarter turn (x and z swapped), so a
    patch doesn't look stamped. The same grid always gives the same mesh.
  - Cube meshing is unchanged.

- `src/render/mesher/voxel-grid.ts`: `AtlasLookup` gains an optional `shape?(blockNum)` method. See
  the contract change request below.
- `src/render/atlas/build.ts`: `createAtlasLookup` implements `shape()` from `BlockDef.shape`.
- `src/render/atlas/painters.ts`: the flower painters now lay their tiles out to match the boxes.
  - `flowers-side`: the sprig seen from the side (stem in columns 7–8, bloom in columns 5–10 and
    rows 6–9 from the bottom, two leaves). It is clear around the sprig, so it also serves as the
    block's icon in the hotbar, loot flight and Results: a little flower.
  - `flowers-top`: the bloom from above (columns and rows 5–10) with a gold middle, or an orange one
    on the yellow flower. It is clear around the bloom.
  - `flowers-under` (new): the bloom's shaded underside, with green where the stem joins.

  Leaf faces sample a fixed strip of the side tile (the right leaf). Every other face shows the part
  of its own tile that it covers.

- `src/render/chunks.ts`: `splitByBucket` used to assign a quad to the cell half a unit behind its
  centre. It now uses the cell 1/64 behind it. The result is the same for every cube face. Without
  the change, a sprig's leaf top (at 3/16) would land in the cell below and could switch to that
  block's material, for example glass or water. This file is outside the card's Owns list; it is a
  one-line change.
- Tests:
  - `tests/unit/mesher/sprig.test.ts` (new);
  - a sprig section in `tests/unit/render/chunks.test.ts`;
  - the sprig tile checks in `tests/unit/atlas/painters.test.ts` replace the M2-FIX-2 lawn checks;
  - `tests/unit/content/blocks.test.ts`: the "see-through pixels need the transparent tag" rule now
    applies to cube blocks only. A sprig is never tagged transparent.

## Acceptance

- [x] Mesher unit tests cover sprig geometry, no face culling against sprigs, and determinism
      (`tests/unit/mesher/sprig.test.ts`, 12 tests):
  - geometry:
    - a lone sprig is 20 quads, with all corners inside its cell, in both turns;
    - the bloom is 6/16 wide on a 2/16 stem, 10/16 tall;
    - every triangle winds outward;
    - the bloom top's UVs are the middle 6/16 of the top tile, and the leaves' UVs are the side
      tile's leaf strip;
    - the two turns differ only by an x/z swap;
    - an atlas without `shape()` still meshes a flower as a cube.
  - no culling and no AO:
    - an enclosed sprig still meshes, and all 6 neighbours keep their faces toward it;
    - stones under and beside sprigs mesh exactly as if the sprigs were air (same quads, UVs and AO
      colours);
    - fast-check property (seed 820011, 200 runs, AO on and off): on random grids of stone, glass
      and flowers, the non-sprig quads equal the mesh with every sprig turned to air, and each
      sprig adds exactly 20 quads.
  - determinism:
    - the same grid gives the same mesh, byte for byte;
    - the turn depends only on (x, z).
- [x] No extra draw calls (`tests/unit/render/chunks.test.ts`):
  - each sprig quad, leaf tops included, goes to the sprig's own bucket, even with glass or water
    below it;
  - adding 40 flowers to a chunked floor keeps the mesh count the same, and every mesh uses the
    opaque material.

  E2E peak draw calls (logged on CI's SwiftShader):

  |                       | meadow-01 (Sprout) | meadow-01 | meadow-02 | meadow-03 | meadow-04 | meadow-05 | meadow-06 |
  | --------------------- | ------------------ | --------- | --------- | --------- | --------- | --------- | --------- |
  | Before (main 7d8f82c) | 24                 | 25        | 26        | 26        | 26        | 26        | 26        |
  | After (e2bbc2f)       | 26                 | 25        | 26        | 26        | 26        | 26        | 26        |

  The lesson peaks are unchanged. The Sprout peak includes transient fx and loot meshes and is
  noisy on main as well: 28 at 4af5eb2 and 24 at 7d8f82c. The diorama spec's per-seed budget
  (60 or fewer) passes.

- [x] Meadow baselines are refreshed through the Update snapshots workflow: the Update snapshots workflow wrote
      `tests/e2e/__screenshots__/atlas.spec.ts/atlas.png` and `diorama.spec.ts/meadow-mine.png`.
      I deleted `diorama.spec.ts/meadow-overview.png` so CI would regenerate it. The slice and sky
      baselines still pass within tolerance and were not regenerated.
- [ ] Visual review: flowers should read as flowers at overview and play distance. This is for the
      reviewer and the owner. My own look: in `meadow-mine.png` (play distance) the flowers clearly
      read as little red, yellow, purple and blue flowers on stems. In `meadow-overview.png` they
      are small coloured specks on the lawn, so you can see where they are but not their shape.
- `npm run verify` passes.

## Decisions

- **Shape reaches the mesher through `AtlasLookup.shape?()`.** It sits next to `transparent()`,
  which is also a per-block fact the mesher gets from the atlas. The mesher can't import the block
  registry, because `content/blocks/index.ts` uses `import.meta.glob` (Vite only) and that would tie
  the pure mesher to the content set.
- **The sprig is 2/16 stem, 6/16 bloom and 10/16 tall.** The card asks for about 5/8 overall; this
  is exactly 5/8. The bloom is the widest part, so the flower's colour faces the overview camera.
- **Half the sprigs get a quarter turn**, chosen by a fixed hash of (x, z), so leaves don't all
  point the same way. It is deterministic and needs no rng.
- **Sprigs get no AO at all**, not even from their own boxes. The card says a sprig takes no AO
  from its neighbours and casts none onto them. With AO off, every quad keeps the default diagonal.
- **Sprigs stay in the opaque bucket.** The clear pixels around the sprig in the tiles are never
  sampled by the mesh. The opaque material already has `alphaTest: 0.5`.
- **Mine mode needs no change.** `pickTargetBlock` uses only `common` loot entries, and flowers are
  `uncommon`. Flowers drop as loot and show as icons, which now draw as a little flower. Nothing
  picks blocks by raycast yet.
- **The diorama needs no change.** `flowerPatch` places single flower cells on the top block. Each
  one now meshes as a sprig, and the grass under it keeps its full top face and AO.

## New dependencies

- None.

## Notes for downstream tasks

- **Builder (M3+) picking:** when Builder raycasts against the grid, decide whether a sprig cell is
  pickable as a whole cell or not at all. The mesh no longer fills the cell.
- **New sprig blocks:** add `shape: "sprig"` and paint tiles to the same layout (see the comment
  above the flower painters). Don't tag them `transparent`.
- **Particles:** `fx.burst` textures its particles with the side tile. A sprig's side tile is mostly
  clear, and the particle material has no `alphaTest`. That doesn't matter today, because flowers
  are never Mine targets. If a flower can ever be broken, give the particles `alphaTest`.

## Contract change request / Questions

- **CCR (additive, optional): `AtlasLookup.shape?(blockNum: number): "cube" | "sprig"`**
  (contracts §8.2). Decision 82 approved `BlockDef.shape`, but the mesher sees blocks only through
  `AtlasLookup`. Without this method the approved field can't reach the mesher.
  - It is optional, and a missing method means cube, so existing atlases, test stubs and callers are
    unaffected.
  - `Atlas` (§8.3) extends `AtlasLookup` and picks it up.
  - I implemented it rather than stopping, because the card can't be done without some way for the
    mesher to learn a block's shape. It is not merged. If you'd rather carry the shape some other
    way (for example in `meshChunk`'s `opts`), it's a small change.
  - `contracts.md` is not edited here. Please add the line if you approve.
- `src/render/chunks.ts` (`splitByBucket`, half a unit → 1/64) is outside the card's Owns list.
- **Question (visual):** at overview distance a sprig is only a few pixels. If the owner wants
  flowers to stand out more there, the cheapest lever is a wider bloom (8/16 instead of 6/16). It
  is one line in `SPRIG` plus the painter layout.

Closes #145
