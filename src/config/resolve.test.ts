import { describe, expect, test } from "vitest";
import { resolveConfig, _getOverlayStateDir, _resolveEnv, type ResolveDeps } from "./resolve.ts";
import type { TuorConfig } from "./schema.ts";
import type { IgnoreFileDeps } from "./ignore-files.ts";
import type { NixDeps } from "./nix.ts";

const noopIgnoreFileDeps: IgnoreFileDeps = {
  readFile: () => "",
  pathExists: () => false,
  walkFiles: () => [],
};

const validDeps: ResolveDeps = {
  mountValidation: {
    pathExists: () => true,
    isDirectory: () => true,
  },
  ignoreFile: noopIgnoreFileDeps,
  hostEnv: {},
  warn: () => {},
};

const HOST_HOME = "/home/hostuser";

function resolve(config: Partial<TuorConfig>, configDir = "/home/user/.tuor", deps = validDeps) {
  const full: TuorConfig = { user: "root", workdir: "/", ...config };
  return resolveConfig(full, configDir, HOST_HOME, deps);
}

describe("resolveConfig", () => {
  describe("mount resolution", () => {
    test("resolves relative hostPath against configDir", () => {
      const spec = resolve({
        mounts: [{ hostPath: "..", mode: "readwrite" }],
      });
      expect(spec.mounts[0]).toMatchObject({
        hostPath: "/home/user",
        guestPath: "/home/user",
        mode: "readwrite",
      });
    });

    test("preserves absolute hostPath", () => {
      const spec = resolve({
        mounts: [{ hostPath: "/opt/data", mode: "readwrite" }],
      });
      expect(spec.mounts[0]).toMatchObject({
        hostPath: "/opt/data",
        guestPath: "/opt/data",
      });
    });

    test("defaults guestPath to resolved absolute hostPath", () => {
      const spec = resolve({
        mounts: [{ hostPath: "../project", mode: "readonly" }],
      });
      expect(spec.mounts[0]!.guestPath).toBe("/home/user/project");
    });

    test("uses explicit guestPath as-is", () => {
      const spec = resolve({
        mounts: [{ hostPath: "/opt/data", guestPath: "/workspace", mode: "readonly" }],
      });
      expect(spec.mounts[0]!.guestPath).toBe("/workspace");
    });

    test("preserves mode from config", () => {
      const spec = resolve({
        mounts: [{ hostPath: "/opt/data", mode: "overlay" }],
      });
      expect(spec.mounts[0]!.mode).toBe("overlay");
    });

    test("returns empty mounts for no mount configs", () => {
      const spec = resolve({});
      expect(spec.mounts).toEqual([]);
    });

    test("expands ~ in hostPath using host home dir", () => {
      const spec = resolve(
        { mounts: [{ hostPath: "~/projects", mode: "readonly" }] },
        "/anywhere",
      );
      expect(spec.mounts[0]!.hostPath).toBe("/home/hostuser/projects");
    });

    test("expands ~ in guestPath using guest home dir", () => {
      const spec = resolve({
        user: "bob",
        mounts: [{ hostPath: "/opt/data", guestPath: "~/data", mode: "readonly" }],
      });
      expect(spec.mounts[0]!.guestPath).toBe("/home/bob/data");
    });

    test("expands bare ~ in guestPath to guest home dir", () => {
      const spec = resolve({
        mounts: [{ hostPath: "/opt/data", guestPath: "~", mode: "readonly" }],
      });
      expect(spec.mounts[0]!.guestPath).toBe("/root");
    });
  });

  describe("shadow patterns", () => {
    test("collects inline ignore patterns as root-scoped", () => {
      const spec = resolve({
        mounts: [{ hostPath: "/opt/data", mode: "readonly", ignore: [".env", ".git"] }],
      });
      expect(spec.mounts[0]!.shadowPatterns).toContainEqual({ pattern: ".env", scope: "/" });
      expect(spec.mounts[0]!.shadowPatterns).toContainEqual({ pattern: ".git", scope: "/" });
    });

    test("has empty shadowPatterns when no ignore config", () => {
      const spec = resolve({
        mounts: [{ hostPath: "/opt/data", mode: "readonly", ignoreFileRefs: [] }],
      });
      expect(spec.mounts[0]!.shadowPatterns).toEqual([]);
    });

    test("collects patterns from ignoreFileRefs", () => {
      const deps: ResolveDeps = {
        ...validDeps,
        ignoreFile: {
          readFile: (p) =>
            p === "/home/user/.tuor/tuorignore" ? "secret" : "",
          pathExists: (p) => p === "/home/user/.tuor/tuorignore",
          walkFiles: () => [],
        },
      };
      const spec = resolve(
        { mounts: [{ hostPath: "/opt/data", mode: "readonly", ignoreFileRefs: ["host:./tuorignore"] }] },
        "/home/user/.tuor",
        deps,
      );
      expect(spec.mounts[0]!.shadowPatterns).toContainEqual({ pattern: "secret", scope: "/" });
    });

    test("uses default ignoreFileRefs when not provided", () => {
      const deps: ResolveDeps = {
        ...validDeps,
        ignoreFile: {
          readFile: (p) =>
            p === "/cfg/tuorignore" ? "hidden" : "",
          pathExists: (p) => p === "/cfg/tuorignore",
          walkFiles: () => [],
        },
      };
      // Default ignoreFileRefs includes "host:./tuorignore"
      const spec = resolve(
        { mounts: [{ hostPath: "/opt/data", mode: "readonly" }] },
        "/cfg",
        deps,
      );
      expect(spec.mounts[0]!.shadowPatterns).toContainEqual({ pattern: "hidden", scope: "/" });
    });
  });

  describe("workdir resolution", () => {
    test("returns guestPath as-is for a string workdir", () => {
      const spec = resolve({ workdir: "/workspace" });
      expect(spec.workdir).toBe("/workspace");
    });

    test("does not produce a mount for a string workdir", () => {
      const spec = resolve({ workdir: "/workspace" });
      expect(spec.mounts).toEqual([]);
    });

    test("uses explicit guestPath from MountConfig workdir", () => {
      const spec = resolve({
        workdir: { hostPath: "/host/project", guestPath: "/guest/project", mode: "readonly" },
      });
      expect(spec.workdir).toBe("/guest/project");
    });

    test("defaults guestPath to resolved hostPath when not specified in workdir", () => {
      const spec = resolve({
        workdir: { hostPath: "../project", mode: "readonly" },
      });
      expect(spec.workdir).toBe("/home/user/project");
    });

    test("adds workdir mount to mounts", () => {
      const spec = resolve({
        workdir: { hostPath: "/host/project", guestPath: "/workspace", mode: "readonly" },
      });
      expect(spec.mounts).toHaveLength(1);
      expect(spec.mounts[0]).toMatchObject({
        hostPath: "/host/project",
        guestPath: "/workspace",
      });
    });

    test("expands ~ in string workdir using guest home dir", () => {
      const spec = resolve({ workdir: "~/workspace" });
      expect(spec.workdir).toBe("/root/workspace");
    });

    test("expands ~ in MountConfig workdir hostPath using host home dir", () => {
      const spec = resolve({
        workdir: { hostPath: "~/project", mode: "readonly" },
      });
      expect(spec.workdir).toBe("/home/hostuser/project");
    });

    test("expands ~ in MountConfig workdir guestPath using guest home dir", () => {
      const spec = resolve({
        user: "bob",
        workdir: { hostPath: "/host/project", guestPath: "~/project", mode: "readonly" },
      });
      expect(spec.workdir).toBe("/home/bob/project");
    });
  });

  describe("volume resolution", () => {
    test("resolves absolute guestPath as-is", () => {
      const spec = resolve({ volumes: [{ guestPath: "/cache" }] });
      expect(spec.volumes).toEqual([
        { guestPath: "/cache", stateDir: "/home/user/.tuor/.state/overlays/cache" },
      ]);
    });

    test("expands tilde in guestPath using guest home dir", () => {
      const spec = resolve({
        user: "bob",
        volumes: [{ guestPath: "~/data" }],
      });
      expect(spec.volumes![0]).toMatchObject({
        guestPath: "/home/bob/data",
      });
    });

    test("computes stateDir using _getOverlayStateDir", () => {
      const spec = resolve(
        { volumes: [{ guestPath: "/a/b/c" }] },
        "/cfg",
      );
      expect(spec.volumes![0]!.stateDir).toBe("/cfg/.state/overlays/a_b_c");
    });

    test("omits volumes when not configured", () => {
      const spec = resolve({});
      expect(spec.volumes).toBeUndefined();
    });

    test("resolves multiple volumes", () => {
      const spec = resolve({
        volumes: [{ guestPath: "/cache" }, { guestPath: "/data" }],
      });
      expect(spec.volumes).toHaveLength(2);
    });
  });

  describe("nix integration", () => {
    const nixDeps: NixDeps = {
      hostEnv: {},
      resolveProfiles: () => ["/nix/store/abc"],
      realpath: (p) => p,
      nixExists: () => true,
      lib64Exists: () => true,
      warn: () => {},
    };

    test("prepends nix mounts before user mounts", () => {
      const spec = resolve(
        {
          nix: { nixLd: false },
          mounts: [{ hostPath: "/opt/data", guestPath: "/data", mode: "readonly" }],
        },
        "/cfg",
        { ...validDeps, nix: nixDeps },
      );
      expect(spec.mounts[0]!.guestPath).toBe("/nix");
      expect(spec.mounts[1]!.guestPath).toBe("/data");
    });

    test("sets env from nix", () => {
      const spec = resolve(
        { nix: { nixLd: false } },
        "/cfg",
        { ...validDeps, nix: nixDeps },
      );
      expect(spec.env).toBeDefined();
      expect(spec.env!.PATH).toContain("/nix/store/abc/bin");
    });

    test("omits env when nix not configured", () => {
      const spec = resolve({});
      expect(spec.env).toBeUndefined();
    });
  });

  describe("network", () => {
    test("defaults to restricted with empty allowlists", () => {
      const spec = resolve({});
      expect(spec.network).toEqual({
        mode: "restricted",
        allowedHosts: [],
        allowedInternalHosts: [],
      });
    });

    test("passes through open network config", () => {
      const spec = resolve({ network: { mode: "open" } });
      expect(spec.network).toEqual({ mode: "open" });
    });

    test("passes through restricted network config and defaults allowedInternalHosts", () => {
      const spec = resolve({
        network: { mode: "restricted", allowedHosts: ["*.github.com"] },
      });
      expect(spec.network).toEqual({
        mode: "restricted",
        allowedHosts: ["*.github.com"],
        allowedInternalHosts: [],
      });
    });

    test("passes through allowedInternalHosts", () => {
      const spec = resolve({
        network: {
          mode: "restricted",
          allowedHosts: ["api.example.com"],
          allowedInternalHosts: ["litellm.corp.internal"],
        },
      });
      expect(spec.network).toEqual({
        mode: "restricted",
        allowedHosts: ["api.example.com"],
        allowedInternalHosts: ["litellm.corp.internal"],
      });
    });
  });

  describe("other fields", () => {
    test("passes through user", () => {
      const spec = resolve({ user: "dev" });
      expect(spec.user).toBe("dev");
    });

    test("passes through rootfsSize", () => {
      const spec = resolve({ rootfsSize: "2G" });
      expect(spec.rootfsSize).toBe("2G");
    });

    test("omits rootfsSize when not set", () => {
      const spec = resolve({});
      expect(spec.rootfsSize).toBeUndefined();
    });

    test("infers guestHomeDir from user for tilde expansion", () => {
      const spec = resolve({
        user: "alice",
        mounts: [{ hostPath: "/data", guestPath: "~/data", mode: "readonly" }],
      });
      expect(spec.mounts[0]!.guestPath).toBe("/home/alice/data");
    });

    test("uses explicit guestHomeDir override for tilde expansion", () => {
      const spec = resolve({
        user: "alice",
        guestHomeDir: "/custom/home",
        mounts: [{ hostPath: "/data", guestPath: "~/data", mode: "readonly" }],
      });
      expect(spec.mounts[0]!.guestPath).toBe("/custom/home/data");
    });
  });
});

describe("_resolveEnv", () => {
  test("passes through string values", () => {
    const { env } = _resolveEnv({ FOO: "bar" }, {}, () => {});
    expect(env).toEqual({ FOO: "bar" });
  });

  test("reads host var with fromHost: true using same key", () => {
    const { env } = _resolveEnv(
      { EDITOR: { fromHost: true } },
      { EDITOR: "vim" },
      () => {},
    );
    expect(env).toEqual({ EDITOR: "vim" });
  });

  test("reads host var with fromHost: string using different key", () => {
    const { env } = _resolveEnv(
      { DB_URL: { fromHost: "DATABASE_URL" } },
      { DATABASE_URL: "postgres://..." },
      () => {},
    );
    expect(env).toEqual({ DB_URL: "postgres://..." });
  });

  test("warns and skips when host var is missing", () => {
    const warnings: string[] = [];
    const { env } = _resolveEnv(
      { SECRET: { fromHost: true } },
      {},
      (msg) => warnings.push(msg),
    );
    expect(env).toEqual({});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("SECRET");
  });

  test("warns and skips when renamed host var is missing", () => {
    const warnings: string[] = [];
    const { env } = _resolveEnv(
      { MY_VAR: { fromHost: "NONEXISTENT" } },
      {},
      (msg) => warnings.push(msg),
    );
    expect(env).toEqual({});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("NONEXISTENT");
  });

  test("resolves mixed value types", () => {
    const { env } = _resolveEnv(
      { FIXED: "val", FROM_HOST: { fromHost: true }, RENAMED: { fromHost: "SRC" } },
      { FROM_HOST: "hostval", SRC: "srcval" },
      () => {},
    );
    expect(env).toEqual({ FIXED: "val", FROM_HOST: "hostval", RENAMED: "srcval" });
  });

  test("partitions secrets from regular env vars", () => {
    const { env, secrets } = _resolveEnv(
      {
        EDITOR: { fromHost: true },
        API_KEY: { secret: true, fromHost: true, hosts: ["api.example.com"] },
        FIXED: "value",
      },
      { EDITOR: "vim", API_KEY: "sk-123" },
      () => {},
    );
    expect(env).toEqual({ EDITOR: "vim", FIXED: "value" });
    expect(secrets).toEqual({
      API_KEY: { hosts: ["api.example.com"], value: "sk-123" },
    });
  });

  test("resolves secret with fromHost: string", () => {
    const { secrets } = _resolveEnv(
      { GH_TOKEN: { secret: true, fromHost: "GITHUB_TOKEN", hosts: ["*.github.com"] } },
      { GITHUB_TOKEN: "ghp_abc" },
      () => {},
    );
    expect(secrets).toEqual({
      GH_TOKEN: { hosts: ["*.github.com"], value: "ghp_abc" },
    });
  });

  test("warns and skips secret when host var is missing", () => {
    const warnings: string[] = [];
    const { secrets } = _resolveEnv(
      { API_KEY: { secret: true, fromHost: true, hosts: ["api.example.com"] } },
      {},
      (msg) => warnings.push(msg),
    );
    expect(secrets).toEqual({});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("API_KEY");
  });

  test("returns empty secrets when none configured", () => {
    const { secrets } = _resolveEnv({ FOO: "bar" }, {}, () => {});
    expect(secrets).toEqual({});
  });
});

describe("resolveConfig env integration", () => {
  test("omits env when not configured and no nix", () => {
    const spec = resolve({});
    expect(spec.env).toBeUndefined();
  });

  test("passes through user env to SessionSpec", () => {
    const spec = resolve(
      { env: { MY_VAR: "hello" } },
      "/cfg",
      { ...validDeps, hostEnv: {} },
    );
    expect(spec.env).toEqual({ MY_VAR: "hello" });
  });

  test("user env overrides nix env", () => {
    const nixDeps: NixDeps = {
      hostEnv: {},
      resolveProfiles: () => ["/nix/store/abc"],
      realpath: (p) => p,
      nixExists: () => true,
      lib64Exists: () => true,
      warn: () => {},
    };
    const spec = resolve(
      { nix: { nixLd: false }, env: { PATH: "/custom/bin" } },
      "/cfg",
      { ...validDeps, nix: nixDeps },
    );
    expect(spec.env!.PATH).toBe("/custom/bin");
  });

  test("nix env preserved when user env does not overlap", () => {
    const nixDeps: NixDeps = {
      hostEnv: {},
      resolveProfiles: () => ["/nix/store/abc"],
      realpath: (p) => p,
      nixExists: () => true,
      lib64Exists: () => true,
      warn: () => {},
    };
    const spec = resolve(
      { nix: { nixLd: false }, env: { MY_VAR: "hello" } },
      "/cfg",
      { ...validDeps, nix: nixDeps },
    );
    expect(spec.env!.PATH).toContain("/nix/store/abc/bin");
    expect(spec.env!.MY_VAR).toBe("hello");
  });

  test("resolves fromHost vars using deps.hostEnv", () => {
    const spec = resolve(
      { env: { EDITOR: { fromHost: true } } },
      "/cfg",
      { ...validDeps, hostEnv: { EDITOR: "vim" } },
    );
    expect(spec.env).toEqual({ EDITOR: "vim" });
  });

  test("partitions secrets into SessionSpec.secrets", () => {
    const spec = resolve(
      {
        env: {
          EDITOR: { fromHost: true },
          API_KEY: { secret: true, fromHost: true, hosts: ["api.example.com"] },
        },
      },
      "/cfg",
      { ...validDeps, hostEnv: { EDITOR: "vim", API_KEY: "sk-123" } },
    );
    expect(spec.env).toEqual({ EDITOR: "vim" });
    expect(spec.secrets).toEqual({
      API_KEY: { hosts: ["api.example.com"], value: "sk-123" },
    });
  });

  test("omits secrets when none configured", () => {
    const spec = resolve(
      { env: { MY_VAR: "hello" } },
      "/cfg",
    );
    expect(spec.secrets).toBeUndefined();
  });
});

describe("_getOverlayStateDir", () => {
  test("sanitizes guest path for use as directory name", () => {
    expect(_getOverlayStateDir("/home/user/.tuor", "/workspace/project")).toBe(
      "/home/user/.tuor/.state/overlays/workspace_project",
    );
  });

  test("handles root guest path", () => {
    expect(_getOverlayStateDir("/home/user/.tuor", "/")).toBe(
      "/home/user/.tuor/.state/overlays/_root",
    );
  });

  test("handles deeply nested guest path", () => {
    expect(_getOverlayStateDir("/cfg", "/a/b/c/d")).toBe(
      "/cfg/.state/overlays/a_b_c_d",
    );
  });

  test("handles single-segment guest path", () => {
    expect(_getOverlayStateDir("/cfg", "/data")).toBe(
      "/cfg/.state/overlays/data",
    );
  });
});
