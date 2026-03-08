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
  test("parses valid containerfile source", () => {
    const raw = { rootfs: { ociImage: { containerfile: "./Containerfile" } } };
    expect(parseConfig(raw)).toEqual({
      rootfs: { ociImage: { containerfile: "./Containerfile" } },
    });
  });

  test("parses containerfile source with context", () => {
    const raw = { rootfs: { ociImage: { containerfile: "./Containerfile", context: "./ctx" } } };
    expect(parseConfig(raw)).toEqual({
      rootfs: { ociImage: { containerfile: "./Containerfile", context: "./ctx" } },
    });
  });

  test("parses valid tag source", () => {
    const raw = { rootfs: { ociImage: { tag: "docker.io/ubuntu:latest" } } };
    expect(parseConfig(raw)).toEqual({
      rootfs: { ociImage: { tag: "docker.io/ubuntu:latest" } },
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

  test("throws when rootfs field is missing", () => {
    expect(() => parseConfig({})).toThrow("config must have a 'rootfs' object");
  });

  test("throws when rootfs is not an object", () => {
    expect(() => parseConfig({ rootfs: "string" })).toThrow(
      "config must have a 'rootfs' object",
    );
  });

  test("throws when ociImage field is missing", () => {
    expect(() => parseConfig({ rootfs: {} })).toThrow(
      "rootfs must have an 'ociImage' object",
    );
  });

  test("throws when ociImage is not an object", () => {
    expect(() => parseConfig({ rootfs: { ociImage: "string" } })).toThrow(
      "rootfs must have an 'ociImage' object",
    );
  });

  test("throws when ociImage has no recognized field", () => {
    expect(() => parseConfig({ rootfs: { ociImage: { other: "value" } } })).toThrow(
      "ociImage must have a 'containerfile' or 'tag' field",
    );
  });

  test("throws when containerfile is not a string", () => {
    expect(() => parseConfig({ rootfs: { ociImage: { containerfile: 42 } } })).toThrow(
      "ociImage.containerfile must be a non-empty string",
    );
  });

  test("throws when containerfile is empty", () => {
    expect(() => parseConfig({ rootfs: { ociImage: { containerfile: "" } } })).toThrow(
      "ociImage.containerfile must be a non-empty string",
    );
  });

  test("throws when tag is not a string", () => {
    expect(() => parseConfig({ rootfs: { ociImage: { tag: 123 } } })).toThrow(
      "ociImage.tag must be a non-empty string",
    );
  });

  test("throws when tag is empty", () => {
    expect(() => parseConfig({ rootfs: { ociImage: { tag: "" } } })).toThrow(
      "ociImage.tag must be a non-empty string",
    );
  });

  test("throws when context is not a string", () => {
    expect(() =>
      parseConfig({ rootfs: { ociImage: { containerfile: "./Containerfile", context: 42 } } }),
    ).toThrow("ociImage.context must be a string");
  });

  test("parses engine field inside ociImage", () => {
    const raw = { rootfs: { ociImage: { tag: "ubuntu:latest", engine: "podman" } } };
    expect(parseConfig(raw)).toEqual({
      rootfs: { ociImage: { tag: "ubuntu:latest", engine: "podman" } },
    });
  });

  test("omits engine when not specified", () => {
    const raw = { rootfs: { ociImage: { tag: "ubuntu:latest" } } };
    expect(parseConfig(raw)).toEqual({
      rootfs: { ociImage: { tag: "ubuntu:latest" } },
    });
  });

  test("throws when engine is invalid", () => {
    expect(() =>
      parseConfig({ rootfs: { ociImage: { tag: "x:y", engine: "containerd" } } }),
    ).toThrow('engine must be "docker" or "podman"');
  });

  test("parses fsSize field", () => {
    const raw = { rootfs: { ociImage: { tag: "ubuntu:latest" }, fsSize: 4096 } };
    expect(parseConfig(raw)).toEqual({
      rootfs: { ociImage: { tag: "ubuntu:latest" }, fsSize: 4096 },
    });
  });

  test("omits fsSize when not specified", () => {
    const raw = { rootfs: { ociImage: { tag: "ubuntu:latest" } } };
    expect(parseConfig(raw)).toEqual({
      rootfs: { ociImage: { tag: "ubuntu:latest" } },
    });
  });

  test("throws when fsSize is not a positive integer", () => {
    expect(() =>
      parseConfig({ rootfs: { ociImage: { tag: "x:y" }, fsSize: -1 } }),
    ).toThrow("fsSize must be a positive integer");

    expect(() =>
      parseConfig({ rootfs: { ociImage: { tag: "x:y" }, fsSize: 1.5 } }),
    ).toThrow("fsSize must be a positive integer");

    expect(() =>
      parseConfig({ rootfs: { ociImage: { tag: "x:y" }, fsSize: "big" } }),
    ).toThrow("fsSize must be a positive integer");
  });
});
