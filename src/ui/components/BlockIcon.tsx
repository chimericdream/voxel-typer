/**
 * A block's picture (task M4-09): a little isometric cube with its top and two sides, drawn once
 * per block from the block atlas on the app's one shared renderer (`app.scene()`, decision 73)
 * and cached for the session as a data URI. `@/render/block-icon` is loaded on demand, so three.js
 * stays out of the screen's chunk.
 *
 * Without WebGL (lite mode, or the scene failed) the icon is the flat side tile the badges use
 * (`blockIconUri`), which also shows while the cube is on its way, and a later mount tries the
 * cube again. A flower (a `sprig`) is always flat: it has no cube to draw.
 *
 * `unknown` draws the block's outline as a dark silhouette with a "?" on it, the collection goal:
 * the shape hints at what it is (a cube or a flower) without showing it. Decorative: callers name
 * the block in text or in their own label.
 */
import { useEffect, useState } from "preact/hooks";
import type { AppApi } from "@/app/types";
import { blocks } from "@/content/blocks";
import type { BlockDef } from "@/content/blocks/types";
import { blockIconUri } from "./BadgeIcon";
import styles from "./BlockIcon.module.css";

/** Image size in pixels: sharp at the largest slot on a high-density screen. */
export const ICON_PX = 96;

const pending = new Map<string, Promise<string | null>>();
const done = new Map<string, string>();

/** A cached cube icon, if one is ready. */
export function cachedBlockIcon(id: string): string | null {
  return done.get(id) ?? null;
}

/** Forgets every icon (tests). */
export function clearBlockIconCache(): void {
  pending.clear();
  done.clear();
}

/**
 * The cube icon for a block, drawn once. Resolves null without WebGL, for a sprig, or when the
 * draw fails; never rejects. A null result is not cached, so a later call tries again.
 */
export function requestBlockIcon(app: AppApi, def: BlockDef): Promise<string | null> {
  const known = pending.get(def.id);
  if (known) return known;
  const p = (async (): Promise<string | null> => {
    try {
      const { blockIconDataUrl, drawsAsCube, iconAtlas } = await import("@/render/block-icon");
      if (!drawsAsCube(def)) return null;
      const scene = await app.scene();
      const renderer = scene.three?.renderer;
      if (!renderer) return null;
      const atlas = await iconAtlas(blocks);
      return blockIconDataUrl(renderer, def, atlas, ICON_PX);
    } catch {
      return null;
    }
  })().then((url) => {
    if (url === null) pending.delete(def.id);
    else done.set(def.id, url);
    return url;
  });
  pending.set(def.id, p);
  return p;
}

export interface BlockIconProps {
  app: AppApi;
  def: BlockDef;
  /** Not found yet: a "?" on the block's silhouette. */
  unknown?: boolean;
}

export function BlockIcon({ app, def, unknown = false }: BlockIconProps) {
  const [cube, setCube] = useState<string | null>(() => cachedBlockIcon(def.id));

  useEffect(() => {
    const ready = cachedBlockIcon(def.id);
    setCube(ready);
    if (ready !== null) return undefined;
    let live = true;
    const p = requestBlockIcon(app, def).then((url) => {
      if (live && url !== null) setCube(url);
    });
    app.whenReady(p);
    return () => {
      live = false;
    };
  }, [app, def]);

  const src = cube ?? blockIconUri(def.id);
  return (
    <span
      class={styles.icon}
      data-icon={cube === null ? "flat" : "cube"}
      data-unknown={unknown ? "1" : undefined}
      aria-hidden="true"
    >
      {src === "" ? null : <img src={src} alt="" draggable={false} />}
      {unknown ? <span class={styles.mark}>?</span> : null}
    </span>
  );
}
