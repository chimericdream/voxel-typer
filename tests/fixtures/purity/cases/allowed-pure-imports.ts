// Fixture: imports pure code IS allowed to make. Must produce no purity errors anywhere.
import { meshChunk } from "@/render/mesher/mesh";
import { paintTile } from "@/render/atlas/recipes";
import { createRng } from "@/engine/rng";
export const all = [meshChunk, paintTile, createRng];
export const epoch = (ms: number) => new Date(ms);
export const roll = (rng: { next(): number }) => rng.next();
