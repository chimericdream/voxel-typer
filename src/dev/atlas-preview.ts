// Atlas preview (M1-14), served as /atlas.html in dev and test builds only (never in `dist/`).
// Shows every atlas tile at 8× with the block and faces that use it, the crack stages, the packed
// atlas, the palette ramps and each biome's variant of the main ramps.
//
//   ?seed=<n>       atlas seed (default 1)
//   ?biome=<id>     palette variant (default meadow)
//
// Until M2-04 writes the real blocks, it shows SAMPLE_BLOCKS: one of each kind of recipe.
// Developer page: the text here is not kid-facing and doesn't go through t().
import { blocks as registryBlocks } from "@/content/blocks";
import type { BlockDef } from "@/content/blocks/types";
import { CELL, buildAtlas, paintCrackStages, tileRect } from "@/render/atlas/build";
import { TILE_SIZE } from "@/render/atlas/painters";
import { BIOME_VARIANTS, paletteFor } from "@/render/atlas/palettes";
import { PALETTE_RAMP_IDS } from "@/render/atlas/recipes";
import type { PaletteRampId, TextureRecipe } from "@/render/atlas/recipes";
import { BIOME_ORDER } from "@/types/core";
import type { BiomeId } from "@/types/core";

const ZOOM = 8;
const FACES = ["top", "side", "bottom"] as const;

const noise = (ramp: PaletteRampId, scale = 4, contrast = 1): TextureRecipe => ({
  kind: "noise",
  ramp,
  scale,
  contrast,
});
const custom = (paint: string): TextureRecipe => ({ kind: "custom", paint });
const ore = (base: TextureRecipe, oreRamp: PaletteRampId, density: number): TextureRecipe => ({
  kind: "ore",
  base,
  ore: oreRamp,
  density,
});

let nextNum = 1;
function sample(
  id: string,
  top: TextureRecipe,
  side: TextureRecipe = top,
  bottom: TextureRecipe = top,
  tags: string[] = [],
): BlockDef {
  const num = nextNum++;
  return {
    id,
    num,
    nameKey: `common.${id}`,
    faces: { top, side, bottom },
    material: "stone",
    rarity: "common",
    tags,
    typedName: id.replaceAll(/[^a-z]/g, ""),
  };
}

const DIRT = noise("dirt", 4, 1);
const STONE = noise("stone", 4, 0.8);
const SLATE = noise("slate", 3, 1);
const WOOLS = [
  "white",
  "black",
  "brown",
  "red",
  "orange",
  "yellow",
  "lime",
  "green",
  "cyan",
  "blue",
  "purple",
  "pink",
] as const;

/** One block per kind of recipe, so every painter shows up. Preview data only. */
const SAMPLE_BLOCKS: readonly BlockDef[] = [
  sample(
    "grass-block",
    noise("grass", 3, 0.9),
    { kind: "overlay-top", base: DIRT, top: "grass", depth: 3 },
    DIRT,
  ),
  sample("dirt", DIRT),
  sample("stone", STONE),
  sample("rubble", custom("pebbles:stone")),
  sample("gravel", custom("pebbles:gravel")),
  sample("sand", noise("sand", 3, 0.6)),
  sample(
    "snowy-grass",
    noise("snow", 4, 0.5),
    { kind: "overlay-top", base: DIRT, top: "snow", depth: 4 },
    DIRT,
  ),
  sample("ice", noise("ice", 6, 0.6)),
  sample("mud", noise("mud", 3, 0.8)),
  sample("moss", noise("moss", 2, 1)),
  sample("clay", noise("clay", 5, 0.5)),
  sample("slate", SLATE),
  sample("cloud", noise("cloud", 6, 0.4)),
  sample("stone-bricks", { kind: "bricks", ramp: "stone", mortar: "mortar" }),
  sample("clay-bricks", { kind: "bricks", ramp: "brick", mortar: "mortar" }),
  sample("oak-log", custom("rings:oak"), custom("bark:oak-bark")),
  sample("oak-planks", { kind: "planks", ramp: "oak", boards: 4 }),
  sample("birch-log", custom("rings:birch"), custom("dashed-bark:birch-bark")),
  sample("birch-planks", { kind: "planks", ramp: "birch", boards: 4 }),
  sample("leaves", custom("leaves:leaf")),
  sample("copper-ore", ore(STONE, "ore-copper", 0.5)),
  sample("gem-ore", ore(STONE, "ore-gem", 0.3)),
  sample("amber-ore", ore(STONE, "ore-amber", 0.4)),
  sample("moon-ore", ore(SLATE, "ore-moon", 0.4)),
  sample("crystal", custom("facets:crystal")),
  sample(
    "mushroom-cap",
    custom("cap:mushroom"),
    custom("cap:mushroom"),
    noise("mushroom-stem", 3, 0.4),
  ),
  sample("mushroom-stem", noise("mushroom-stem", 3, 0.4)),
  sample("spark-lamp", custom("lamp:spark"), custom("lamp:spark"), custom("lamp:spark"), ["light"]),
  sample("glass", custom("glass"), custom("glass"), custom("glass"), ["transparent"]),
  sample("water", custom("ripple:water"), custom("ripple:water"), custom("ripple:water"), [
    "transparent",
  ]),
  ...WOOLS.map((c) => sample(`${c}-wool`, custom(`knit:wool-${c}`))),
];

function readParams(search: string): { seed: number; biome: BiomeId } {
  const params = new URLSearchParams(search);
  const n = Number.parseInt(params.get("seed") ?? "", 10);
  const raw = params.get("biome");
  const biome = BIOME_ORDER.find((b) => b === raw) ?? "meadow";
  return { seed: Number.isFinite(n) ? n : 1, biome };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text = "",
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** A canvas showing 16×16 RGBA pixels at 8×, scaled by hand so every browser draws it the same. */
function zoomed(pixels: Uint8ClampedArray): HTMLCanvasElement {
  const size = TILE_SIZE * ZOOM;
  const canvas = el("canvas", "tile");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  const image = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (Math.floor(y / ZOOM) * TILE_SIZE + Math.floor(x / ZOOM)) * 4;
      image.data.set(pixels.subarray(from, from + 4), (y * size + x) * 4);
    }
  }
  ctx.putImageData(image, 0, 0);
  return canvas;
}

function card(pixels: Uint8ClampedArray, label: string, detail: string): HTMLElement {
  const figure = el("figure", "card");
  const caption = el("figcaption");
  caption.append(el("b", "", label), el("span", "", detail));
  figure.append(zoomed(pixels), caption);
  return figure;
}

function section(title: string, body: HTMLElement): HTMLElement {
  const s = el("section");
  s.append(el("h2", "", title), body);
  return s;
}

function swatches(ramp: readonly string[]): HTMLElement {
  const strip = el("div", "strip");
  for (const hex of ramp) {
    const sw = el("span", "swatch");
    sw.style.background = hex;
    sw.title = hex;
    strip.append(sw);
  }
  return strip;
}

async function start(root: HTMLElement): Promise<void> {
  const { seed, biome } = readParams(window.location.search);
  const palette = paletteFor(biome);
  const blocks = registryBlocks.length > 0 ? registryBlocks : SAMPLE_BLOCKS;
  const atlas = await buildAtlas(blocks, palette, seed);
  const { canvas } = atlas;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");

  // Which block faces use each tile.
  const users = new Map<number, string[]>();
  for (const block of blocks) {
    const byTile = new Map<number, string[]>();
    for (const face of FACES) {
      const tile = atlas.tileOf(block.id, face);
      byTile.set(tile, [...(byTile.get(tile) ?? []), face]);
    }
    for (const [tile, faces] of byTile) {
      const label = `${block.id} · ${faces.length === 3 ? "all" : faces.join("+")}`;
      users.set(tile, [...(users.get(tile) ?? []), label]);
    }
  }
  const tileCount = Math.max(...users.keys()) + 1;

  const header = el("header");
  header.append(
    el("h1", "", "Voxel Typer atlas preview"),
    el(
      "p",
      "",
      `seed ${seed} · biome ${biome} · ${blocks.length} ${registryBlocks.length > 0 ? "blocks" : "sample blocks"} · ${tileCount} tiles · atlas ${canvas.width}×${canvas.height} px (${CELL}-px cells)`,
    ),
  );

  const tiles = el("div", "grid");
  for (let index = 0; index < tileCount; index++) {
    const { x, y } = tileRect(canvas.width, index);
    const pixels = ctx.getImageData(x, y, TILE_SIZE, TILE_SIZE).data;
    const names = users.get(index) ?? (index === 0 ? ["missing tile"] : ["(unused)"]);
    tiles.append(card(pixels, names[0] ?? "", names.slice(1).join(", ") || `tile ${index}`));
  }

  const cracks = el("div", "grid");
  paintCrackStages(seed).forEach((pixels, stage) => {
    cracks.append(card(pixels, `crack ${stage}`, "overlay"));
  });

  const sheet = el("div", "sheet");
  const big = el("canvas", "atlas");
  big.width = canvas.width;
  big.height = canvas.height;
  big.style.setProperty("--size", `${canvas.width}px`);
  big.getContext("2d")?.putImageData(ctx.getImageData(0, 0, canvas.width, canvas.height), 0, 0);
  sheet.append(big);

  const ramps = el("div", "ramps");
  for (const id of PALETTE_RAMP_IDS) {
    const row = el("div", "ramp");
    row.append(el("code", "", id), swatches(palette[id]));
    ramps.append(row);
  }

  const variants = el("div", "ramps");
  for (const b of BIOME_ORDER) {
    const changed = PALETTE_RAMP_IDS.filter((id) => BIOME_VARIANTS[b][id] !== undefined);
    const row = el("div", "ramp");
    row.append(el("code", "", b));
    const variant = paletteFor(b);
    for (const id of changed) {
      const cell = el("span", "variant");
      cell.append(el("small", "", id), swatches(variant[id]));
      row.append(cell);
    }
    if (changed.length === 0) row.append(el("small", "", "base palette"));
    variants.append(row);
  }

  root.append(
    header,
    section("Tiles at 8×", tiles),
    section("Crack stages 0–9 (overlay layer)", cracks),
    section("Packed atlas at 2× (with 1-px gutters)", sheet),
    section(`Palette: ${biome}`, ramps),
    section("Biome variants (shifted ramps only)", variants),
  );
  root.dataset["ready"] = "1";
  root.dataset["tiles"] = String(tileCount);
}

const root = document.querySelector<HTMLElement>("#atlas");
if (root) {
  start(root).catch((err: unknown) => {
    console.error(err);
    root.dataset["ready"] = "error";
  });
}
