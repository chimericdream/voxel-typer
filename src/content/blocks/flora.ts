/**
 * Flowers (deco range, nums 300–399) and wool dyed in flower colors (wool/colors range, 250–299;
 * docs/impl/contracts.md §17). Pure data.
 *
 * Flowers are small cubes, not cross-shaped billboards (M2-04 card). Until a flower painter exists
 * they reuse the `ore` recipe: colored blossom clusters on a leafy base.
 */
import type { PaletteRampId, TextureRecipe } from "@/render/atlas/recipes";
import type { BlockDef } from "./types";

const LEAVES: TextureRecipe = { kind: "custom", paint: "leaves:leaf" };
const same = (r: TextureRecipe): BlockDef["faces"] => ({ top: r, side: r, bottom: r });
const blossoms = (ramp: PaletteRampId): BlockDef["faces"] => ({
  top: { kind: "ore", base: LEAVES, ore: ramp, density: 0.6 },
  side: { kind: "ore", base: LEAVES, ore: ramp, density: 0.3 },
  bottom: LEAVES,
});

export const blocks: BlockDef[] = [
  {
    id: "red-blooms",
    num: 310,
    nameKey: "blocks.redBlooms",
    faces: blossoms("wool-red"),
    material: "leaf",
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
