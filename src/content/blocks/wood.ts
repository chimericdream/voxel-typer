/**
 * Wood blocks: logs, planks and leaves. Nums 100–149 (docs/impl/contracts.md §17). Pure data.
 */
import type { TextureRecipe } from "@/render/atlas/recipes";
import type { BlockDef } from "./types";

const same = (r: TextureRecipe): BlockDef["faces"] => ({ top: r, side: r, bottom: r });

export const blocks: BlockDef[] = [
  {
    id: "oak-log",
    num: 100,
    nameKey: "blocks.oakLog",
    faces: {
      top: { kind: "custom", paint: "rings:oak" },
      side: { kind: "custom", paint: "bark:oak-bark" },
      bottom: { kind: "custom", paint: "rings:oak" },
    },
    material: "wood",
    rarity: "common",
    tags: ["wood", "placeable", "biome:meadow"],
    typedName: "log",
  },
  {
    id: "oak-planks",
    num: 101,
    nameKey: "blocks.oakPlanks",
    faces: same({ kind: "planks", ramp: "oak", boards: 4 }),
    material: "wood",
    rarity: "common",
    tags: ["wood", "placeable"],
    typedName: "planks",
  },
  {
    id: "oak-leaves",
    num: 102,
    nameKey: "blocks.oakLeaves",
    faces: same({ kind: "custom", paint: "leaves:leaf" }),
    material: "leaf",
    rarity: "common",
    tags: ["wood", "placeable", "biome:meadow"],
    typedName: "leaves",
  },
  {
    // Placeholder for the Birch biome (M3). Not in the Meadow loot table.
    id: "birch-log",
    num: 103,
    nameKey: "blocks.birchLog",
    faces: {
      top: { kind: "custom", paint: "rings:birch" },
      side: { kind: "custom", paint: "dashed-bark:birch-bark" },
      bottom: { kind: "custom", paint: "rings:birch" },
    },
    material: "wood",
    rarity: "uncommon",
    tags: ["wood", "placeable", "biome:birch"],
    typedName: "birch",
  },
];
