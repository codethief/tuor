import { describe, expect, test } from "vitest";
import { buildShadowPredicate, type ScopedPattern } from "./shadow.ts";

/** Helper: root-scoped patterns */
const root = (patterns: string[]): ScopedPattern[] =>
  patterns.map((pattern) => ({ pattern, scope: "/" }));

const matches = (patterns: ScopedPattern[], path: string) =>
  buildShadowPredicate(patterns)({ op: "stat", path });

describe("buildShadowPredicate", () => {
  describe("bare names (no /) at root scope", () => {
    test("matches at root", () => {
      expect(matches(root([".envrc"]), "/.envrc")).toBe(true);
    });

    test("matches in subdirectory", () => {
      expect(matches(root([".envrc"]), "/sub/.envrc")).toBe(true);
    });

    test("matches in deeply nested directory", () => {
      expect(matches(root([".envrc"]), "/a/b/c/.envrc")).toBe(true);
    });

    test("shadows children of matched path", () => {
      expect(matches(root([".git"]), "/.git/config")).toBe(true);
    });

    test("does not match partial filename", () => {
      expect(matches(root([".env"]), "/.envrc")).toBe(false);
    });

    test("does not match as substring of directory", () => {
      expect(matches(root(["env"]), "/environment/file")).toBe(false);
    });
  });

  describe("anchored paths (containing /) at root scope", () => {
    test("matches exact path with leading /", () => {
      expect(matches(root(["/build"]), "/build")).toBe(true);
    });

    test("shadows children of anchored path", () => {
      expect(matches(root(["/build"]), "/build/output.js")).toBe(true);
    });

    test("does not match at other depths", () => {
      expect(matches(root(["/build"]), "/sub/build")).toBe(false);
    });

    test("anchors path containing / without leading /", () => {
      expect(matches(root(["sub/.envrc"]), "/sub/.envrc")).toBe(true);
    });

    test("does not match unanchored for path with /", () => {
      expect(matches(root(["sub/.envrc"]), "/other/sub/.envrc")).toBe(false);
    });
  });

  describe("trailing / handling", () => {
    test("trailing / is stripped for matching", () => {
      expect(matches(root(["build/"]), "/build")).toBe(true);
    });

    test("trailing / still shadows children", () => {
      expect(matches(root(["build/"]), "/build/output.js")).toBe(true);
    });

    test("bare / is not stripped (shadows everything)", () => {
      expect(matches(root(["/"]), "/anything")).toBe(true);
    });

    test("bare / shadows root", () => {
      expect(matches(root(["/"]), "/")).toBe(true);
    });
  });

  describe("scoped patterns", () => {
    test("bare name in sub scope matches at any depth under scope", () => {
      const patterns: ScopedPattern[] = [{ pattern: ".envrc", scope: "/sub" }];
      expect(matches(patterns, "/sub/.envrc")).toBe(true);
      expect(matches(patterns, "/sub/deep/.envrc")).toBe(true);
      expect(matches(patterns, "/sub/a/b/.envrc")).toBe(true);
    });

    test("bare name in sub scope does not match outside scope", () => {
      const patterns: ScopedPattern[] = [{ pattern: ".envrc", scope: "/sub" }];
      expect(matches(patterns, "/.envrc")).toBe(false);
      expect(matches(patterns, "/other/.envrc")).toBe(false);
    });

    test("anchored path in sub scope is relative to scope", () => {
      const patterns: ScopedPattern[] = [{ pattern: "build/out", scope: "/sub" }];
      expect(matches(patterns, "/sub/build/out")).toBe(true);
      expect(matches(patterns, "/sub/build/out/file.js")).toBe(true);
    });

    test("anchored path in sub scope does not match outside scope", () => {
      const patterns: ScopedPattern[] = [{ pattern: "build/out", scope: "/sub" }];
      expect(matches(patterns, "/build/out")).toBe(false);
      expect(matches(patterns, "/other/build/out")).toBe(false);
    });

    test("shadows children of scoped match", () => {
      const patterns: ScopedPattern[] = [{ pattern: ".git", scope: "/sub" }];
      expect(matches(patterns, "/sub/.git/config")).toBe(true);
      expect(matches(patterns, "/sub/deep/.git/config")).toBe(true);
    });
  });

  describe("no patterns", () => {
    test("matches nothing when patterns list is empty", () => {
      expect(matches([], "/anything")).toBe(false);
    });
  });
});
