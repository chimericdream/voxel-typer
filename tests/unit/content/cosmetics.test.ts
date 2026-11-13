/**
 * The base avatar (task M3-09): the face and the voxel model built from it.
 */
import { describe, expect, it } from "vitest";
import {
  BASE_AVATAR,
  FACE,
  FACE_INK,
  OUTFIT,
  SKIN_TOKEN,
  SKIN_TONES,
  skinColor,
} from "../../../src/content/cosmetics/base";

const HEX = /^#[0-9a-f]{6}$/;

describe("base avatar", () => {
  it("skin tones: six distinct hex colors; an unknown id draws the middle tone", () => {
    expect(SKIN_TONES).toHaveLength(6);
    expect(new Set(SKIN_TONES.map((s) => s.color)).size).toBe(6);
    for (const s of SKIN_TONES) expect(s.color).toMatch(HEX);
    expect(skinColor("tone-1")).toBe(SKIN_TONES[0].color);
    expect(skinColor("tone-from-the-future")).toBe(SKIN_TONES[2].color);
  });

  it("the face is a 10×10 grid of known inks", () => {
    expect(FACE).toHaveLength(10);
    for (const row of FACE) {
      expect(row).toHaveLength(10);
      for (const c of row) expect(c === "." || c === "S" || c in FACE_INK).toBe(true);
    }
  });

  it("model parts: unique names, real parents, positive sizes, colors that resolve", () => {
    const names = BASE_AVATAR.parts.map((p) => p.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("head");
    expect(names).toContain("torso");
    for (const p of BASE_AVATAR.parts) {
      if (p.parent !== undefined) expect(names).toContain(p.parent);
      for (const n of p.size) expect(n).toBeGreaterThan(0);
      expect(p.color === SKIN_TOKEN || HEX.test(p.color ?? "")).toBe(true);
    }
    // One root.
    expect(BASE_AVATAR.parts.filter((p) => p.parent === undefined).map((p) => p.name)).toEqual([
      "torso",
    ]);
  });

  it("every face pixel has a front box of its own color at the head's front", () => {
    const front = BASE_AVATAR.parts.filter((p) => p.name.startsWith("face-"));
    // The head's pivot (the neck) in model space: the torso's pivot plus the head's offset.
    const torso = BASE_AVATAR.parts.find((p) => p.name === "torso");
    const head = BASE_AVATAR.parts.find((p) => p.name === "head");
    const neck = [0, 1, 2].map((i) => (torso?.offset[i] ?? NaN) + (head?.offset[i] ?? NaN));
    expect(neck).toEqual([0, 16, 0]);
    let pixels = 0;
    for (const row of FACE) pixels += row.replaceAll(".", "").length;
    expect(front.reduce((n, p) => n + p.size[0], 0)).toBe(pixels);
    for (const p of front) {
      // Children of the head pivot at their min corner, so the front is the head's pivot z
      // (the neck, z = 0) plus the offset plus the depth.
      expect(p.parent).toBe("head");
      expect(p.pivot).toEqual([0, 0, 0]);
      expect((neck[2] ?? NaN) + p.offset[2] + p.size[2]).toBe(4);
      const [, row, x] = p.name.split("-").map(Number);
      const c = FACE[row ?? 0]?.charAt(x ?? 0) ?? ".";
      expect(p.color).toBe(FACE_INK[c] ?? SKIN_TOKEN);
    }
  });

  it("the tunic is warm, not a light-blue shirt (IP rule)", () => {
    const c = parseInt(OUTFIT.tunic.slice(1), 16);
    expect(c >> 16).toBeGreaterThan(c & 0xff);
    expect(BASE_AVATAR.parts.find((p) => p.name === "torso")?.color).toBe(OUTFIT.tunic);
  });
});
