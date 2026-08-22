import { describe, expect, test } from "vitest";
import { parseJsonc } from "./parse-jsonc.ts";

const PATH = "/project/.tuor/config.json";

describe("parseJsonc", () => {
  test("parses plain JSON", () => {
    expect(parseJsonc('{"workdir": "/workspace"}', PATH)).toEqual({
      workdir: "/workspace",
    });
  });

  test("ignores line comments", () => {
    const text = [
      "{",
      "  // the guest working directory",
      '  "workdir": "/workspace" // trailing comment',
      "}",
    ].join("\n");
    expect(parseJsonc(text, PATH)).toEqual({ workdir: "/workspace" });
  });

  test("ignores block comments", () => {
    const text = '{ /* a\n   multi-line note */ "workdir": "/workspace" }';
    expect(parseJsonc(text, PATH)).toEqual({ workdir: "/workspace" });
  });

  test("allows trailing commas in objects and arrays", () => {
    const text = '{ "bootCommands": ["apk add ripgrep", ], }';
    expect(parseJsonc(text, PATH)).toEqual({
      bootCommands: ["apk add ripgrep"],
    });
  });

  test("does not treat a // inside a string as a comment", () => {
    expect(parseJsonc('{ "url": "https://example.com" }', PATH)).toEqual({
      url: "https://example.com",
    });
  });

  test("throws on malformed input instead of returning a partial tree", () => {
    // The underlying parser is error-tolerant and would otherwise hand back
    // `{}` here, silently dropping the config.
    expect(() => parseJsonc('{ "workdir": }', PATH)).toThrow(
      /Invalid JSON in \/project\/\.tuor\/config\.json/,
    );
  });

  test("throws on an empty file", () => {
    expect(() => parseJsonc("", PATH)).toThrow(/Invalid JSON/);
  });

  test("error message points at the offending line and column", () => {
    const text = ["{", '  "a": 1', '  "b": 2', "}"].join("\n");
    expect(() => parseJsonc(text, PATH)).toThrow(
      "Invalid JSON in /project/.tuor/config.json:3:3: CommaExpected",
    );
  });

  test("error message reports the first error on the first line", () => {
    expect(() => parseJsonc("<html>", PATH)).toThrow(
      "Invalid JSON in /project/.tuor/config.json:1:1: InvalidSymbol",
    );
  });
});
