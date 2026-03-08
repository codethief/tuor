import { describe, expect, test } from "vitest";
import { findConfigDir, parseConfig } from "./config.ts";

describe("findConfigDir", () => {
  test("returns config dir when config.json exists in start directory", () => {
    const exists = (path: string) => path === "/project/.tuor/config.json";
    expect(findConfigDir("/project", exists)).toBe("/project/.tuor");
  });

  test("returns config dir when config.json exists in parent directory", () => {
    const exists = (path: string) => path === "/project/.tuor/config.json";
    expect(findConfigDir("/project/src/deep", exists)).toBe("/project/.tuor");
  });

  test("returns null when no config.json is found", () => {
    const exists = () => false;
    expect(findConfigDir("/some/path", exists)).toBeNull();
  });
});

describe("parseConfig", () => {
  test("parses valid dockerfile source", () => {
    const raw = { image: { dockerfile: "./Dockerfile" } };
    expect(parseConfig(raw)).toEqual({
      image: { dockerfile: "./Dockerfile" },
    });
  });

  test("parses dockerfile source with context", () => {
    const raw = { image: { dockerfile: "./Dockerfile", context: "./ctx" } };
    expect(parseConfig(raw)).toEqual({
      image: { dockerfile: "./Dockerfile", context: "./ctx" },
    });
  });

  test("parses valid tag source", () => {
    const raw = { image: { tag: "default:latest" } };
    expect(parseConfig(raw)).toEqual({
      image: { tag: "default:latest" },
    });
  });

  test("throws when config is not an object", () => {
    expect(() => parseConfig("not an object")).toThrow("config must be a JSON object");
  });

  test("throws when config is null", () => {
    expect(() => parseConfig(null)).toThrow("config must be a JSON object");
  });

  test("throws when config is an array", () => {
    expect(() => parseConfig([1, 2])).toThrow("config must be a JSON object");
  });

  test("throws when image field is missing", () => {
    expect(() => parseConfig({})).toThrow("config must have an 'image' object");
  });

  test("throws when image is not an object", () => {
    expect(() => parseConfig({ image: "string" })).toThrow(
      "config must have an 'image' object",
    );
  });

  test("parses valid oci source", () => {
    const raw = { image: { oci: "docker.io/ubuntu:latest" } };
    expect(parseConfig(raw)).toEqual({
      image: { oci: "docker.io/ubuntu:latest" },
    });
  });

  test("throws when oci is not a string", () => {
    expect(() => parseConfig({ image: { oci: 42 } })).toThrow(
      "image.oci must be a non-empty string",
    );
  });

  test("throws when oci is empty", () => {
    expect(() => parseConfig({ image: { oci: "" } })).toThrow(
      "image.oci must be a non-empty string",
    );
  });

  test("throws when image has no recognized field", () => {
    expect(() => parseConfig({ image: { other: "value" } })).toThrow(
      "image must have a 'dockerfile', 'oci', or 'tag' field",
    );
  });

  test("throws when dockerfile is not a string", () => {
    expect(() => parseConfig({ image: { dockerfile: 42 } })).toThrow(
      "image.dockerfile must be a non-empty string",
    );
  });

  test("throws when dockerfile is empty", () => {
    expect(() => parseConfig({ image: { dockerfile: "" } })).toThrow(
      "image.dockerfile must be a non-empty string",
    );
  });

  test("throws when tag is not a string", () => {
    expect(() => parseConfig({ image: { tag: 123 } })).toThrow(
      "image.tag must be a non-empty string",
    );
  });

  test("throws when tag is empty", () => {
    expect(() => parseConfig({ image: { tag: "" } })).toThrow(
      "image.tag must be a non-empty string",
    );
  });

  test("throws when context is not a string", () => {
    expect(() =>
      parseConfig({ image: { dockerfile: "./Dockerfile", context: 42 } }),
    ).toThrow("image.context must be a string");
  });

  test("parses runtime field", () => {
    const raw = { image: { tag: "default:latest" }, runtime: "podman" };
    expect(parseConfig(raw)).toEqual({
      image: { tag: "default:latest" },
      runtime: "podman",
    });
  });

  test("omits runtime when not specified", () => {
    const raw = { image: { tag: "default:latest" } };
    expect(parseConfig(raw)).toEqual({
      image: { tag: "default:latest" },
    });
  });

  test("throws when runtime is invalid", () => {
    expect(() =>
      parseConfig({ image: { tag: "x:y" }, runtime: "containerd" }),
    ).toThrow('runtime must be "docker" or "podman"');
  });

  test("parses rootfsSizeMb field", () => {
    const raw = { image: { tag: "default:latest" }, rootfsSizeMb: 4096 };
    expect(parseConfig(raw)).toEqual({
      image: { tag: "default:latest" },
      rootfsSizeMb: 4096,
    });
  });

  test("omits rootfsSizeMb when not specified", () => {
    const raw = { image: { tag: "default:latest" } };
    expect(parseConfig(raw)).toEqual({
      image: { tag: "default:latest" },
    });
  });

  test("throws when rootfsSizeMb is not a positive integer", () => {
    expect(() =>
      parseConfig({ image: { tag: "x:y" }, rootfsSizeMb: -1 }),
    ).toThrow("rootfsSizeMb must be a positive integer");

    expect(() =>
      parseConfig({ image: { tag: "x:y" }, rootfsSizeMb: 1.5 }),
    ).toThrow("rootfsSizeMb must be a positive integer");

    expect(() =>
      parseConfig({ image: { tag: "x:y" }, rootfsSizeMb: "big" }),
    ).toThrow("rootfsSizeMb must be a positive integer");
  });
});
