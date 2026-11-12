/**
 * The mob roster (task M4-03): ids, models, anims, word flavors, names and the IP check.
 *
 * `tests/unit/models/schema.test.ts` already checks every `*.model.json` against the schema and
 * plays every anim. This file checks what makes a model a usable mob.
 */
import { describe, expect, it } from "vitest";
import { MOBS, ambientChicken, mobById, mobsOf, rosterFor } from "../../../src/content/mobs";
import type { MobDef } from "../../../src/content/mobs";
import en from "../../../src/i18n/en";
import { DIRECTOR_CONSTANTS, flavorPools, usableWords } from "../../../src/modes/defense/director";
import { Animator } from "../../../src/render/models/animator";
import { compileRig } from "../../../src/render/models/rig";
import type { VoxelModel } from "../../../src/render/models/types";
import { parseModel } from "../../../src/render/models/validate";
import { BIOME_ORDER } from "../../../src/types/core";
import type { AgeBand } from "../../../src/types/core";
import { loadAllPools } from "../../../tools/sim-defense";
import { blocklistHits, loadBlocklist } from "../../../tools/validate-wordlists";

const IDS = [
  "slimeling",
  "moss-golem",
  "cave-bat",
  "frost-pup",
  "cactus-cat",
  "lantern-fish",
  "crystal-crab",
  "sandstorm-imp",
];
const BANDS: readonly AgeBand[] = ["sprout", "miner", "builder"];
const LOWER = "abcdefghijklmnopqrstuvwxyz";
/** IP terms that must never appear (CLAUDE.md), on top of the blocklist's `ip` category. */
const BANNED = ["creeper", "enderman", "redstone", "nether", "steve", "minecraft", "mojang"];
/** Words that would make a mob sound scary or the game sound like a fight. */
const UNFRIENDLY = /\b(kill|dead|die|dies|attack|fight|enemy|enemies|scary|evil|hurt|bite)\b/i;

const pools = loadAllPools();
const blocklist = loadBlocklist();
const modelOf = (mob: { id: string; model: unknown }): VoxelModel => parseModel(mob.model, mob.id);

const mobText: Readonly<Record<string, string>> = en.mobs;
function text(key: string): string | undefined {
  const [ns, name, ...rest] = key.split(".");
  if (ns !== "mobs" || name === undefined || rest.length > 0) return undefined;
  return Object.hasOwn(mobText, name) ? mobText[name] : undefined;
}

/**
 * How many of a mob's flavor words a learner in `band` could be given in the mob's home biome.
 * Letters only; capitals count from the Deep Mines on, where Shift is taught (the Mines lists are
 * capitalised on purpose).
 */
function flavorWords(mob: MobDef, band: AgeBand): number {
  const bandPools = pools.filter((p) => p.band === band || p.band === "all");
  const shift = BIOME_ORDER.indexOf(mob.home) >= BIOME_ORDER.indexOf("mines");
  return usableWords(
    flavorPools(bandPools, mob.flavor),
    new Set(shift ? LOWER + LOWER.toUpperCase() : LOWER),
    DIRECTOR_CONSTANTS.wordLength[band],
  );
}

describe("the roster", () => {
  it("has the eight wave-1 mobs, each once", () => {
    expect(MOBS.map((m) => m.id).toSorted()).toEqual(IDS.toSorted());
    for (const id of IDS) expect(mobById(id)?.id).toBe(id);
    expect(mobById("nobody")).toBeUndefined();
  });

  it("gives every biome a night roster, starting with the Meadow's own mob", () => {
    expect(rosterFor("meadow").map((m) => m.id)).toEqual(["slimeling"]);
    for (const biome of BIOME_ORDER) {
      const roster = rosterFor(biome);
      expect(roster.length, biome).toBeGreaterThan(0);
      for (const m of mobsOf(biome)) expect(roster).toContain(m);
      for (const m of roster) {
        expect(BIOME_ORDER.indexOf(m.home)).toBeLessThanOrEqual(BIOME_ORDER.indexOf(biome));
      }
    }
    expect(rosterFor("citadel")).toHaveLength(MOBS.length);
  });

  it("has a name and a description for every mob, in friendly words", () => {
    for (const mob of MOBS) {
      for (const key of [mob.nameKey, mob.aboutKey]) {
        const s = text(key);
        expect(s, key).toBeTruthy();
        expect(UNFRIENDLY.test(s ?? ""), `${key}: "${s}"`).toBe(false);
      }
    }
    expect(text(ambientChicken.nameKey)).toBeTruthy();
  });

  it("uses no banned IP term and no blocklisted word in ids, part names or copy", () => {
    const strings = [
      ...Object.values(mobText),
      ...Object.keys(mobText),
      ...[...MOBS, ambientChicken].flatMap((m) => [
        m.id,
        ...modelOf(m).parts.map((p) => p.name),
        ...Object.keys(modelOf(m).anims),
      ]),
    ];
    for (const s of strings) {
      const lower = s.toLowerCase();
      for (const term of BANNED) expect(lower.includes(term), `"${s}" has "${term}"`).toBe(false);
      // "Imp" and "Bat" are plain creature words; the blocklist is for words kids type.
      expect(
        blocklistHits(s.replaceAll("-", " "), blocklist).filter((h) => h.category === "ip"),
        s,
      ).toEqual([]);
    }
  });
});

describe.each(MOBS.map((m) => [m.id, m] as const))("%s", (_id, mob) => {
  const model = modelOf(mob);

  it("has a model with its own id and 6–14 whole-pixel parts", () => {
    expect(model.id).toBe(mob.id);
    expect(model.parts.length).toBeGreaterThanOrEqual(6);
    expect(model.parts.length).toBeLessThanOrEqual(14);
    for (const p of model.parts) {
      expect(
        p.size.every((v) => Number.isInteger(v) && v > 0),
        p.name,
      ).toBe(true);
    }
  });

  it("hangs every part from one root, so the whole mob shrinks away together", () => {
    const roots = model.parts.filter((p) => p.parent === undefined);
    expect(roots).toHaveLength(1);
  });

  it("loops idle and walk, and plays hit and defeat once", () => {
    expect(model.anims.idle?.loop).toBe(true);
    expect(model.anims.walk?.loop).toBe(true);
    expect(model.anims.hit?.loop).toBe(false);
    expect(model.anims.defeat?.loop).toBe(false);
  });

  it("loops without a jump: each track ends where it starts (or a square part ends a quarter turn on)", () => {
    for (const name of ["idle", "walk"]) {
      for (const track of model.anims[name]?.tracks ?? []) {
        const first = track.keys[0];
        const last = track.keys.at(-1);
        if (first === undefined || last === undefined) throw new Error("no keys");
        const delta = last.v.map((v, i) => v - (first.v[i] ?? 0));
        if (delta.every((d) => d === 0)) continue;
        const part = model.parts.find((p) => p.name === track.part);
        // A quarter turn about y looks the same for a part that is square from above and turns
        // about its centre.
        expect(track.prop, `${name}/${track.part}`).toBe("rot");
        expect(delta[0], `${name}/${track.part}`).toBe(0);
        expect(delta[2], `${name}/${track.part}`).toBe(0);
        expect(Math.abs(delta[1] ?? 0) % 90, `${name}/${track.part}`).toBe(0);
        expect(part?.size[0]).toBe(part?.size[2]);
        expect(part?.pivot[0]).toBe((part?.size[0] ?? 0) / 2);
        expect(part?.pivot[2]).toBe((part?.size[2] ?? 0) / 2);
      }
    }
  });

  it("is gentle when typed: hit and defeat are short, with no spin and no flashing", () => {
    for (const name of ["hit", "defeat"]) {
      const anim = model.anims[name];
      if (anim === undefined) throw new Error(name);
      expect(anim.durationMs).toBeLessThanOrEqual(600);
      for (const track of anim.tracks) {
        expect(track.prop, `${name}/${track.part}`).not.toBe("rot");
        // At most 3 keys in under 600 ms: one squash or one pop, never a flicker (PLAN §4.6).
        expect(track.keys.length).toBeLessThanOrEqual(3);
      }
    }
  });

  it("pops away on defeat: the root shrinks to nothing, and onEnd fires once", () => {
    const root = model.parts.find((p) => p.parent === undefined);
    const shrink = model.anims.defeat?.tracks.find(
      (t) => t.part === root?.name && t.prop === "scale",
    );
    expect(shrink?.keys.at(-1)?.v).toEqual([0, 0, 0]);

    const animator = new Animator(compileRig(model));
    let ended = 0;
    expect(animator.play("defeat", { fadeMs: 0, onEnd: () => ended++ })).toBe(true);
    const duration = model.anims.defeat?.durationMs ?? 0;
    animator.update(duration - 1);
    expect(ended).toBe(0);
    animator.update(50);
    animator.update(50);
    expect(ended).toBe(1);
  });

  it("still pops away with reduced motion on", () => {
    const animator = new Animator(compileRig(model), { reducedMotion: () => true });
    let ended = 0;
    animator.play("defeat", { fadeMs: 0, onEnd: () => ended++ });
    animator.update(5000);
    expect(ended).toBe(1);
    animator.play("walk", { fadeMs: 0 });
    animator.update(100);
    expect(animator.animating).toBe(false);
  });

  it("has a speed class and a flavor with at least 8 words in every band", () => {
    expect(["slow", "medium", "fast"]).toContain(mob.speedClass);
    for (const band of BANDS) {
      expect(flavorWords(mob, band), `${mob.flavor} / ${band}`).toBeGreaterThanOrEqual(
        DIRECTOR_CONSTANTS.minFlavorWords,
      );
    }
  });
});

describe("ambient-chicken", () => {
  const model = modelOf(ambientChicken);

  it("is a small decorative model that lives in the Meadow", () => {
    expect(model.id).toBe(ambientChicken.id);
    expect(ambientChicken.home).toBe("meadow");
    expect(model.parts.length).toBeLessThanOrEqual(14);
    expect(model.anims.idle?.loop).toBe(true);
    expect(model.anims.walk?.loop).toBe(true);
    expect(model.anims.peck?.loop).toBe(false);
  });

  it("is not a mob: no word, no hit, no defeat", () => {
    expect(mobById(ambientChicken.id)).toBeUndefined();
    expect(model.anims.hit).toBeUndefined();
    expect(model.anims.defeat).toBeUndefined();
  });
});
