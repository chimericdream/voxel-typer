/**
 * The base avatar (task M3-09): skin tones, the pixel face, and the voxel model the profile cards
 * render. Pure data. The face was drawn in M2-FIX-2 and moved here from `ui/screens/Avatar.tsx`
 * so the flat portrait and the 3D model share one source.
 *
 * The look is our own on purpose (IP rule): a rounded head rather than a square one, an auburn
 * fringe swept to one side, a leaf sprouting on top, round eyes with a light spot and rosy cheeks,
 * and a mustard tunic with a leaf-green collar. A flat dark hair band over a square face, or a
 * light-blue shirt over blue trousers, reads too close to a famous default character.
 *
 * Skin colors are avatar data saved in `Profile.avatar.skin`, not UI theme colors. Six tones,
 * light to deep, so every child can find theirs. An id this build doesn't know (an older or newer
 * save) draws the middle tone.
 */
import type { VoxelModel } from "@/render/models/types";

export const SKIN_TONES = [
  { id: "tone-1", color: "#f7dcc8" },
  { id: "tone-2", color: "#ecc19f" },
  { id: "tone-3", color: "#d29c72" },
  { id: "tone-4", color: "#ae764c" },
  { id: "tone-5", color: "#875334" },
  { id: "tone-6", color: "#5a3923" },
] as const;

export type SkinToneId = (typeof SKIN_TONES)[number]["id"];

const FALLBACK_TONE = SKIN_TONES[2];

/** The color of a skin id; unknown ids get the middle tone. */
export function skinColor(id: string): string {
  return (SKIN_TONES.find((s) => s.id === id) ?? FALLBACK_TONE).color;
}

/** `.` empty, L leaf, H hair, S skin, E eye, W eye light, C cheek, M mouth. Row 0 is the top. */
export const FACE = [
  "......LL..",
  "..HHHLHH..",
  ".HHHHHHHH.",
  "HHHHHHHSSH",
  "HHSSSSSSSH",
  "HSWESSWESS",
  "SSEESSEESS",
  "SCSSSSSSCS",
  ".SSSMMSSS.",
  "..SSSSSS..",
] as const;

/** Face colors from the M1-14 atlas ramps (`BASE_PALETTE`), so the head sits with the world. */
export const FACE_INK: Readonly<Record<string, string>> = {
  L: "#52984a", // leaf 3
  H: "#7a372b", // brick 1: auburn
  E: "#1f1f25", // wool-black 1
  W: "#f8f7f3", // wool-white 4
  C: "#e27ba2", // wool-pink 3
  M: "#8f2b36", // mushroom 1
};

/** The default outfit, also from the atlas ramps. */
export const OUTFIT = {
  tunic: "#e1bb1f", // wool-yellow 2: mustard
  collar: "#52984a", // leaf 3
  belt: "#553422", // wool-brown 1
  trousers: "#74502c", // oak 1
  boots: "#3f2618", // wool-brown 0
} as const;

/**
 * Stands for the player's skin color in a model part's `color`; the renderer swaps in
 * {@link skinColor} of `Profile.avatar.skin`.
 */
export const SKIN_TOKEN = "$skin";

type Part = VoxelModel["parts"][number];
type V3 = [number, number, number];

/*
 * Model space (PROVISIONAL until M4-03 settles `VoxelModel` geometry for mobs): one unit is one
 * face pixel, y is up and the avatar faces +z. A part's `offset` is its box's min corner and its
 * `pivot` is the joint it turns around, both in model space. `parent` only matters for animation.
 *
 * The head is 10 wide, 10 tall and 8 deep, sitting on top of the torso at y = 16. Its front layer
 * (1 deep) is the face, one box per run of one color in a row; behind it, each row is one box of
 * hair (or skin, at the jaw), merged with the rows below while they match.
 */
const HEAD_BOTTOM = 16;
const HEAD_FRONT = 4;
const HEAD_BACK = -4;
const HEAD_LEFT = -5;
const NECK: V3 = [0, HEAD_BOTTOM, 0];

const colorOf = (c: string): string => FACE_INK[c] ?? SKIN_TOKEN;
const rowY = (row: number): number => HEAD_BOTTOM + (FACE.length - 1 - row);

function headParts(): Part[] {
  const parts: Part[] = [];
  // The back of the head: one box per row span, merged downward while span and color match.
  const spans: { row: number; x0: number; x1: number; color: string }[] = [];
  FACE.forEach((line, row) => {
    const x0 = line.search(/[^.]/);
    if (x0 === -1) return;
    let x1 = line.length;
    while (x1 > x0 && line.charAt(x1 - 1) === ".") x1--;
    // The leaf on top is a short sprout, the jaw is skin, the rest is hair.
    const color = row === 0 ? FACE_INK.L : row >= 8 ? SKIN_TOKEN : FACE_INK.H;
    const last = spans.at(-1);
    if (last && last.x0 === x0 && last.x1 === x1 && last.color === color && row !== 0) {
      last.row = row;
      return;
    }
    spans.push({ row, x0, x1, color: color ?? SKIN_TOKEN });
  });
  // The tallest span is the `head` part the rest hang from.
  let top = 0;
  let tallest = 0;
  for (const s of spans) {
    const rows = s.row - top + 1;
    const back = top === 0 ? 1 : HEAD_BACK;
    const i = parts.length;
    if (rows > (parts[tallest]?.size[1] ?? 0)) tallest = i;
    parts.push({
      name: `head-${i}`,
      parent: "head",
      size: [s.x1 - s.x0, rows, HEAD_FRONT - 1 - back],
      pivot: NECK,
      offset: [HEAD_LEFT + s.x0, rowY(s.row), back],
      color: s.color,
    });
    top = s.row + 1;
  }
  const head = parts[tallest];
  if (head) {
    head.name = "head";
    head.parent = "torso";
  }
  // The face: one 1-deep box per run of one color.
  FACE.forEach((line, row) => {
    let x = 0;
    while (x < line.length) {
      const c = line.charAt(x);
      let end = x + 1;
      while (end < line.length && line.charAt(end) === c) end++;
      if (c !== ".") {
        parts.push({
          name: `face-${row}-${x}`,
          parent: "head",
          size: [end - x, 1, 1],
          pivot: NECK,
          offset: [HEAD_LEFT + x, rowY(row), HEAD_FRONT - 1],
          color: colorOf(c),
        });
      }
      x = end;
    }
  });
  return parts;
}

function box(
  name: string,
  parent: string | null,
  min: V3,
  size: V3,
  pivot: V3,
  color: string,
): Part {
  return {
    name,
    ...(parent === null ? {} : { parent }),
    size,
    pivot,
    offset: min,
    color,
  };
}

function bodyParts(): Part[] {
  return [
    box("torso", null, [-4, 8, -2], [8, 8, 4], [0, 8, 0], OUTFIT.tunic),
    box("collar", "torso", [-3, 15, 2], [6, 1, 0.5], [0, 8, 0], OUTFIT.collar),
    box("belt", "torso", [-4.25, 9, -2.25], [8.5, 1, 4.5], [0, 8, 0], OUTFIT.belt),
    box("arm-left", "torso", [-6, 9, -1.5], [2, 7, 3], [-5, 15, 0], OUTFIT.tunic),
    box("hand-left", "arm-left", [-6, 7.5, -1.5], [2, 1.5, 3], [-5, 15, 0], SKIN_TOKEN),
    box("arm-right", "torso", [4, 9, -1.5], [2, 7, 3], [5, 15, 0], OUTFIT.tunic),
    box("hand-right", "arm-right", [4, 7.5, -1.5], [2, 1.5, 3], [5, 15, 0], SKIN_TOKEN),
    box("leg-left", "torso", [-3.5, 2, -1.5], [3.5, 6, 3], [-1.75, 8, 0], OUTFIT.trousers),
    box("boot-left", "leg-left", [-3.75, 0, -1.75], [3.75, 2, 3.75], [-1.75, 8, 0], OUTFIT.boots),
    box("leg-right", "torso", [0, 2, -1.5], [3.5, 6, 3], [1.75, 8, 0], OUTFIT.trousers),
    box("boot-right", "leg-right", [0, 0, -1.75], [3.75, 2, 3.75], [1.75, 8, 0], OUTFIT.boots),
  ];
}

/** The default avatar. No animations yet: the profile cards show a still pose. */
export const BASE_AVATAR: VoxelModel = {
  id: "avatar-base",
  parts: [...bodyParts(), ...headParts()],
  anims: {},
};
