/**
 * Flowers (deco range, nums 300–399) and wool dyed in flower colors (wool/colors range, 250–299;
 * docs/impl/contracts.md §17). Pure data.
 *
 * Flowers are `shape: "sprig"` (M2-FIX-4, decision 82): a thin stem, two leaf nubs and a small
 * bloom built from sub-voxel boxes inside the cell, never crossed billboards (IP rule). Their
 * painters lay the sprig out where the mesher samples it: the side tile is the sprig seen from the
 * side (and doubles as the block's icon), the top tile is the bloom from above, the bottom tile
 * the bloom's shaded underside.
 */
import type { PaletteRampId, TextureRecipe } from "@/render/atlas/recipes";
import type { BlockDef } from "./types";

const same = (r: TextureRecipe): BlockDef["faces"] => ({ top: r, side: r, bottom: r });
const blossoms = (ramp: PaletteRampId): BlockDef["faces"] => ({
  top: { kind: "custom", paint: `flowers-top:${ramp}` },
  side: { kind: "custom", paint: `flowers-side:${ramp}` },
  bottom: { kind: "custom", paint: `flowers-under:${ramp}` },
});

export const blocks: BlockDef[] = [
  {
    id: "red-blooms",
    num: 310,
    nameKey: "blocks.redBlooms",
    faces: blossoms("wool-red"),
    material: "leaf",
    shape: "sprig",
    rarity: "uncommon",
    tags: ["flower", "placeable", "biome:meadow"],
    typedName: "bloom",
  },
  {
    id: "sunny-flowers",
    num: 311,
    nameKey: "blocks.sunnyFlowers",
    faces: blossoms("wool-yellow"),
    material: "leaf",
    shape: "sprig",
    rarity: "uncommon",
    tags: ["flower", "placeable", "biome:meadow"],
    typedName: "sunny",
  },
  {
    id: "bluebells",
    num: 312,
    nameKey: "blocks.bluebells",
    faces: blossoms("wool-blue"),
    material: "leaf",
    shape: "sprig",
    rarity: "uncommon",
    tags: ["flower", "placeable", "biome:meadow"],
    typedName: "bluebell",
  },
  {
    id: "purple-puffs",
    num: 313,
    nameKey: "blocks.purplePuffs",
    faces: blossoms("wool-purple"),
    material: "leaf",
    shape: "sprig",
    rarity: "uncommon",
    tags: ["flower", "placeable", "biome:meadow"],
    typedName: "puff",
  },
  {
    id: "red-wool",
    num: 250,
    nameKey: "blocks.redWool",
    faces: same({ kind: "custom", paint: "knit:wool-red" }),
    material: "wool",
    rarity: "uncommon",
    tags: ["wool", "placeable"],
    typedName: "red",
  },
  {
    id: "yellow-wool",
    num: 251,
    nameKey: "blocks.yellowWool",
    faces: same({ kind: "custom", paint: "knit:wool-yellow" }),
    material: "wool",
    rarity: "uncommon",
    tags: ["wool", "placeable"],
    typedName: "yellow",
  },
  {
    id: "green-wool",
    num: 252,
    nameKey: "blocks.greenWool",
    faces: same({ kind: "custom", paint: "knit:wool-green" }),
    material: "wool",
    rarity: "uncommon",
    tags: ["wool", "placeable"],
    typedName: "green",
  },
  {
    id: "blue-wool",
    num: 253,
    nameKey: "blocks.blueWool",
    faces: same({ kind: "custom", paint: "knit:wool-blue" }),
    material: "wool",
    rarity: "uncommon",
    tags: ["wool", "placeable"],
    typedName: "blue",
  },
];
