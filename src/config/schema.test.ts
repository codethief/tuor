import { describe, expect, test } from "vitest";
import { findConfigDir, parseConfig } from "./schema.ts";


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
      network: { mode: "restricted", allowedHosts: ["*.github.com"] },
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
    expect(config).toMatchObject({
      user: "dev",
      network: { mode: "restricted", allowedHosts: ["*.github.com"] },
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
    expect(config.network).toBeUndefined();
    expect(config.mounts).toBeUndefined();
    expect(config.nix).toBeUndefined();
  });

  test("accepts workdir as absolute guest path string", () => {
    expect(parseConfig({ workdir: "/workspace" }).workdir).toBe("/workspace");
  });

  test("accepts workdir as tilde path string", () => {
    expect(parseConfig({ workdir: "~/workspace" }).workdir).toBe("~/workspace");
  });

  test("accepts tilde guestPath in mount", () => {
    const config = parseConfig({
      mounts: [{ hostPath: "/data", guestPath: "~/data" }],
    });
    expect(config.mounts![0]!.guestPath).toBe("~/data");
  });

  test("accepts tilde hostPath in mount", () => {
    const config = parseConfig({
      mounts: [{ hostPath: "~/projects" }],
    });
    expect(config.mounts![0]!.hostPath).toBe("~/projects");
  });

  test("accepts guestHomeDir override", () => {
    const config = parseConfig({ guestHomeDir: "/custom/home" });
    expect(config.guestHomeDir).toBe("/custom/home");
  });

  test("omits guestHomeDir when not specified", () => {
    const config = parseConfig({});
    expect(config.guestHomeDir).toBeUndefined();
  });

  test("parses mount with ignore list", () => {
    const config = parseConfig({
      mounts: [{ hostPath: "/data", ignore: [".env", ".git"] }],
    });
    expect(config.mounts![0]!.ignore).toEqual([".env", ".git"]);
  });

  test("omits ignore when not specified", () => {
    const config = parseConfig({
      mounts: [{ hostPath: "/data" }],
    });
    expect(config.mounts![0]).not.toHaveProperty("ignore");
  });

  test("accepts explicit ignoreFileRefs", () => {
    const config = parseConfig({
      mounts: [{ hostPath: "/data", ignoreFileRefs: ["host:custom", "mount:.myignore"] }],
    });
    expect(config.mounts![0]!.ignoreFileRefs).toEqual(["host:custom", "mount:.myignore"]);
  });

  test("omits ignoreFileRefs when not specified", () => {
    const config = parseConfig({
      mounts: [{ hostPath: "/data" }],
    });
    expect(config.mounts![0]).not.toHaveProperty("ignoreFileRefs");
  });

  test("accepts env with string values", () => {
    const config = parseConfig({ env: { MY_VAR: "hello" } });
    expect(config.env).toEqual({ MY_VAR: "hello" });
  });

  test("accepts env with fromHost: true", () => {
    const config = parseConfig({ env: { EDITOR: { fromHost: true } } });
    expect(config.env).toEqual({ EDITOR: { fromHost: true } });
  });

  test("accepts env with fromHost: string", () => {
    const config = parseConfig({ env: { DB_URL: { fromHost: "DATABASE_URL" } } });
    expect(config.env).toEqual({ DB_URL: { fromHost: "DATABASE_URL" } });
  });

  test("accepts env with mixed value types", () => {
    const config = parseConfig({
      env: { FIXED: "value", FROM_HOST: { fromHost: true }, RENAMED: { fromHost: "OTHER" } },
    });
    expect(config.env).toEqual({
      FIXED: "value",
      FROM_HOST: { fromHost: true },
      RENAMED: { fromHost: "OTHER" },
    });
  });

  test("accepts env with secret (fromHost: true)", () => {
    const config = parseConfig({
      env: { API_KEY: { secret: true, fromHost: true, hosts: ["api.example.com"] } },
    });
    expect(config.env).toEqual({
      API_KEY: { secret: true, fromHost: true, hosts: ["api.example.com"] },
    });
  });

  test("accepts env with secret (fromHost: string)", () => {
    const config = parseConfig({
      env: { GH_TOKEN: { secret: true, fromHost: "GITHUB_TOKEN", hosts: ["*.github.com"] } },
    });
    expect(config.env).toEqual({
      GH_TOKEN: { secret: true, fromHost: "GITHUB_TOKEN", hosts: ["*.github.com"] },
    });
  });

  test("accepts env mixing literals, fromHost, and secrets", () => {
    const config = parseConfig({
      env: {
        FIXED: "value",
        EDITOR: { fromHost: true },
        API_KEY: { secret: true, fromHost: true, hosts: ["api.example.com"] },
      },
    });
    expect(config.env).toEqual({
      FIXED: "value",
      EDITOR: { fromHost: true },
      API_KEY: { secret: true, fromHost: true, hosts: ["api.example.com"] },
    });
  });

  test("omits env when not specified", () => {
    const config = parseConfig({});
    expect(config.env).toBeUndefined();
  });

  describe("network config", () => {
    test("accepts open mode", () => {
      const config = parseConfig({ network: { mode: "open" } });
      expect(config.network).toEqual({ mode: "open" });
    });

    test("accepts restricted mode with allowedHosts", () => {
      const config = parseConfig({
        network: { mode: "restricted", allowedHosts: ["*.github.com", "api.anthropic.com"] },
      });
      expect(config.network).toEqual({
        mode: "restricted",
        allowedHosts: ["*.github.com", "api.anthropic.com"],
      });
    });

    test("accepts restricted mode with empty allowedHosts (block all)", () => {
      const config = parseConfig({
        network: { mode: "restricted", allowedHosts: [] },
      });
      expect(config.network).toEqual({ mode: "restricted", allowedHosts: [] });
    });

    test("accepts restricted mode with allowedInternalHosts", () => {
      const config = parseConfig({
        network: {
          mode: "restricted",
          allowedHosts: ["api.example.com"],
          allowedInternalHosts: ["litellm.corp.internal"],
        },
      });
      expect(config.network).toEqual({
        mode: "restricted",
        allowedHosts: ["api.example.com"],
        allowedInternalHosts: ["litellm.corp.internal"],
      });
    });

    test("omits allowedInternalHosts when not specified", () => {
      const config = parseConfig({
        network: { mode: "restricted", allowedHosts: [] },
      });
      expect(config.network).not.toHaveProperty("allowedInternalHosts");
    });

    test("accepts restricted mode without allowedHosts", () => {
      const config = parseConfig({ network: { mode: "restricted" } });
      expect(config.network).toEqual({ mode: "restricted" });
    });

    test("rejects unknown network mode", () => {
      expect(() => parseConfig({ network: { mode: "custom" } })).toThrow();
    });
  });

  describe("volumes config", () => {
    test("accepts volumes with absolute guestPath", () => {
      const config = parseConfig({
        volumes: [{ guestPath: "/cache" }],
      });
      expect(config.volumes).toEqual([{ guestPath: "/cache" }]);
    });

    test("accepts volumes with tilde guestPath", () => {
      const config = parseConfig({
        volumes: [{ guestPath: "~/data" }],
      });
      expect(config.volumes![0]!.guestPath).toBe("~/data");
    });

    test("omits volumes when not specified", () => {
      const config = parseConfig({});
      expect(config.volumes).toBeUndefined();
    });

    test("accepts multiple volumes", () => {
      const config = parseConfig({
        volumes: [{ guestPath: "/cache" }, { guestPath: "/data" }],
      });
      expect(config.volumes).toHaveLength(2);
    });
  });

  test.each([
    ["relative guestPath", { mounts: [{ hostPath: "/foo", guestPath: "rel" }] }],
    ["empty hostPath", { mounts: [{ hostPath: "" }] }],
    ["invalid mode", { mounts: [{ hostPath: "/x", mode: "bad" }] }],
    ["non-string hostPath", { mounts: [{ hostPath: 123 }] }],
    ["relative workdir string", { workdir: "relative" }],
    ["empty workdir string", { workdir: "" }],
    ["relative nix profile", { nix: { profiles: ["relative/path"] } }],
    ["volume with relative guestPath", { volumes: [{ guestPath: "relative" }] }],
    ["volume with unknown field", { volumes: [{ guestPath: "/x", hostPath: "/y" }] }],
    ["non-object input", "not an object"],
    ["empty ignore array", { mounts: [{ hostPath: "/x", ignore: [] }] }],
    ["env with fromHost: number", { env: { X: { fromHost: 123 } } }],
    ["env with fromHost: empty string", { env: { X: { fromHost: "" } } }],
    ["env with unknown source key", { env: { X: { badKey: true } } }],
    ["secret without hosts", { env: { X: { secret: true, fromHost: true } } }],
    ["secret with empty hosts", { env: { X: { secret: true, fromHost: true, hosts: [] } } }],
    ["secret without fromHost", { env: { X: { secret: true, hosts: ["h"] } } }],
  ])("rejects %s", (_label, raw) => {
    expect(() => parseConfig(raw)).toThrow();
  });
});
