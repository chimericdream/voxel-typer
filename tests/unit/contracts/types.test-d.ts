/**
 * Type-level tests for the trickiest contract shapes (docs/impl/contracts.md §3.3, §7, §10).
 *
 * Nothing here runs. `npm run typecheck` (tsconfig.node.json) compiles this file, and a wrong
 * `expectTypeOf` assertion is a compile error. The `.test-d.ts` name keeps it out of `vitest run`.
 */
import { describe, expectTypeOf, it } from "vitest";
import type { Clock } from "../../../src/app/clock";
import type { Emitter, GameEvents } from "../../../src/app/events";
import type { VtTestHooks } from "../../../src/app/test-hooks";
import type { AudioApi, Material as AudioMaterial } from "../../../src/audio/types";
import type { BlockDef, Rarity } from "../../../src/content/blocks/types";
import type { Lesson } from "../../../src/content/lessons/types";
import type { rollLoot } from "../../../src/engine/loot";
import type { Rng } from "../../../src/engine/rng";
import type { SessionSummary } from "../../../src/engine/stats";
import type {
  EngineEvent,
  KeyInput,
  SessionConfig,
  SessionSnapshot,
  SessionView,
  TargetView,
} from "../../../src/engine/types";
import type { MessageKey, Namespace } from "../../../src/i18n";
import type { ControlInput, TypedInput } from "../../../src/input/keyboard";
import type { ModeContext, ModeInstance, ModeModule, ModeResult } from "../../../src/modes/types";
import type { TextureRecipe } from "../../../src/render/atlas/recipes";
import type { VoxelGrid } from "../../../src/render/mesher/voxel-grid";
import type { SceneHandle } from "../../../src/render/types";
import type { Profile, StoredSummary } from "../../../src/save/schema";
import type { Settings } from "../../../src/save/settings";
import type {
  AgeBand,
  BlockId,
  EpochMs,
  GameModeId,
  Material,
  Ms,
  QualityLevel,
} from "../../../src/types/core";
import type { HudBridge, HudState } from "../../../src/ui/hud/bridge";

type EventOf<T extends EngineEvent["type"]> = Extract<EngineEvent, { type: T }>;

type Bus = Emitter<GameEvents>;

/** Compile-only: the bodies hold the assertions; nothing calls these. */
const describeEvent = (e: EngineEvent): string => {
  switch (e.type) {
    case "correct":
      expectTypeOf(e.latencyMs).toEqualTypeOf<Ms | null>();
      return e.char;
    case "wrong":
      expectTypeOf(e.targetId).toEqualTypeOf<string | null>();
      return e.got;
    case "backspace":
    case "targetLocked":
    case "targetUnlocked":
      return e.targetId;
    case "targetComplete":
      return String(e.errors);
    case "streak":
    case "streakBroken":
      return String(e.length);
    case "paused":
    case "resumed":
      return String(e.t);
    case "sessionEnd":
      expectTypeOf(e.summary).toEqualTypeOf<SessionSummary>();
      return e.summary.mode;
    default:
      expectTypeOf(e).toBeNever();
      return e;
  }
};

const checkBus = (bus: Bus): void => {
  bus.on("engine", (e) => expectTypeOf(e).toEqualTypeOf<EngineEvent>());
  bus.on("loot", (e) =>
    expectTypeOf(e).toEqualTypeOf<{ block: BlockId; count: number; rarity: Rarity }>(),
  );
  bus.on("quality", (e) => expectTypeOf(e.level).toEqualTypeOf<QualityLevel>());
  // Modes may add namespaced events; their payload is unknown until narrowed.
  bus.on("defense:wave", (e) => expectTypeOf(e).toBeUnknown());
  // @ts-expect-error a loot payload needs a rarity
  bus.emit("loot", { block: "oak-planks", count: 1 });
  // @ts-expect-error `engine` takes an EngineEvent
  bus.emit("engine", { type: "nope" });
};

const checkHud = (hud: HudBridge): void => {
  hud.set({ combo: 3 });
  hud.set({ banner: { key: "common.appName", tone: "cheer" } });
  // @ts-expect-error a banner key must start with a namespace
  hud.set({ banner: { key: "appName", tone: "cheer" } });
  // @ts-expect-error the state is read-only
  hud.get().combo = 1;
};

describe("EngineEvent (§3.3)", () => {
  it("has exactly these variants", () => {
    expectTypeOf<EngineEvent["type"]>().toEqualTypeOf<
      | "correct"
      | "wrong"
      | "backspace"
      | "targetLocked"
      | "targetUnlocked"
      | "targetComplete"
      | "streak"
      | "streakBroken"
      | "paused"
      | "resumed"
      | "sessionEnd"
    >();
  });

  it("carries t on every variant", () => {
    expectTypeOf<EngineEvent["t"]>().toEqualTypeOf<Ms>();
  });

  it("narrows on `type`", () => {
    expectTypeOf<EventOf<"correct">>().toEqualTypeOf<{
      type: "correct";
      t: Ms;
      targetId: string;
      index: number;
      char: string;
      latencyMs: Ms | null;
    }>();
    expectTypeOf<EventOf<"targetComplete">>().toEqualTypeOf<{
      type: "targetComplete";
      t: Ms;
      targetId: string;
      accuracy: number;
      durationMs: Ms;
      errors: number;
    }>();
    expectTypeOf<EventOf<"streak">>().toEqualTypeOf<{ type: "streak"; t: Ms; length: number }>();
    expectTypeOf<EventOf<"paused">>().toEqualTypeOf<{ type: "paused"; t: Ms }>();
    expectTypeOf<EventOf<"sessionEnd">["summary"]>().toEqualTypeOf<SessionSummary>();
  });

  it("allows a lockOn miss: `wrong` with no target", () => {
    expectTypeOf<EventOf<"wrong">["targetId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<EventOf<"wrong">["index"]>().toEqualTypeOf<number | null>();
    expectTypeOf<EventOf<"wrong">["expected"]>().toEqualTypeOf<string | null>();
    expectTypeOf<EventOf<"wrong">["got"]>().toEqualTypeOf<string>();
    // Every other targeted event always names its target.
    expectTypeOf<EventOf<"correct" | "backspace" | "targetLocked">["targetId"]>().toBeString();
  });

  it("narrows inside a switch, and the switch is exhaustive", () => {
    expectTypeOf(describeEvent).returns.toBeString();
  });
});

describe("session shapes (§3.2, §3.4)", () => {
  it("SessionConfig.end is a tagged union", () => {
    expectTypeOf<SessionConfig["end"]>().toEqualTypeOf<
      { kind: "targets" } | { kind: "time"; ms: Ms } | { kind: "manual" }
    >();
    expectTypeOf<SessionConfig["mode"]>().toEqualTypeOf<GameModeId>();
  });

  it("KeyInput.code is optional", () => {
    expectTypeOf<KeyInput>().toEqualTypeOf<{
      key: string;
      t: Ms;
      shift: boolean;
      code?: string;
    }>();
  });

  it("views and snapshots", () => {
    expectTypeOf<TargetView["marks"]>().toEqualTypeOf<("pending" | "ok" | "fixed" | "wrong")[]>();
    expectTypeOf<SessionView["active"]>().toEqualTypeOf<TargetView | null>();
    expectTypeOf<SessionSnapshot["version"]>().toEqualTypeOf<1>();
    expectTypeOf<SessionSnapshot["log"][number]["k"]>().toEqualTypeOf<
      "key" | "add" | "remove" | "pause" | "resume" | "end"
    >();
  });
});

describe("ModeContext and friends (§7)", () => {
  it("ModeContext has exactly these fields", () => {
    expectTypeOf<keyof ModeContext>().toEqualTypeOf<
      | "lesson"
      | "params"
      | "profile"
      | "settings"
      | "band"
      | "rng"
      | "clock"
      | "scene"
      | "hud"
      | "audio"
      | "bus"
      | "finish"
    >();
  });

  it("types each field", () => {
    expectTypeOf<ModeContext["lesson"]>().toEqualTypeOf<Lesson | null>();
    expectTypeOf<ModeContext["params"]>().toEqualTypeOf<Record<string, unknown>>();
    expectTypeOf<ModeContext["profile"]>().toEqualTypeOf<Readonly<Profile>>();
    expectTypeOf<ModeContext["settings"]>().toEqualTypeOf<Readonly<Settings>>();
    expectTypeOf<ModeContext["band"]>().toEqualTypeOf<AgeBand>();
    expectTypeOf<ModeContext["rng"]>().toEqualTypeOf<Rng>();
    expectTypeOf<ModeContext["clock"]>().toEqualTypeOf<Clock>();
    expectTypeOf<ModeContext["scene"]>().toEqualTypeOf<SceneHandle>();
    expectTypeOf<ModeContext["hud"]>().toEqualTypeOf<HudBridge>();
    expectTypeOf<ModeContext["audio"]>().toEqualTypeOf<AudioApi>();
    expectTypeOf<ModeContext["bus"]>().toEqualTypeOf<Emitter<GameEvents>>();
    expectTypeOf<ModeContext["finish"]>().toEqualTypeOf<(result: ModeResult) => void>();
  });

  it("ModeModule loads lazily and creates a ModeInstance from a ModeContext", () => {
    expectTypeOf<ModeModule["id"]>().toEqualTypeOf<GameModeId>();
    expectTypeOf<ModeModule["load"]>().returns.resolves.toEqualTypeOf<{
      create(ctx: ModeContext): ModeInstance;
    }>();
    expectTypeOf<ModeInstance["input"]>().parameter(0).toEqualTypeOf<KeyInput>();
    expectTypeOf<ModeInstance["frame"]>().parameters.toEqualTypeOf<[dtMs: Ms, t: Ms]>();
  });

  it("ModeResult", () => {
    expectTypeOf<ModeResult["stars"]>().toEqualTypeOf<0 | 1 | 2 | 3>();
    expectTypeOf<ModeResult["loot"]>().toEqualTypeOf<Record<BlockId, number>>();
    expectTypeOf<ModeResult["summary"]>().toEqualTypeOf<SessionSummary>();
  });

  it("the bus pairs each event name with its payload", () => {
    expectTypeOf<Parameters<Bus["on"]>[0]>().toEqualTypeOf<string | number>();
    expectTypeOf(checkBus).toBeFunction();
  });
});

describe("HudState (§10)", () => {
  it("has exactly these fields", () => {
    expectTypeOf<keyof HudState>().toEqualTypeOf<
      "word" | "combo" | "progress01" | "nextKey" | "banner" | "capsLock" | "timer" | "custom"
    >();
  });

  it("types each field", () => {
    expectTypeOf<HudState["word"]>().toEqualTypeOf<{
      text: string;
      marks: TargetView["marks"];
      typed: number;
    } | null>();
    expectTypeOf<HudState["nextKey"]>().toEqualTypeOf<string | null>();
    expectTypeOf<HudState["banner"]>().toEqualTypeOf<{
      key: MessageKey;
      params?: Record<string, string | number>;
      tone: "info" | "cheer";
    } | null>();
    expectTypeOf<HudState["timer"]>().toEqualTypeOf<{ remainingMs: Ms } | null>();
    expectTypeOf<HudState["custom"]>().toEqualTypeOf<Record<string, unknown>>();
  });

  it("HudBridge takes partial patches and returns a read-only state", () => {
    expectTypeOf<HudBridge["set"]>().parameter(0).toEqualTypeOf<Partial<HudState>>();
    expectTypeOf<HudBridge["get"]>().returns.toEqualTypeOf<Readonly<HudState>>();
    expectTypeOf(checkHud).toBeFunction();
  });
});

describe("cross-module shapes", () => {
  it("MessageKey is `<namespace>.<key>`", () => {
    expectTypeOf<"common">().toExtend<Namespace>();
    expectTypeOf<"common.appName">().toExtend<MessageKey>();
    expectTypeOf<"appName">().not.toExtend<MessageKey>();
    expectTypeOf<"nope.appName">().not.toExtend<MessageKey>();
  });

  it("Material is one type on both contract paths (§12, §17)", () => {
    expectTypeOf<AudioMaterial>().toEqualTypeOf<Material>();
    expectTypeOf<BlockDef["material"]>().toEqualTypeOf<Material>();
  });

  it("TextureRecipe is recursive", () => {
    expectTypeOf<Extract<TextureRecipe, { kind: "ore" }>["base"]>().toEqualTypeOf<TextureRecipe>();
    expectTypeOf<BlockDef["faces"]>().toEqualTypeOf<{
      top: TextureRecipe;
      side: TextureRecipe;
      bottom: TextureRecipe;
    }>();
  });

  it("speed is not an input of rollLoot (§18)", () => {
    expectTypeOf<keyof Parameters<typeof rollLoot>[0]>().toEqualTypeOf<
      "biome" | "wordLen" | "streak" | "targetAccuracy" | "band"
    >();
  });

  it("SceneHandle is three or lite", () => {
    expectTypeOf<SceneHandle["three"]>().toBeNullable();
    expectTypeOf<SceneHandle["lite"]>().toBeNullable();
    expectTypeOf<SceneHandle["loadDiorama"]>().parameters.toEqualTypeOf<
      [id: string, grid: VoxelGrid]
    >();
  });

  it("input is typed or control (§9)", () => {
    expectTypeOf<TypedInput>().toEqualTypeOf<{ kind: "typed"; input: KeyInput }>();
    expectTypeOf<(TypedInput | ControlInput)["kind"]>().toEqualTypeOf<"typed" | "control">();
  });

  it("save shapes (§15)", () => {
    expectTypeOf<StoredSummary>().toEqualTypeOf<
      Omit<SessionSummary, "perKey" | "bigrams"> & { at: EpochMs }
    >();
    expectTypeOf<keyof StoredSummary>().not.toEqualTypeOf<keyof SessionSummary>();
    expectTypeOf<NonNullable<Profile["island"]>["grid"]>().toEqualTypeOf<{
      sx: number;
      sy: number;
      sz: number;
      rle: number[];
    }>();
    expectTypeOf<Profile["settings"]>().toEqualTypeOf<Settings>();
    expectTypeOf<Settings["reducedMotion"]>().toEqualTypeOf<boolean | "system">();
    expectTypeOf<Settings["volume"]>().toEqualTypeOf<
      Record<"master" | "music" | "sfx" | "voice", number>
    >();
  });

  it("test hooks (§13)", () => {
    expectTypeOf<VtTestHooks["session"]>().returns.toEqualTypeOf<SessionView | null>();
    expectTypeOf<VtTestHooks["lastResult"]>().returns.toEqualTypeOf<ModeResult | null>();
    expectTypeOf<VtTestHooks["ready"]>().returns.resolves.toBeVoid();
  });
});
