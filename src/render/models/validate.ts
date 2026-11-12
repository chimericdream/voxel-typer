/**
 * Checks `*.model.json` data (task M4-01). JSON comes in as `unknown` and leaves as a
 * {@link VoxelModel} only through {@link isVoxelModel} / {@link parseModel}; nothing is cast.
 *
 * This is everything `schema.json` says, plus the cross-references a schema can't express:
 * unique part names, parents that exist (no cycles), tracks on real parts, one track per part and
 * property, and key times in order and inside the anim. `tests/unit/models/schema.test.ts` checks
 * that the two agree.
 */
import type { VoxelModel } from "./types";

/** Model and anim ids: lowercase words joined by dashes (`cave-bat`, `hop-left`). */
export const MODEL_ID_PATTERN = /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/;
/** Part names: a letter, then letters, digits, `-` or `_` (`leg-left`, `earL`). */
export const PART_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]*$/;
/** Flat colours: `#rrggbb`. */
export const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;
/** More parts than this is a scene, not a creature (M4-03 asks for 6–14). */
export const MAX_PARTS = 32;

const FACES = ["top", "side", "bottom"] as const;
const PROPS = ["rot", "pos", "scale"] as const;
const PART_KEYS = new Set(["name", "parent", "size", "pivot", "offset", "color", "tile"]);
const ANIM_KEYS = new Set(["durationMs", "loop", "tracks"]);
const TRACK_KEYS = new Set(["part", "prop", "keys"]);

const isRecord = (x: unknown): x is Record<string, unknown> =>
  typeof x === "object" && x !== null && !Array.isArray(x);

const isFiniteNumber = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

const isTriple = (x: unknown): x is [number, number, number] =>
  Array.isArray(x) && x.length === 3 && x.every(isFiniteNumber);

const isOneOf = <T extends string>(options: readonly T[], x: unknown): x is T =>
  options.some((o) => o === x);

function extraKeys(obj: Record<string, unknown>, allowed: ReadonlySet<string>): string[] {
  return Object.keys(obj).filter((k) => !allowed.has(k));
}

/** Every problem with `x` as a voxel model, as `path: message` lines. Empty means valid. */
export function modelErrors(x: unknown): string[] {
  const errors: string[] = [];
  const err = (path: string, msg: string): void => {
    errors.push(`${path}: ${msg}`);
  };
  if (!isRecord(x)) return ["$: must be an object"];
  for (const k of extraKeys(x, new Set(["$schema", "id", "parts", "anims"]))) {
    err(`$.${k}`, "unknown property");
  }
  if (typeof x.id !== "string" || !MODEL_ID_PATTERN.test(x.id)) {
    err("$.id", 'must be a lowercase dashed id such as "box-critter"');
  }

  const names = new Map<string, string | undefined>();
  if (!Array.isArray(x.parts) || x.parts.length === 0) {
    err("$.parts", "must be a non-empty array");
  } else {
    if (x.parts.length > MAX_PARTS) err("$.parts", `has more than ${MAX_PARTS} parts`);
    x.parts.forEach((part: unknown, i) => {
      const at = `$.parts[${i}]`;
      if (!isRecord(part)) {
        err(at, "must be an object");
        return;
      }
      for (const k of extraKeys(part, PART_KEYS)) err(`${at}.${k}`, "unknown property");
      const name = part.name;
      if (typeof name !== "string" || !PART_NAME_PATTERN.test(name)) {
        err(`${at}.name`, 'must be a part name such as "leg-left"');
      } else if (names.has(name)) {
        err(`${at}.name`, `duplicate part name "${name}"`);
      }
      if (part.parent !== undefined && typeof part.parent !== "string") {
        err(`${at}.parent`, "must be a part name");
      }
      if (!isTriple(part.size) || !part.size.every((v) => v > 0)) {
        err(`${at}.size`, "must be three positive numbers");
      }
      if (!isTriple(part.pivot)) err(`${at}.pivot`, "must be three numbers");
      if (!isTriple(part.offset)) err(`${at}.offset`, "must be three numbers");
      if (
        part.color !== undefined &&
        (typeof part.color !== "string" || !COLOR_PATTERN.test(part.color))
      ) {
        err(`${at}.color`, "must be a #rrggbb colour");
      }
      if (part.tile !== undefined) {
        const tile = part.tile;
        if (!isRecord(tile)) {
          err(`${at}.tile`, "must be an object");
        } else {
          for (const k of extraKeys(tile, new Set(["blockId", "face"]))) {
            err(`${at}.tile.${k}`, "unknown property");
          }
          if (typeof tile.blockId !== "string" || tile.blockId.length === 0) {
            err(`${at}.tile.blockId`, "must be a block id");
          }
          if (!isOneOf(FACES, tile.face)) err(`${at}.tile.face`, "must be top, side or bottom");
        }
      }
      if (part.color === undefined && part.tile === undefined) {
        err(at, "needs a color or a tile");
      }
      if (typeof name === "string" && !names.has(name)) {
        names.set(name, typeof part.parent === "string" ? part.parent : undefined);
      }
    });
    // Parents exist and never loop back.
    x.parts.forEach((part: unknown, i) => {
      if (!isRecord(part) || typeof part.parent !== "string") return;
      if (part.parent === part.name) {
        err(`$.parts[${i}].parent`, "a part can't be its own parent");
      } else if (!names.has(part.parent)) {
        err(`$.parts[${i}].parent`, `unknown part "${part.parent}"`);
      }
    });
    for (const start of names.keys()) {
      const seen = new Set<string>();
      let at: string | undefined = start;
      while (at !== undefined && !seen.has(at)) {
        seen.add(at);
        at = names.get(at);
      }
      if (at === start && seen.size > 1) err("$.parts", `parent cycle through "${start}"`);
    }
  }

  if (!isRecord(x.anims)) {
    err("$.anims", "must be an object of animations");
  } else {
    for (const [name, anim] of Object.entries(x.anims)) {
      const at = `$.anims.${name}`;
      if (!MODEL_ID_PATTERN.test(name)) err(at, "anim names are lowercase dashed words");
      if (!isRecord(anim)) {
        err(at, "must be an object");
        continue;
      }
      for (const k of extraKeys(anim, ANIM_KEYS)) err(`${at}.${k}`, "unknown property");
      const duration = anim.durationMs;
      const durationOk = isFiniteNumber(duration) && duration > 0;
      if (!durationOk) err(`${at}.durationMs`, "must be a positive number");
      if (typeof anim.loop !== "boolean") err(`${at}.loop`, "must be true or false");
      if (!Array.isArray(anim.tracks)) {
        err(`${at}.tracks`, "must be an array");
        continue;
      }
      const seenTracks = new Set<string>();
      anim.tracks.forEach((track: unknown, ti) => {
        const tat = `${at}.tracks[${ti}]`;
        if (!isRecord(track)) {
          err(tat, "must be an object");
          return;
        }
        for (const k of extraKeys(track, TRACK_KEYS)) err(`${tat}.${k}`, "unknown property");
        if (typeof track.part !== "string" || !names.has(track.part)) {
          err(`${tat}.part`, `must name a part of this model`);
        }
        if (!isOneOf(PROPS, track.prop)) err(`${tat}.prop`, "must be rot, pos or scale");
        const key = `${String(track.part)}.${String(track.prop)}`;
        if (seenTracks.has(key)) err(tat, `a second track for ${key}`);
        seenTracks.add(key);
        if (!Array.isArray(track.keys) || track.keys.length === 0) {
          err(`${tat}.keys`, "must be a non-empty array");
          return;
        }
        let prev = -Infinity;
        track.keys.forEach((k: unknown, ki) => {
          const kat = `${tat}.keys[${ki}]`;
          if (!isRecord(k)) {
            err(kat, "must be an object");
            return;
          }
          for (const extra of extraKeys(k, new Set(["t", "v"]))) {
            err(`${kat}.${extra}`, "unknown property");
          }
          if (!isFiniteNumber(k.t) || k.t < 0) {
            err(`${kat}.t`, "must be a time in ms, 0 or more");
          } else {
            if (k.t < prev) err(`${kat}.t`, "keys must be in time order");
            if (durationOk && k.t > duration) err(`${kat}.t`, "is after the end of the anim");
            prev = k.t;
          }
          if (!isTriple(k.v)) err(`${kat}.v`, "must be three numbers");
        });
      });
    }
  }
  return errors;
}

/** True when `x` is a valid voxel model (see {@link modelErrors}). */
export function isVoxelModel(x: unknown): x is VoxelModel {
  return modelErrors(x).length === 0;
}

/** Returns `x` as a model, or throws with every problem listed. */
export function parseModel(x: unknown, source = "model"): VoxelModel {
  if (isVoxelModel(x)) return x;
  throw new Error(`${source} is not a valid voxel model:\n  ${modelErrors(x).join("\n  ")}`);
}
