/**
 * The player's head (task M2-11, redrawn in M2-FIX-2): an original 10×10 pixel face in the chosen
 * skin color, drawn as flat SVG pixels. It is the preview on the new-player screen and the
 * portrait the profile cards show until (or instead of, without WebGL) the 3D snapshot
 * (`ui/components/AvatarPreview.tsx`). The face data and the IP notes live in
 * `@/content/cosmetics/base`.
 */
import { FACE, FACE_INK as INK, skinColor } from "@/content/cosmetics/base";
import styles from "./Avatar.module.css";

// The data moved to `@/content/cosmetics/base` (M3-09); these names stay for older imports.
export { FACE, SKIN_TONES, skinColor } from "@/content/cosmetics/base";
export type { SkinToneId } from "@/content/cosmetics/base";

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
