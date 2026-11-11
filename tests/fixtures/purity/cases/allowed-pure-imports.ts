// Fixture: imports pure code IS allowed to make. Must produce no purity errors anywhere.
import { meshChunk } from "@/render/mesher/mesh";
import { deep } from "@/render/mesher/greedy/deep";
import { paintTile } from "@/render/atlas/recipes";
import { createRng } from "@/engine/rng";
export const all = [meshChunk, deep, paintTile, createRng];
export const epoch = (ms: number) => new Date(ms);
export const roll = (rng: { next(): number }) => rng.next();
