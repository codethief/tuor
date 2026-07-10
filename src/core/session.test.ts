import { describe, expect, test } from "vitest";
import { _formatCommandOutput } from "./session.ts";

describe("_formatCommandOutput", () => {
  test("returns empty string when both streams are empty", () => {
    expect(_formatCommandOutput("", "")).toBe("");
  });

  test("gutter-prefixes each stdout line", () => {
    expect(_formatCommandOutput("line1\nline2", "")).toBe(
      "  │ line1\n  │ line2",
    );
  });

  test("appends stderr after stdout", () => {
    expect(_formatCommandOutput("out", "err")).toBe("  │ out\n  │ err");
  });

  test("trims trailing newline so no blank gutter line is printed", () => {
    expect(_formatCommandOutput("out\n", "")).toBe("  │ out");
  });

  test("preserves leading indentation within a line", () => {
    expect(_formatCommandOutput("  indented", "")).toBe("  │   indented");
  });

  test("skips an empty stream and shows only the other", () => {
    expect(_formatCommandOutput("", "only err")).toBe("  │ only err");
  });
});
