/**
 * A badge's icon (task M3-10): a block from the registry drawn as a 16×16 tile of its side face,
 * like the Results loot slots. Cosmetic icons have no art yet, so they show a plain star.
 * Decorative: the name next to it says what it is.
 */
import { blocks } from "@/content/blocks";
import type { AchievementIcon } from "@/engine/achievements";
import { createRng } from "@/engine/rng";
import { BASE_PALETTE } from "@/render/atlas/palettes";
import { TILE_SIZE } from "@/render/atlas/painters";
import { paintTile } from "@/render/atlas/recipes";
import styles from "./Badge.module.css";

const cache = new Map<string, string>();

/** A data URI of the block's side face ("" without a 2D canvas or for an unknown block). */
export function blockIconUri(id: string): string {
  const cached = cache.get(id);
  if (cached !== undefined) return cached;
  const def = blocks.find((b) => b.id === id);
  let uri = "";
  const canvas = document.createElement("canvas");
  const ctx = def ? canvas.getContext("2d") : null;
  if (def && ctx) {
    canvas.width = TILE_SIZE;
    canvas.height = TILE_SIZE;
    const px = paintTile(def.faces.side, BASE_PALETTE, createRng(def.num));
    ctx.putImageData(new ImageData(new Uint8ClampedArray(px), TILE_SIZE, TILE_SIZE), 0, 0);
    uri = canvas.toDataURL("image/png");
  }
  cache.set(id, uri);
  return uri;
}

export function BadgeIcon({ icon, dim = false }: { icon: AchievementIcon; dim?: boolean }) {
  const uri = "block" in icon ? blockIconUri(icon.block) : "";
  return (
    <span class={styles.icon} data-dim={dim ? "1" : undefined} aria-hidden="true">
      {uri === "" ? <span class={styles.star} /> : <img src={uri} alt="" />}
    </span>
  );
}
