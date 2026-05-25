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
  test("parses a fully-populated config with correct defaults", () => {
    const raw = {
      user: "dev",
      workdir: { hostPath: "/host/project", guestPath: "/workspace" },
      mounts: [
        { hostPath: "/data", guestPath: "/mnt/data", mode: "readwrite" },
        { hostPath: "../relative" },
      ],
      nix: {
        profiles: ["/nix/var/nix/profiles/default"],
        nixLd: true,
      },
    };
    const config = parseConfig(raw);
    expect(config).toEqual({
      user: "dev",
      workdir: {
        hostPath: "/host/project",
        guestPath: "/workspace",
        mode: "readonly",
      },
      mounts: [
        { hostPath: "/data", guestPath: "/mnt/data", mode: "readwrite" },
        { hostPath: "../relative", mode: "readonly" },
      ],
      nix: {
        profiles: ["/nix/var/nix/profiles/default"],
        nixLd: true,
      },
    });
  });

  test("fills in defaults for minimal config", () => {
    const config = parseConfig({});
    expect(config.user).toBe("root");
    expect(config.workdir).toBe("/");
    expect(config.mounts).toBeUndefined();
    expect(config.nix).toBeUndefined();
  });

  test("accepts workdir as absolute guest path string", () => {
    expect(parseConfig({ workdir: "/workspace" }).workdir).toBe("/workspace");
  });

  test.each([
    ["relative guestPath", { mounts: [{ hostPath: "/foo", guestPath: "rel" }] }],
    ["empty hostPath", { mounts: [{ hostPath: "" }] }],
    ["invalid mode", { mounts: [{ hostPath: "/x", mode: "bad" }] }],
    ["non-string hostPath", { mounts: [{ hostPath: 123 }] }],
    ["relative workdir string", { workdir: "relative" }],
    ["empty workdir string", { workdir: "" }],
    ["relative nix profile", { nix: { profiles: ["relative/path"] } }],
    ["non-object input", "not an object"],
  ])("rejects %s", (_label, raw) => {
    expect(() => parseConfig(raw)).toThrow();
  });
});
