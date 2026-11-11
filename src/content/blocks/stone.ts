/**
 * Stone and building blocks. Nums 150–199 (docs/impl/contracts.md §17). Pure data.
 *
 * Brick (baked clay) and glass (melted sand) live here too: they are building blocks, and M2-04
 * owns no separate building file.
 */
import type { TextureRecipe } from "@/render/atlas/recipes";
import type { BlockDef } from "./types";

const PEBBLES: TextureRecipe = { kind: "custom", paint: "pebbles:stone" };
const same = (r: TextureRecipe): BlockDef["faces"] => ({ top: r, side: r, bottom: r });

export const blocks: BlockDef[] = [
  {
    id: "stone",
    num: 150,
    nameKey: "blocks.stone",
    faces: same({ kind: "noise", ramp: "stone", scale: 4, contrast: 0.8 }),
    material: "stone",
    rarity: "common",
    tags: ["terrain", "placeable"],
    typedName: "stone",
  },
  {
    id: "cobble",
    num: 151,
    nameKey: "blocks.cobble",
    faces: same(PEBBLES),
    material: "stone",
    rarity: "common",
    tags: ["placeable"],
    typedName: "cobble",
  },
  {
    id: "mossy-cobble",
    num: 152,
    nameKey: "blocks.mossyCobble",
    faces: same({ kind: "ore", base: PEBBLES, ore: "moss", density: 0.5 }),
    material: "stone",
    rarity: "uncommon",
    tags: ["placeable", "biome:meadow"],
    typedName: "mossy",
  },
  {
    id: "brick",
    num: 153,
    nameKey: "blocks.brick",
    faces: same({ kind: "bricks", ramp: "brick", mortar: "mortar" }),
    material: "stone",
    rarity: "uncommon",
    tags: ["placeable"],
    typedName: "brick",
  },
  {
    id: "glass",
    num: 154,
    nameKey: "blocks.glass",
    faces: same({ kind: "custom", paint: "glass" }),
    material: "glass",
    rarity: "rare",
    tags: ["placeable", "transparent"],
    typedName: "glass",
  },
];
