import { describe, expect, it } from "vitest";
import { createModeRegistry, resolveMode } from "../../../src/modes/registry";
import type { ModeModule } from "../../../src/modes/types";
import type { GameModeId } from "../../../src/types/core";

/** A mode stub: enough of a ModeModule for the registry, which never calls `load`. */
const stub = (id: GameModeId): ModeModule => ({
  id,
  load: () => Promise.reject(new Error(`stub mode "${id}" has no implementation`)),
});

/** A fake eager `import.meta.glob` result: one `./<id>/index.ts` entry per mode. */
const fakeGlob = (...modes: ModeModule[]): Record<string, unknown> =>
  Object.fromEntries(modes.map((mode) => [`./${mode.id}/index.ts`, { mode }]));

function registryWith(modes: ModeModule[], dev = true) {
  const warnings: string[] = [];
  const registry = createModeRegistry(fakeGlob(...modes), {
    dev,
    warn: (message) => warnings.push(message),
  });
  return { registry, warnings };
}

describe("mode registry (contracts §7.3)", () => {
  it("resolveMode('defense') returns the mine module stub while defense doesn't exist", () => {
    const mine = stub("mine");
    const { registry } = registryWith([mine]);
    expect(registry.resolveMode("defense")).toBe(mine);
    expect(registry.resolveMode("defense").id).toBe("mine");
    expect(registry.has("defense")).toBe(false);
  });

  it("returns a mode's own module once its folder exists", () => {
    const mine = stub("mine");
    const defense = stub("defense");
    const { registry, warnings } = registryWith([mine, defense]);
    expect(registry.resolveMode("mine")).toBe(mine);
    expect(registry.resolveMode("defense")).toBe(defense);
    expect(registry.has("defense")).toBe(true);
    expect(warnings).toEqual([]);
  });

  it("logs a fallback once per mode in dev", () => {
    const { registry, warnings } = registryWith([stub("mine")]);
    registry.resolveMode("defense");
    registry.resolveMode("defense");
    registry.resolveMode("boss");
    registry.resolveMode("defense");
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('"defense"');
    expect(warnings[0]).toContain('"mine"');
    expect(warnings[1]).toContain('"boss"');
  });

  it("stays silent outside dev, and still falls back", () => {
    const mine = stub("mine");
    const { registry, warnings } = registryWith([mine], false);
    expect(registry.resolveMode("minecart")).toBe(mine);
    expect(warnings).toEqual([]);
  });

  it("uses the module's id, not the folder name", () => {
    const defense = stub("defense");
    const registry = createModeRegistry({
      "./mine/index.ts": { mode: stub("mine") },
      "./night-defense/index.ts": { mode: defense },
    });
    expect(registry.resolveMode("defense")).toBe(defense);
  });

  it("throws when there is no mine mode to fall back to", () => {
    const { registry } = registryWith([stub("builder")]);
    expect(registry.resolveMode("builder").id).toBe("builder");
    expect(() => registry.resolveMode("defense")).toThrow(/no "defense" mode and no "mine" mode/);
    expect(() => createModeRegistry({}).resolveMode("mine")).toThrow(/no "mine" mode/);
  });

  it.each([
    ["no mode export", {}],
    ["a default export only", { default: stub("mine") }],
    ["an unknown id", { mode: { id: "racing", load: () => Promise.resolve() } }],
    ["an inherited id", { mode: { id: "toString", load: () => Promise.resolve() } }],
    ["no load function", { mode: { id: "mine" } }],
    ["a non-object module", "mine"],
  ])("rejects a mode file with %s, naming the file", (_label, file) => {
    expect(() => createModeRegistry({ "./broken/index.ts": file })).toThrow(
      /\.\/broken\/index\.ts must export "mode"/,
    );
  });

  it("rejects two folders that claim the same mode id", () => {
    expect(() =>
      createModeRegistry({
        "./mine/index.ts": { mode: stub("mine") },
        "./mine-copy/index.ts": { mode: stub("mine") },
      }),
    ).toThrow('"mine" is defined twice, in ./mine-copy/index.ts and ./mine/index.ts');
  });

  it("exports resolveMode, backed by the real glob", () => {
    // No mode folder exists yet (M2-13 adds src/modes/mine), so only the wiring is checked here:
    // importing the module ran the real `import.meta.glob` without throwing.
    expect(resolveMode).toBeTypeOf("function");
  });
});
