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
  test("parses minimal config (all defaults)", () => {
    const raw = {};
    expect(parseConfig(raw)).toEqual({
      user: "root",
      workdir: "/",
    });
  });

  test("parses config with user", () => {
    const raw = { user: "myuser" };
    expect(parseConfig(raw)).toEqual({
      user: "myuser",
      workdir: "/",
    });
  });

  test("parses mounts with all fields", () => {
    const raw = {
      mounts: [
        {
          hostPath: "/home/user/project",
          guestPath: "/workspace",
          mode: "readwrite",
        },
      ],
    };
    expect(parseConfig(raw)).toEqual({
      user: "root",
      mounts: [
        {
          hostPath: "/home/user/project",
          guestPath: "/workspace",
          mode: "readwrite",
        },
      ],
      workdir: "/",
    });
  });

  test("parses mounts with hostPath only, mode defaults to readonly", () => {
    const raw = {
      mounts: [{ hostPath: "../myproject" }],
    };
    expect(parseConfig(raw)).toEqual({
      user: "root",
      mounts: [{ hostPath: "../myproject", mode: "readonly" }],
      workdir: "/",
    });
  });

  test("parses mounts with overlay mode", () => {
    const raw = {
      mounts: [{ hostPath: "/data", mode: "overlay" }],
    };
    expect(parseConfig(raw)).toEqual({
      user: "root",
      mounts: [{ hostPath: "/data", mode: "overlay" }],
      workdir: "/",
    });
  });

  test("parses mounts with overlay-tmpfs mode", () => {
    const raw = {
      mounts: [{ hostPath: "/data", mode: "overlay-tmpfs" }],
    };
    expect(parseConfig(raw)).toEqual({
      user: "root",
      mounts: [{ hostPath: "/data", mode: "overlay-tmpfs" }],
      workdir: "/",
    });
  });

  test("rejects mounts with invalid mode", () => {
    const raw = {
      mounts: [{ hostPath: "/data", mode: "invalid" }],
    };
    expect(() => parseConfig(raw)).toThrow();
  });

  test("rejects mounts with relative guestPath", () => {
    const raw = {
      mounts: [{ hostPath: "/foo", guestPath: "relative/path" }],
    };
    expect(() => parseConfig(raw)).toThrow();
  });

  test("rejects mounts with empty hostPath", () => {
    const raw = {
      mounts: [{ hostPath: "" }],
    };
    expect(() => parseConfig(raw)).toThrow();
  });

  test("rejects mounts with non-string hostPath", () => {
    const raw = {
      mounts: [{ hostPath: 123 }],
    };
    expect(() => parseConfig(raw)).toThrow();
  });

  test("rejects invalid input", () => {
    expect(() => parseConfig("not an object")).toThrow();
  });

  test("parses workdir as absolute guest path string", () => {
    const raw = {
      workdir: "/workspace",
    };
    expect(parseConfig(raw)).toEqual({
      user: "root",
      workdir: "/workspace",
    });
  });

  test("parses workdir as MountConfig with hostPath only", () => {
    const raw = {
      workdir: { hostPath: "/host/project" },
    };
    expect(parseConfig(raw)).toEqual({
      user: "root",
      workdir: { hostPath: "/host/project", mode: "readonly" },
    });
  });

  test("parses workdir as MountConfig with guestPath", () => {
    const raw = {
      workdir: { hostPath: "/host/project", guestPath: "/workspace" },
    };
    expect(parseConfig(raw)).toEqual({
      user: "root",
      workdir: {
        hostPath: "/host/project",
        guestPath: "/workspace",
        mode: "readonly",
      },
    });
  });

  test("rejects workdir with non-absolute guest path string", () => {
    const raw = {
      workdir: "relative/path",
    };
    expect(() => parseConfig(raw)).toThrow();
  });

  test("rejects workdir with empty string", () => {
    const raw = {
      workdir: "",
    };
    expect(() => parseConfig(raw)).toThrow();
  });

  test("parses nix config with profiles", () => {
    const raw = {
      nix: { profiles: ["/nix/var/nix/profiles/default", "/nix/store/abc-env"] },
    };
    expect(parseConfig(raw)).toEqual({
      user: "root",
      workdir: "/",
      nix: {
        profiles: ["/nix/var/nix/profiles/default", "/nix/store/abc-env"],
        nixLd: false,
      },
    });
  });

  test("parses nix config with nixLd", () => {
    const raw = { nix: { nixLd: true } };
    expect(parseConfig(raw)).toEqual({
      user: "root",
      workdir: "/",
      nix: { nixLd: true },
    });
  });

  test("accepts nix profile paths outside /nix/ (validated at runtime via symlink resolution)", () => {
    const raw = { nix: { profiles: ["/run/current-system/sw"] } };
    expect(parseConfig(raw)).toEqual({
      user: "root",
      workdir: "/",
      nix: { profiles: ["/run/current-system/sw"], nixLd: false },
    });
  });

  test("rejects nix profile with relative path", () => {
    const raw = { nix: { profiles: ["relative/path"] } };
    expect(() => parseConfig(raw)).toThrow();
  });
});
