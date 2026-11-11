import { afterEach, describe, expect, it, vi } from "vitest";
import { newId, uuidFromBytes } from "../../../src/save/id";

const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("newId", () => {
  it("returns distinct v4 UUIDs", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newId()));
    expect(ids.size).toBe(500);
    for (const id of ids) expect(id).toMatch(V4);
  });

  it("uses crypto.randomUUID when it exists", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
      getRandomValues: () => {
        throw new Error("should not be called");
      },
    });
    expect(newId()).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("builds a v4 UUID from getRandomValues outside a secure context (no randomUUID)", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", {
      getRandomValues: (a: Uint8Array<ArrayBuffer>) => real.getRandomValues(a),
    });
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(V4);
  });
});

describe("uuidFromBytes", () => {
  it("sets the version and variant bits and keeps the rest", () => {
    expect(uuidFromBytes(new Uint8Array(16).fill(0xff))).toBe(
      "ffffffff-ffff-4fff-bfff-ffffffffffff",
    );
    expect(uuidFromBytes(new Uint8Array(16))).toBe("00000000-0000-4000-8000-000000000000");
    expect(uuidFromBytes(Uint8Array.from({ length: 16 }, (_, i) => i))).toBe(
      "00010203-0405-4607-8809-0a0b0c0d0e0f",
    );
  });

  it("refuses fewer than 16 bytes", () => {
    expect(() => uuidFromBytes(new Uint8Array(15))).toThrow();
  });
});
