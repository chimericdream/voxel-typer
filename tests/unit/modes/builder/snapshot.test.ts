/**
 * The island picture (task M4-08): drawn at 2× from the current camera with the cursor hidden,
 * saved as a local file, and the renderer put back as it was.
 */
import type * as THREE from "three";
import { describe, expect, it } from "vitest";
import {
  SNAPSHOT_MAX_SIDE,
  SNAPSHOT_SCALE,
  captureIsland,
  saveFile,
  snapshotFileName,
  snapshotRatio,
} from "../../../../src/modes/builder/snapshot";
import type { SaveDeps, SnapshotTarget } from "../../../../src/modes/builder/snapshot";

interface Log {
  calls: string[];
  ratio: number;
}

function fakeTarget(
  opts: { width?: number; height?: number; ratio?: number; max?: number; throws?: boolean } = {},
): { target: SnapshotTarget<"scene", "camera">; log: Log } {
  const log: Log = { calls: [], ratio: opts.ratio ?? 1 };
  const target: SnapshotTarget<"scene", "camera"> = {
    scene: "scene",
    camera: "camera",
    renderer: {
      domElement: {
        toBlob(cb, type) {
          log.calls.push(`toBlob ${type ?? ""} at ${log.ratio}`);
          cb(new Blob(["png"], { type: "image/png" }));
        },
      },
      capabilities: { maxTextureSize: opts.max ?? 16384 },
      getPixelRatio: () => log.ratio,
      setPixelRatio(r) {
        log.calls.push(`ratio ${r}`);
        log.ratio = r;
      },
      getSize: (v) => v.set(opts.width ?? 1280, opts.height ?? 720),
      render(scene, camera) {
        log.calls.push(`render ${scene} ${camera} at ${log.ratio}`);
        if (opts.throws === true) throw new Error("lost context");
      },
    },
  };
  return { target, log };
}

/** Type check only: a three.js renderer, scene and camera fit the target. */
const fitsThree = (r: THREE.WebGLRenderer, s: THREE.Scene, c: THREE.Camera) =>
  ({ renderer: r, scene: s, camera: c }) satisfies SnapshotTarget<THREE.Scene, THREE.Camera>;

describe("captureIsland", () => {
  it("draws once at 2× with the cursor hidden, then puts everything back", async () => {
    const { target, log } = fakeTarget({ ratio: 1.25 });
    const shown: boolean[] = [];
    const blob = await captureIsland(target, () => {
      shown.push(false);
      return () => void shown.push(true);
    });
    expect(blob?.type).toBe("image/png");
    expect(log.calls).toEqual([
      `ratio ${SNAPSHOT_SCALE}`,
      "render scene camera at 2",
      "toBlob image/png at 2",
      "ratio 1.25",
    ]);
    expect(log.ratio).toBe(1.25);
    expect(shown).toEqual([false, true]);
  });

  it("puts the renderer back even when drawing fails", () => {
    const { target, log } = fakeTarget({ ratio: 1, throws: true });
    let showAgain = 0;
    expect(() =>
      captureIsland(target, () => () => {
        showAgain += 1;
      }),
    ).toThrow("lost context");
    expect(log.ratio).toBe(1);
    expect(showAgain).toBe(1);
  });

  it("keeps the picture within the size limits", () => {
    expect(snapshotRatio(1280, 720, 16384)).toBe(2);
    expect(snapshotRatio(3000, 1500, 16384)).toBeCloseTo(SNAPSHOT_MAX_SIDE / 3000);
    expect(snapshotRatio(1280, 720, 2048)).toBeCloseTo(2048 / 1280);
    expect(snapshotRatio(0, 0, 0)).toBe(2);
  });

  it("works with a real WebGLRenderer's shape", () => {
    expect(typeof fitsThree).toBe("function");
  });
});

describe("snapshotFileName", () => {
  it("names the file by the local date", () => {
    const at = new Date(2026, 10, 3, 9, 30).getTime();
    expect(snapshotFileName(at)).toBe("my-island-2026-11-03.png");
    expect(snapshotFileName(new Date(2027, 0, 31, 23, 59).getTime())).toBe(
      "my-island-2027-01-31.png",
    );
  });
});

describe("saveFile", () => {
  it("hands the browser a local Blob URL to download, then lets it go", () => {
    const events: string[] = [];
    const later: (() => void)[] = [];
    const anchor = {
      href: "",
      download: "",
      rel: "",
      style: { display: "" },
      click: () => void events.push("click"),
      remove: () => void events.push("remove"),
    };
    const deps: SaveDeps = {
      // reason: saveFile sets only these anchor fields; a real element needs a DOM
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      document: {
        createElement: () => anchor,
        body: { append: () => void events.push("append") },
      } as unknown as SaveDeps["document"],
      createObjectURL: () => "blob:local/1",
      revokeObjectURL: (u) => void events.push(`revoke ${u}`),
      later: (fn) => void later.push(fn),
    };
    saveFile(new Blob(["png"]), "my-island-2026-11-13.png", deps);
    expect(anchor).toMatchObject({
      href: "blob:local/1",
      download: "my-island-2026-11-13.png",
    });
    expect(events).toEqual(["append", "click", "remove"]);
    for (const fn of later) fn();
    expect(events.at(-1)).toBe("revoke blob:local/1");
  });
});
