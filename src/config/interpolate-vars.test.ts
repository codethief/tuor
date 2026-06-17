// biome-ignore-all lint/suspicious/noTemplateCurlyInString: testing literal ${VAR} interpolation syntax in plain strings
import { describe, expect, test } from "vitest";
import { interpolateVars } from "./interpolate-vars.ts";

describe("interpolateVars", () => {
  describe("string interpolation", () => {
    test("interpolates a bare $VAR", () => {
      expect(interpolateVars("$HOME/projects", { HOME: "/home/me" })).toBe(
        "/home/me/projects",
      );
    });

    test("interpolates a braced ${VAR}", () => {
      expect(interpolateVars("${HOME}/projects", { HOME: "/home/me" })).toBe(
        "/home/me/projects",
      );
    });

    test("braces allow a variable adjacent to word characters", () => {
      expect(interpolateVars("${SIZE}B", { SIZE: "2" })).toBe("2B");
    });

    test("interpolates multiple variables in one string", () => {
      expect(interpolateVars("$A:$B", { A: "first", B: "second" })).toBe(
        "first:second",
      );
    });

    test("$$ is replaced with a literal $", () => {
      expect(interpolateVars("price$$5", {})).toBe("price$5");
    });

    test("$$ next to a variable does not consume the variable", () => {
      expect(interpolateVars("$$$VAR", { VAR: "x" })).toBe("$x");
    });

    test("leaves a $ not forming a valid name untouched", () => {
      expect(interpolateVars("$5 and 100$", {})).toBe("$5 and 100$");
    });

    test("leaves a malformed ${...} untouched", () => {
      expect(interpolateVars("${FOO-BAR}", {})).toBe("${FOO-BAR}");
    });
  });

  describe("recursion", () => {
    test("interpolates string values inside arrays", () => {
      expect(
        interpolateVars(["$A", "literal", "$B"], { A: "1", B: "2" }),
      ).toEqual(["1", "literal", "2"]);
    });

    test("interpolates string values inside nested objects", () => {
      expect(
        interpolateVars(
          { mount: { hostPath: "$HOME/x", mode: "readonly" } },
          { HOME: "/home/me" },
        ),
      ).toEqual({ mount: { hostPath: "/home/me/x", mode: "readonly" } });
    });

    test("never interpolates object keys", () => {
      expect(interpolateVars({ $FOO: "$BAR" }, { BAR: "v" })).toEqual({
        $FOO: "v",
      });
    });
  });

  describe("non-string values", () => {
    test("passes numbers, booleans and null through unchanged", () => {
      expect(interpolateVars({ n: 2, b: true, z: null }, {})).toEqual({
        n: 2,
        b: true,
        z: null,
      });
    });
  });

  describe("missing variables", () => {
    test("throws naming the missing variable", () => {
      expect(() => interpolateVars("$NOPE", {})).toThrowError(
        /environment variable "NOPE" is not set/,
      );
    });

    test("error message includes the JSON path of the offending value", () => {
      expect(() =>
        interpolateVars({ mounts: [{ hostPath: "$NOPE" }] }, {}),
      ).toThrowError(/at "mounts\[0\]\.hostPath"/);
    });
  });
});
