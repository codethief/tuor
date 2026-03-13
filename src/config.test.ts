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
  test("parses minimal config with tag", () => {
    const raw = { rootfs: { ociImage: { tag: "docker.io/ubuntu:latest" } } };
    expect(parseConfig(raw)).toEqual({
      rootfs: { ociImage: { tag: "docker.io/ubuntu:latest" }, fsSize: 2048 },
    });
  });

  test("parses full config with all optional fields", () => {
    const raw = {
      rootfs: {
        ociImage: {
          containerfile: "./Containerfile",
          context: "./ctx",
          engine: "podman",
        },
        fsSize: 4096,
      },
      user: "myuser",
    };
    expect(parseConfig(raw)).toEqual({
      rootfs: {
        ociImage: {
          containerfile: "./Containerfile",
          context: "./ctx",
          engine: "podman",
        },
        fsSize: 4096,
      },
      user: "myuser",
    });
  });

  test("rejects invalid input", () => {
    expect(() => parseConfig("not an object")).toThrow();
    expect(() => parseConfig({ rootfs: { ociImage: {} } })).toThrow();
  });
});
