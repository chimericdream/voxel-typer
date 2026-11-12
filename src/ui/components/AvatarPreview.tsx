/**
 * A player's avatar on a profile card (task M3-09): a still 3D render of the voxel avatar when
 * WebGL is there, else the flat pixel portrait (`Avatar`), which also shows while the render is
 * on its way.
 *
 * The render comes from the app's one shared renderer (`app.scene()`, decision 73) through
 * `@/render/avatar`, loaded on demand so three.js stays out of this screen's chunk. Snapshots are
 * cached for the session by look (skin), so each look is drawn once, not on every visit or frame.
 * Without WebGL (lite mode, or the scene failed), it stays flat and tries again on a later mount.
 */
import { useEffect, useState } from "preact/hooks";
import type { AppApi } from "@/app/types";
import { BASE_AVATAR, SKIN_TOKEN, skinColor } from "@/content/cosmetics/base";
import { Avatar } from "@/ui/screens/Avatar";
import styles from "./AvatarPreview.module.css";

/** Image size in pixels. Big enough for the largest card size on a high-density screen. */
export const SNAPSHOT_PX = 160;
/** The bust: from the chest to the top of the leaf, in model units. */
const BUST: readonly [number, number] = [10, 27];

const cache = new Map<string, Promise<string | null>>();
const done = new Map<string, string>();

const keyOf = (skin: string): string => `base|${skin}`;

/** A cached snapshot, if one is ready. */
export function cachedSnapshot(skin: string): string | null {
  return done.get(keyOf(skin)) ?? null;
}

/** Forgets every snapshot (tests). */
export function clearSnapshotCache(): void {
  cache.clear();
  done.clear();
}

/** The snapshot for a look, drawn once. Resolves null without WebGL; never rejects. */
export function requestSnapshot(app: AppApi, skin: string): Promise<string | null> {
  const key = keyOf(skin);
  const known = cache.get(key);
  if (known) return known;
  const p = (async (): Promise<string | null> => {
    try {
      const scene = await app.scene();
      const renderer = scene.three?.renderer;
      if (!renderer) return null;
      const { snapshotModel } = await import("@/render/avatar");
      return snapshotModel(renderer, BASE_AVATAR, {
        px: SNAPSHOT_PX,
        colors: { [SKIN_TOKEN]: skinColor(skin) },
        frameY: BUST,
      });
    } catch {
      return null;
    }
  })().then((url) => {
    if (url === null) cache.delete(key);
    else done.set(key, url);
    return url;
  });
  cache.set(key, p);
  return p;
}

export interface AvatarPreviewProps {
  app: AppApi;
  /** `Profile.avatar.skin`. Hats and the rest join the look when M4 adds them. */
  skin: string;
  size?: "md" | "lg";
}

/** Decorative: callers name the player in text next to it. */
export function AvatarPreview({ app, skin, size = "md" }: AvatarPreviewProps) {
  const [src, setSrc] = useState<string | null>(() => cachedSnapshot(skin));

  useEffect(() => {
    const ready = cachedSnapshot(skin);
    setSrc(ready);
    if (ready !== null) return undefined;
    let live = true;
    const p = requestSnapshot(app, skin).then((url) => {
      if (live && url !== null) setSrc(url);
    });
    app.whenReady(p);
    return () => {
      live = false;
    };
  }, [app, skin]);

  if (src === null) return <Avatar skin={skin} size={size} />;
  return (
    <img
      class={styles.avatar}
      data-size={size}
      data-avatar="3d"
      src={src}
      alt=""
      aria-hidden="true"
    />
  );
}
