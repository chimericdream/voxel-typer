/** t() and setLocale() (src/i18n/index.ts, docs/impl/contracts.md §11). */
import { afterEach, describe, expect, it, vi } from "vitest";
import { setLocale, t } from "../../../src/i18n";
import common from "../../../src/i18n/en/common";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setLocale("en");
});

describe("t", () => {
  it("returns the English text for a key", () => {
    expect(t("common.appName")).toBe(common.appName);
    expect(t("common.notAffiliated")).toBe(
      "Voxel Typer is an independent game and is not affiliated with Mojang or Microsoft.",
    );
  });

  it("ignores params the text doesn't use", () => {
    expect(t("common.appName", { unused: 1 })).toBe("Voxel Typer");
  });

  it("does not resolve inherited object properties as keys", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(t("common.toString")).toBe("⟦common.toString⟧");
    expect(t("common.constructor")).toBe("⟦common.constructor⟧");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("treats an empty or too-deep path as missing", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(t("common.")).toBe("⟦common.⟧");
    expect(t("common.appName.deeper")).toBe("⟦common.appName.deeper⟧");
  });
});

describe("missing keys", () => {
  it("in dev: returns ⟦key⟧ and warns once per key", () => {
    expect(import.meta.env.DEV).toBe(true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(t("common.devMissingA")).toBe("⟦common.devMissingA⟧");
    expect(t("common.devMissingA", { n: 2 })).toBe("⟦common.devMissingA⟧");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain("common.devMissingA");
    t("common.devMissingB");
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("in production: returns the key's last segment, without warning", () => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("PROD", true);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(t("common.prodMissing")).toBe("prodMissing");
    expect(t("common.deep.path.play")).toBe("play");
    expect(t("common.appName")).toBe("Voxel Typer");
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("setLocale", () => {
  it("en-XA falls back to English until the pseudo-locale exists (M6)", () => {
    setLocale("en-XA");
    expect(t("common.appName")).toBe("Voxel Typer");
    setLocale("en");
    expect(t("common.appName")).toBe("Voxel Typer");
  });

  it("a key missing from English is missing in every locale", () => {
    vi.stubEnv("DEV", false);
    setLocale("en-XA");
    expect(t("common.nowhere")).toBe("nowhere");
  });
});
