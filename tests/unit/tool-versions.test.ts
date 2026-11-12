/** Proves tools/check-tool-versions.ts catches a Node pin that drifts between mise.toml and .nvmrc. */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { checkPins, miseNodeVersion } from "../../tools/check-tool-versions";

const toml = (node: string): string => `min_version = "2025.1.0"\n\n[tools]\nnode = "${node}"\n`;

describe("check-tool-versions", () => {
  it("reads node from [tools]", () => {
    expect(miseNodeVersion(toml("26.13.1"))).toBe("26.13.1");
    expect(miseNodeVersion('[env]\nnode = "1.0.0"\n')).toBeUndefined();
  });

  it("passes when both pins agree", () => {
    expect(checkPins(toml("26.13.1"), "26.13.1\n")).toEqual([]);
    expect(checkPins(toml("26.13.1"), "v26.13.1")).toEqual([]);
  });

  it("fails on drift, loose versions or a missing pin", () => {
    expect(checkPins(toml("26.13.1"), "26.13.0")).toHaveLength(1);
    expect(checkPins(toml("26"), "26")).toHaveLength(2);
    expect(checkPins("[tools]\n", "26.13.1")).toHaveLength(1);
  });

  it("passes on the repo's own files", () => {
    expect(checkPins(readFileSync("mise.toml", "utf8"), readFileSync(".nvmrc", "utf8"))).toEqual(
      [],
    );
  });
});
