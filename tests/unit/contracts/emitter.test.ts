import { describe, expect, it } from "vitest";
import { createEmitter, type GameEvents } from "../../../src/app/events";

type Events = { a: number; b: string };

describe("createEmitter (contracts §7.2)", () => {
  it("delivers a payload to every subscriber of that event, in subscription order", () => {
    const bus = createEmitter<Events>();
    const seen: string[] = [];
    bus.on("a", (n) => seen.push(`first:${n}`));
    bus.on("a", (n) => seen.push(`second:${n}`));
    bus.on("b", (s) => seen.push(`b:${s}`));
    bus.emit("a", 1);
    bus.emit("b", "x");
    bus.emit("a", 2);
    expect(seen).toEqual(["first:1", "second:1", "b:x", "first:2", "second:2"]);
  });

  it("does nothing when nobody listens", () => {
    const bus = createEmitter<Events>();
    expect(() => bus.emit("a", 1)).not.toThrow();
  });

  it("on() returns an unsubscribe function, which is idempotent", () => {
    const bus = createEmitter<Events>();
    const seen: number[] = [];
    const off = bus.on("a", (n) => seen.push(n));
    const seenByOther: number[] = [];
    bus.on("a", (n) => seenByOther.push(n));
    bus.emit("a", 1);
    off();
    off();
    bus.emit("a", 2);
    expect(seen).toEqual([1]);
    expect(seenByOther).toEqual([1, 2]);
  });

  it("treats two subscriptions of the same function separately", () => {
    const bus = createEmitter<Events>();
    let calls = 0;
    const fn = (): void => {
      calls += 1;
    };
    const offFirst = bus.on("a", fn);
    bus.on("a", fn);
    bus.emit("a", 0);
    expect(calls).toBe(2);
    offFirst();
    offFirst(); // must not remove the second subscription
    bus.emit("a", 0);
    expect(calls).toBe(3);
  });

  it("emits to a snapshot: changes during an emit apply from the next emit", () => {
    const bus = createEmitter<Events>();
    const seen: string[] = [];
    const offSecond = { run: (): void => {} };
    bus.on("a", () => {
      seen.push("first");
      offSecond.run();
      bus.on("a", () => seen.push("late"));
    });
    offSecond.run = bus.on("a", () => seen.push("second"));
    bus.emit("a", 0);
    expect(seen).toEqual(["first", "second"]);
    seen.length = 0;
    bus.emit("a", 0);
    expect(seen).toEqual(["first", "late"]);
  });

  it("supports a nested emit from inside a subscriber", () => {
    const bus = createEmitter<Events>();
    const seen: string[] = [];
    bus.on("a", (n) => {
      seen.push(`a:${n}`);
      if (n === 1) bus.emit("b", "inner");
    });
    bus.on("b", (s) => seen.push(`b:${s}`));
    bus.on("a", (n) => seen.push(`a2:${n}`));
    bus.emit("a", 1);
    expect(seen).toEqual(["a:1", "b:inner", "a2:1"]);
  });

  it("lets a subscriber's error reach the emitter's caller", () => {
    const bus = createEmitter<Events>();
    bus.on("a", () => {
      throw new Error("boom");
    });
    expect(() => bus.emit("a", 1)).toThrow("boom");
  });

  it("keeps event names apart from Object.prototype members", () => {
    const bus = createEmitter<Record<string, unknown>>();
    const seen: unknown[] = [];
    expect(() => bus.emit("toString", 1)).not.toThrow();
    expect(() => bus.emit("__proto__", 1)).not.toThrow();
    bus.on("__proto__", (e) => seen.push(e));
    bus.on("constructor", (e) => seen.push(e));
    bus.emit("__proto__", "p");
    bus.emit("constructor", "c");
    expect(seen).toEqual(["p", "c"]);
  });

  it("carries GameEvents, including namespaced mode events", () => {
    const bus = createEmitter<GameEvents>();
    const seen: unknown[] = [];
    bus.on("engine", (e) => seen.push(e.type));
    bus.on("loot", (e) => seen.push(e.rarity));
    bus.on("defense:wave", (e) => seen.push(e));
    bus.emit("engine", { type: "streak", t: 10, length: 3 });
    bus.emit("loot", { block: "oak-planks", count: 2, rarity: "rare" });
    bus.emit("defense:wave", { wave: 2 });
    expect(seen).toEqual(["streak", "rare", { wave: 2 }]);
  });
});
