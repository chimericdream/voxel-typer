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
 * Model space (contracts.md §8.4): one model pixel is one face pixel, 16 make a block, y is up
 * and the avatar faces +z. The avatar is 26 pixels tall, about a block and a half.
 *
 * The parts below are written as boxes in model space (`min`, `size`) with the joint each one
 * turns about, which is easy to read and check against the face grid. {@link toModel} turns them
 * into §8.4 parts: `pivot` measured from the box's min corner, `offset` from the parent's pivot.
 * A part with no joint of its own (a face pixel, the belt) pivots at its min corner and simply
 * moves with its parent.
 *
 * The head is 10 wide, 10 tall and 8 deep, sitting on top of the torso at y = 16. Its front layer
 * (1 deep) is the face, one box per run of one color in a row; behind it, each row is one box of
 * hair (or skin, at the jaw), merged with the rows below while they match. The jaw row is the
 * `head` part: it sits on the neck, and the rest of the head hangs from it.
 */
interface Box {
  name: string;
  parent: string | null;
  min: V3;
  size: V3;
  /** The joint in model space. Default: the box's min corner. */
  joint?: V3;
  color: string;
}

const HEAD_BOTTOM = 16;
const HEAD_FRONT = 4;
const HEAD_BACK = -4;
const HEAD_LEFT = -5;
const NECK: V3 = [0, HEAD_BOTTOM, 0];

const colorOf = (c: string): string => FACE_INK[c] ?? SKIN_TOKEN;
const rowY = (row: number): number => HEAD_BOTTOM + (FACE.length - 1 - row);

function headBoxes(): Box[] {
  const boxes: Box[] = [];
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
  let top = 0;
  spans.forEach((s, i) => {
    const back = top === 0 ? 1 : HEAD_BACK;
    // The bottom span (the jaw) is the head; it holds the neck joint.
    const jaw = i === spans.length - 1;
    boxes.push({
      name: jaw ? "head" : `head-${i}`,
      parent: jaw ? "torso" : "head",
      min: [HEAD_LEFT + s.x0, rowY(s.row), back],
      size: [s.x1 - s.x0, s.row - top + 1, HEAD_FRONT - 1 - back],
      ...(jaw ? { joint: NECK } : {}),
      color: s.color,
    });
    top = s.row + 1;
  });
  // The face: one 1-deep box per run of one color.
  FACE.forEach((line, row) => {
    let x = 0;
    while (x < line.length) {
      const c = line.charAt(x);
      let end = x + 1;
      while (end < line.length && line.charAt(end) === c) end++;
      if (c !== ".") {
        boxes.push({
          name: `face-${row}-${x}`,
          parent: "head",
          min: [HEAD_LEFT + x, rowY(row), HEAD_FRONT - 1],
          size: [end - x, 1, 1],
          color: colorOf(c),
        });
      }
      x = end;
    }
  });
  return boxes;
}

/*
 * Sizes are whole pixels (§8.4). Where a trim is thinner than that, the box sinks into the one it
 * sits on and only its outer part shows: the collar is 1 deep but stands out half a pixel from
 * the tunic.
 */
function bodyBoxes(): Box[] {
  const t = OUTFIT;
  return [
    {
      name: "torso",
      parent: null,
      min: [-4, 8, -2],
      size: [8, 8, 4],
      joint: [0, 8, 0],
      color: t.tunic,
    },
    { name: "collar", parent: "torso", min: [-3, 15, 1.5], size: [6, 1, 1], color: t.collar },
    { name: "belt", parent: "torso", min: [-4.5, 9, -2.5], size: [9, 1, 5], color: t.belt },
    {
      name: "arm-left",
      parent: "torso",
      min: [-6, 9, -1.5],
      size: [2, 7, 3],
      joint: [-5, 15, 0],
      color: t.tunic,
    },
    {
      name: "hand-left",
      parent: "arm-left",
      min: [-6, 7, -1.5],
      size: [2, 2, 3],
      color: SKIN_TOKEN,
    },
    {
      name: "arm-right",
      parent: "torso",
      min: [4, 9, -1.5],
      size: [2, 7, 3],
      joint: [5, 15, 0],
      color: t.tunic,
    },
    {
      name: "hand-right",
      parent: "arm-right",
      min: [4, 7, -1.5],
      size: [2, 2, 3],
      color: SKIN_TOKEN,
    },
    // A pixel apart, and inset from the tunic's sides.
    {
      name: "leg-left",
      parent: "torso",
      min: [-3.5, 2, -1.5],
      size: [3, 6, 3],
      joint: [-2, 8, 0],
      color: t.trousers,
    },
    { name: "boot-left", parent: "leg-left", min: [-4, 0, -2], size: [4, 2, 4], color: t.boots },
    {
      name: "leg-right",
      parent: "torso",
      min: [0.5, 2, -1.5],
      size: [3, 6, 3],
      joint: [2, 8, 0],
      color: t.trousers,
    },
    { name: "boot-right", parent: "leg-right", min: [0, 0, -2], size: [4, 2, 4], color: t.boots },
  ];
}

/** Model-space boxes to §8.4 parts. */
function toModel(boxes: readonly Box[]): Part[] {
  const joints = new Map(boxes.map((b): [string, V3] => [b.name, b.joint ?? b.min]));
  return boxes.map((b) => {
    const joint = b.joint ?? b.min;
    const from = b.parent === null ? [0, 0, 0] : joints.get(b.parent);
    if (from === undefined) throw new Error(`avatar: "${b.name}" has no parent "${b.parent}"`);
    return {
      name: b.name,
      ...(b.parent === null ? {} : { parent: b.parent }),
      size: b.size,
      pivot: [joint[0] - b.min[0], joint[1] - b.min[1], joint[2] - b.min[2]],
      offset: [joint[0] - (from[0] ?? 0), joint[1] - (from[1] ?? 0), joint[2] - (from[2] ?? 0)],
      color: b.color,
    };
  });
}

/** The default avatar. No animations yet: the profile cards show a still pose. */
export const BASE_AVATAR: VoxelModel = {
  id: "avatar-base",
  parts: toModel([...bodyBoxes(), ...headBoxes()]),
  anims: {},
};
