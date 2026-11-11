/**
 * The player's blocky head (task M2-11): an original 8×8 pixel face in the chosen skin color.
 * Shown on the Profiles screen and as the preview on the new-player screen.
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

/** H hair, S skin, E eye, M mouth. */
const FACE = [
  "HHHHHHHH",
  "HHHHHHHH",
  "HSSSSSSH",
  "SSSSSSSS",
  "SSESSESS",
  "SSSSSSSS",
  "SSSMMSSS",
  "SSSSSSSS",
] as const;

const INK: Readonly<Record<string, string>> = {
  H: "#3d2b1f",
  E: "#231c2b",
  M: "#7a3b36",
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
      rects.push(
        <rect key={`${x},${y}`} x={x} y={y} width={1} height={1} fill={INK[c] ?? skinFill} />,
      );
    }
  }
  return (
    <svg
      class={styles.avatar}
      data-size={size}
      viewBox="0 0 8 8"
      aria-hidden="true"
      shape-rendering="crispEdges"
    >
      {rects}
    </svg>
  );
}
