import { describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  resolveMounts,
  validateMounts,
  buildVfsMounts,
  getOverlayStateDir,
  prepareMounts,
  type ResolvedMount,
  type MountDeps,
} from "./mounts.ts";
import {
  RealFSProvider,
  ReadonlyProvider,
  ShadowProvider,
} from "@earendil-works/gondolin";
import { OverlayProvider } from "./overlay-provider.ts";
import type { IgnoreFileDeps } from "./ignore-file.ts";

const noopIgnoreFileDeps: IgnoreFileDeps = {
  readFile: () => "",
  pathExists: () => false,
  walkFiles: () => [],
};

// Shorthand: most tests don't care about tilde expansion so we pass dummy home dirs
const HOST_HOME = "/home/hostuser";
const GUEST_HOME = "/home/guestuser";

describe("resolveMounts", () => {
  test("resolves relative hostPath against configDir", () => {
    const result = resolveMounts(
      [{ hostPath: "..", mode: "readwrite" }],
      "/home/user/.tuor",
      HOST_HOME,
      GUEST_HOME,
    );
    expect(result).toMatchObject([
      { hostPath: "/home/user", guestPath: "/home/user", mode: "readwrite" },
    ]);
  });

  test("preserves absolute hostPath", () => {
    const result = resolveMounts(
      [{ hostPath: "/opt/data", mode: "readwrite" }],
      "/home/user/.tuor",
      HOST_HOME,
      GUEST_HOME,
    );
    expect(result).toMatchObject([
      { hostPath: "/opt/data", guestPath: "/opt/data", mode: "readwrite" },
    ]);
  });

  test("defaults guestPath to resolved absolute hostPath", () => {
    const result = resolveMounts(
      [{ hostPath: "../project", mode: "readonly" }],
      "/home/user/.tuor",
      HOST_HOME,
      GUEST_HOME,
    );
    expect(result[0]!.guestPath).toBe("/home/user/project");
  });

  test("uses explicit guestPath as-is", () => {
    const result = resolveMounts(
      [{ hostPath: "/opt/data", guestPath: "/workspace", mode: "readonly" }],
      "/anywhere",
      HOST_HOME,
      GUEST_HOME,
    );
    expect(result[0]!.guestPath).toBe("/workspace");
  });

  test("preserves mode from config", () => {
    const result = resolveMounts(
      [{ hostPath: "/opt/data", mode: "overlay" }],
      "/anywhere",
      HOST_HOME,
      GUEST_HOME,
    );
    expect(result[0]!.mode).toBe("overlay");
  });

  test("returns empty array for empty input", () => {
    expect(resolveMounts([], "/anywhere", HOST_HOME, GUEST_HOME)).toEqual([]);
  });

  test("preserves ignore list when present", () => {
    const result = resolveMounts(
      [{ hostPath: "/opt/data", mode: "readonly", ignore: [".env", ".git"] }],
      "/anywhere",
      HOST_HOME,
      GUEST_HOME,
    );
    expect(result[0]!.ignore).toEqual([".env", ".git"]);
  });

  test("omits ignore when not present in config", () => {
    const result = resolveMounts(
      [{ hostPath: "/opt/data", mode: "readonly" }],
      "/anywhere",
      HOST_HOME,
      GUEST_HOME,
    );
    expect(result[0]).not.toHaveProperty("ignore");
  });

  test("defaults ignoreFileRefs when not provided", () => {
    const result = resolveMounts(
      [{ hostPath: "/opt/data", mode: "readonly" }],
      "/anywhere",
      HOST_HOME,
      GUEST_HOME,
    );
    expect(result[0]!.ignoreFileRefs).toEqual([
      "host:./tuorignore",
      "mount:.tuorignore",
    ]);
  });

  test("uses explicit ignoreFileRefs when provided", () => {
    const result = resolveMounts(
      [{ hostPath: "/opt/data", mode: "readonly", ignoreFileRefs: ["host:custom"] }],
      "/anywhere",
      HOST_HOME,
      GUEST_HOME,
    );
    expect(result[0]!.ignoreFileRefs).toEqual(["host:custom"]);
  });

  test("expands ~ in hostPath using host home dir", () => {
    const result = resolveMounts(
      [{ hostPath: "~/projects", mode: "readonly" }],
      "/anywhere",
      "/home/alice",
      GUEST_HOME,
    );
    expect(result[0]!.hostPath).toBe("/home/alice/projects");
  });

  test("expands ~ in guestPath using guest home dir", () => {
    const result = resolveMounts(
      [{ hostPath: "/opt/data", guestPath: "~/data", mode: "readonly" }],
      "/anywhere",
      HOST_HOME,
      "/home/bob",
    );
    expect(result[0]!.guestPath).toBe("/home/bob/data");
  });

  test("expands bare ~ in guestPath to guest home dir", () => {
    const result = resolveMounts(
      [{ hostPath: "/opt/data", guestPath: "~", mode: "readonly" }],
      "/anywhere",
      HOST_HOME,
      "/root",
    );
    expect(result[0]!.guestPath).toBe("/root");
  });
});

describe("validateMounts", () => {
  const validDeps: MountDeps = {
    pathExists: () => true,
    isDirectory: () => true,
    ignoreFile: noopIgnoreFileDeps,
  };

  test("passes for existing directories", () => {
    const mounts: ResolvedMount[] = [
      { hostPath: "/opt/data", guestPath: "/data", mode: "readwrite", ignoreFileRefs: [] },
    ];
    expect(() => validateMounts(mounts, validDeps)).not.toThrow();
  });

  test("throws when path does not exist", () => {
    const deps: MountDeps = {
      pathExists: () => false,
      isDirectory: () => true,
      ignoreFile: noopIgnoreFileDeps,
    };
    const mounts: ResolvedMount[] = [
      { hostPath: "/nonexistent", guestPath: "/data", mode: "readwrite", ignoreFileRefs: [] },
    ];
    expect(() => validateMounts(mounts, deps)).toThrow(
      "Mount host path does not exist: /nonexistent",
    );
  });

  test("throws when path is a file, not a directory", () => {
    const deps: MountDeps = {
      pathExists: () => true,
      isDirectory: () => false,
      ignoreFile: noopIgnoreFileDeps,
    };
    const mounts: ResolvedMount[] = [
      { hostPath: "/some/file.txt", guestPath: "/data", mode: "readwrite", ignoreFileRefs: [] },
    ];
    expect(() => validateMounts(mounts, deps)).toThrow(
      "Mount host path is not a directory: /some/file.txt",
    );
  });

  test("throws on duplicate guestPaths", () => {
    const mounts: ResolvedMount[] = [
      { hostPath: "/a", guestPath: "/data", mode: "readwrite", ignoreFileRefs: [] },
      { hostPath: "/b", guestPath: "/data", mode: "readwrite", ignoreFileRefs: [] },
    ];
    expect(() => validateMounts(mounts, validDeps)).toThrow(
      "Duplicate guest mount path: /data",
    );
  });
});

describe("getOverlayStateDir", () => {
  test("sanitizes guest path for use as directory name", () => {
    expect(getOverlayStateDir("/home/user/.tuor", "/workspace/project")).toBe(
      "/home/user/.tuor/.state/overlays/workspace_project",
    );
  });

  test("handles root guest path", () => {
    expect(getOverlayStateDir("/home/user/.tuor", "/")).toBe(
      "/home/user/.tuor/.state/overlays/_root",
    );
  });

  test("handles deeply nested guest path", () => {
    expect(getOverlayStateDir("/cfg", "/a/b/c/d")).toBe(
      "/cfg/.state/overlays/a_b_c_d",
    );
  });

  test("handles single-segment guest path", () => {
    expect(getOverlayStateDir("/cfg", "/data")).toBe(
      "/cfg/.state/overlays/data",
    );
  });
});

describe("buildVfsMounts", () => {
  test("readwrite mode creates RealFSProvider", () => {
    const mounts: ResolvedMount[] = [
      { hostPath: "/tmp", guestPath: "/data", mode: "readwrite", ignoreFileRefs: [] },
    ];
    const result = buildVfsMounts(mounts, "/cfg", noopIgnoreFileDeps);
    expect(result["/data"]).toBeInstanceOf(RealFSProvider);
  });

  test("readonly mode creates ReadonlyProvider", () => {
    const mounts: ResolvedMount[] = [
      { hostPath: "/tmp", guestPath: "/data", mode: "readonly", ignoreFileRefs: [] },
    ];
    const result = buildVfsMounts(mounts, "/cfg", noopIgnoreFileDeps);
    expect(result["/data"]).toBeInstanceOf(ReadonlyProvider);
  });

  test("overlay-tmpfs mode creates OverlayProvider", () => {
    const mounts: ResolvedMount[] = [
      { hostPath: "/tmp", guestPath: "/data", mode: "overlay-tmpfs", ignoreFileRefs: [] },
    ];
    const result = buildVfsMounts(mounts, "/cfg", noopIgnoreFileDeps);
    expect(result["/data"]).toBeInstanceOf(OverlayProvider);
  });

  test("ignore wraps backend with ShadowProvider, hiding specified files", async () => {
    const hostDir = mkdtempSync(`${tmpdir()}/tuor-test-`);
    try {
      writeFileSync(join(hostDir, "visible.txt"), "hello");
      writeFileSync(join(hostDir, ".env"), "SECRET=123");
      const mounts: ResolvedMount[] = [
        { hostPath: hostDir, guestPath: "/data", mode: "readonly", ignore: [".env"], ignoreFileRefs: [] },
      ];
      const result = buildVfsMounts(mounts, "/cfg", noopIgnoreFileDeps);
      const provider = result["/data"]!;

      await expect(provider.stat("/visible.txt")).resolves.toBeDefined();
      await expect(provider.stat("/.env")).rejects.toThrow(/ENOENT|ERRNO_2/);

      const entries = await provider.readdir("/");
      const names = entries.map((e: string | { name: string }) =>
        typeof e === "string" ? e : e.name,
      );
      expect(names).toContain("visible.txt");
      expect(names).not.toContain(".env");
    } finally {
      rmSync(hostDir, { recursive: true });
    }
  });

  test("no ignore does not wrap with ShadowProvider", () => {
    const mounts: ResolvedMount[] = [
      { hostPath: "/tmp", guestPath: "/data", mode: "readwrite", ignoreFileRefs: [] },
    ];
    const result = buildVfsMounts(mounts, "/cfg", noopIgnoreFileDeps);
    expect(result["/data"]).toBeInstanceOf(RealFSProvider);
  });

  test("overlay mode creates OverlayProvider and state directory", () => {
    const configDir = mkdtempSync(`${tmpdir()}/tuor-test-`);
    try {
      const mounts: ResolvedMount[] = [
        { hostPath: "/tmp", guestPath: "/workspace", mode: "overlay", ignoreFileRefs: [] },
      ];
      const result = buildVfsMounts(mounts, configDir, noopIgnoreFileDeps);
      expect(result["/workspace"]).toBeInstanceOf(OverlayProvider);
      expect(existsSync(`${configDir}/.state/overlays/workspace`)).toBe(true);
    } finally {
      rmSync(configDir, { recursive: true });
    }
  });
});

describe("prepareMounts", () => {
  test("returns empty record for empty mounts array", () => {
    const deps: MountDeps = {
      pathExists: () => true,
      isDirectory: () => true,
      ignoreFile: noopIgnoreFileDeps,
    };
    expect(prepareMounts([], "/anywhere", HOST_HOME, GUEST_HOME, deps)).toEqual({});
  });
});
