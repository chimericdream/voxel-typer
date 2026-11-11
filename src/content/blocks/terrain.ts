/**
 * Terrain blocks: the ground of the world. Nums 1–99 (docs/impl/contracts.md §17). Pure data.
 *
 * Display names live in `src/i18n/en/blocks.ts`. `typedName` is what a kid types in Builder.
 */
import type { TextureRecipe } from "@/render/atlas/recipes";
import type { BlockDef } from "./types";

const DIRT: TextureRecipe = { kind: "noise", ramp: "dirt", scale: 4, contrast: 1 };
const same = (r: TextureRecipe): BlockDef["faces"] => ({ top: r, side: r, bottom: r });

export const blocks: BlockDef[] = [
  {
    id: "grass",
    num: 1,
    nameKey: "blocks.grass",
    faces: {
      top: { kind: "noise", ramp: "grass", scale: 3, contrast: 0.9 },
      side: { kind: "overlay-top", base: DIRT, top: "grass", depth: 3 },
      bottom: DIRT,
    },
    material: "dirt",
    rarity: "common",
    tags: ["terrain", "placeable", "biome:meadow"],
    typedName: "grass",
  },
  {
    id: "dirt",
    num: 2,
    nameKey: "blocks.dirt",
    faces: same(DIRT),
    material: "dirt",
    rarity: "common",
    tags: ["terrain", "placeable"],
    typedName: "dirt",
  },
  {
    id: "coarse-dirt",
    num: 3,
    nameKey: "blocks.coarseDirt",
    faces: same({ kind: "custom", paint: "pebbles:dirt" }),
    material: "dirt",
    rarity: "common",
    tags: ["terrain", "placeable"],
    typedName: "rocky",
  },
  {
    id: "sand",
    num: 4,
    nameKey: "blocks.sand",
    faces: same({ kind: "noise", ramp: "sand", scale: 3, contrast: 0.6 }),
    material: "sand",
    rarity: "common",
    tags: ["terrain", "placeable"],
    typedName: "sand",
  },
  {
    id: "gravel",
    num: 5,
    nameKey: "blocks.gravel",
    faces: same({ kind: "custom", paint: "pebbles:gravel" }),
    material: "sand",
    rarity: "common",
    tags: ["terrain", "placeable"],
    typedName: "gravel",
  },
  {
    id: "clay",
    num: 6,
    nameKey: "blocks.clay",
    faces: same({ kind: "noise", ramp: "clay", scale: 5, contrast: 0.5 }),
    material: "dirt",
    rarity: "uncommon",
    tags: ["terrain", "placeable"],
    typedName: "clay",
  },
  {
    // For worldgen (the Meadow pond, M2-03), not loot. `Material` has no water sound yet, so it
    // borrows `glass` (see docs/handoffs/M2-04.md).
    id: "water",
    num: 7,
    nameKey: "blocks.water",
    faces: same({ kind: "custom", paint: "ripple:water" }),
    material: "glass",
    rarity: "common",
    tags: ["terrain", "transparent", "liquid"],
    typedName: "water",
  },
];
