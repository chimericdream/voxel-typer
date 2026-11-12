/**
 * The scene host's ground lookup (task M2-13): where chips from a burst land. The Mine target
 * floats, so the default (the bottom of the burst's own cell) would be a floor in mid-air.
 */
import { describe, expect, it } from "vitest";
import { groundUnder } from "../../../src/app/scene-host";
import { dioramaStage, generateDiorama } from "../../../src/content/worldgen/diorama";
import { VoxelGrid } from "../../../src/render/mesher/voxel-grid";

describe("groundUnder", () => {
  it("is the top of the highest solid block at or below the point", () => {
    const g = new VoxelGrid(4, 8, 4);
    g.set(1, 0, 1, 5);
    g.set(1, 1, 1, 5);
    expect(groundUnder(g, { x: 1.5, y: 4.5, z: 1.5 })).toBe(2);
    expect(groundUnder(g, { x: 1.9, y: 2.1, z: 1.1 })).toBe(2);
    // A point inside a solid block lands on that block.
    expect(groundUnder(g, { x: 1.5, y: 1.5, z: 1.5 })).toBe(2);
  });

  it("falls back to the bottom of the point's cell without a grid or over a bottomless column", () => {
    expect(groundUnder(null, { x: 1.5, y: 4.5, z: 1.5 })).toBe(4);
    const g = new VoxelGrid(4, 8, 4);
    expect(groundUnder(g, { x: 2.5, y: 4.5, z: 2.5 })).toBe(4);
    expect(groundUnder(g, { x: -3, y: 4.5, z: 99 })).toBe(4);
  });

  it("puts the Mine target's chips on the stage floor of the real meadow", () => {
    const stage = dioramaStage("meadow");
    const grid = generateDiorama("meadow", 1);
    const at = { x: stage.target.x + 0.5, y: stage.target.y + 0.5, z: stage.target.z + 0.5 };
    expect(groundUnder(grid, at)).toBe(stage.floorY + 1);
    // The default would have been a whole block higher, in the air.
    expect(at.y - 0.5).toBe(stage.floorY + 2);
  });
});
