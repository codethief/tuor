import { describe, expect, test } from "vitest";
import { assertGreater, assertValid } from "./semver.ts";

describe("assertValid", () => {
  test("returns the normalized version for a valid input", () => {
    expect(assertValid("1.2.3")).toBe("1.2.3");
  });

  test("normalizes a leading-v / loose version", () => {
    expect(assertValid("v1.2.3")).toBe("1.2.3");
  });

  test("throws on a non-version string", () => {
    expect(() => assertValid("not-a-version")).toThrow();
  });

  test("throws on an empty string", () => {
    expect(() => assertValid("")).toThrow();
  });
});

describe("assertGreater", () => {
  test("accepts a strictly greater version", () => {
    expect(() => assertGreater("0.1.0", "0.2.0")).not.toThrow();
  });

  test("throws when the versions are equal", () => {
    expect(() => assertGreater("0.2.0", "0.2.0")).toThrow();
  });

  test("throws when the next version is lower", () => {
    expect(() => assertGreater("0.2.0", "0.1.0")).toThrow();
  });

  test("treats a prerelease as lower than its release", () => {
    expect(() => assertGreater("0.2.0-rc.1", "0.2.0")).not.toThrow();
    expect(() => assertGreater("0.2.0", "0.2.0-rc.1")).toThrow();
  });

  test("orders prereleases of the same release", () => {
    expect(() => assertGreater("0.2.0-rc.1", "0.2.0-rc.2")).not.toThrow();
  });

  test("throws when either input is not a valid version", () => {
    expect(() => assertGreater("0.1.0", "garbage")).toThrow();
    expect(() => assertGreater("garbage", "0.2.0")).toThrow();
  });
});
