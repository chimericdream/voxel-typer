/**
 * The player's head (task M2-11, redrawn in M2-FIX-2): an original 10×10 pixel face in the chosen
 * skin color. Shown on the Profiles screen and as the preview on the new-player screen.
 *
 * The look is our own on purpose (IP rule): a rounded head rather than a square one, an auburn
 * fringe swept to one side, a leaf sprouting on top, round eyes with a light spot and rosy cheeks.
 * A flat dark hair band over a square face reads too close to a famous default character.
 *
 * The skin colors are avatar data saved in `Profile.avatar.skin`, not UI theme colors, so they
 * live here rather than in `themes.ts`. Six tones, light to deep, so every child can find theirs.
 * An id this build doesn't know (an older or newer save) draws the middle tone.
 */
import styles from "./Avatar.module.css";

export const SKIN_TONES = [
  { id: "tone-1", color: "#f7dcc8" },
  { id: "tone-2", color: "#ecc19f" },
  { id: "tone-3", color: "#d29c72" },
  { id: "tone-4", color: "#ae764c" },
  { id: "tone-5", color: "#875334" },
  { id: "tone-6", color: "#5a3923" },
] as const;

export type SkinToneId = (typeof SKIN_TONES)[number]["id"];

const FALLBACK = SKIN_TONES[2];

export function skinColor(id: string): string {
  return (SKIN_TONES.find((s) => s.id === id) ?? FALLBACK).color;
}

/** `.` empty, L leaf, H hair, S skin, E eye, W eye light, C cheek, M mouth. */
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

/** Colors from the M1-14 atlas ramps (`BASE_PALETTE`), so the head sits with the world. */
const INK: Readonly<Record<string, string>> = {
  L: "#52984a", // leaf 3
  H: "#7a372b", // brick 1: auburn
  E: "#1f1f25", // wool-black 1
  W: "#f8f7f3", // wool-white 4
  C: "#e27ba2", // wool-pink 3
  M: "#8f2b36", // mushroom 1
};

export interface AvatarProps {
  skin: string;
  size?: "md" | "lg";
}

/** Decorative: callers name the player in text next to it. */
export function Avatar({ skin, size = "md" }: AvatarProps) {
  const skinFill = skinColor(skin);
  const rects = [];
  for (let y = 0; y < FACE.length; y++) {
    const row = FACE[y] ?? "";
    for (let x = 0; x < row.length; x++) {
      const c = row.charAt(x);
      if (c === ".") continue;
      rects.push(
        <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={INK[c] ?? skinFill} />,
      );
    }
  }
  return (
    <svg
      class={styles.avatar}
      data-size={size}
      viewBox="0 0 10 10"
      aria-hidden="true"
      shape-rendering="crispEdges"
    >
      {rects}
    </svg>
  );
}
