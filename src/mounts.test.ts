import { describe, expect, test } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
} from "@earendil-works/gondolin";
import { OverlayProvider } from "./overlay-provider.ts";

describe("resolveMounts", () => {
  test("resolves relative hostPath against configDir", () => {
    const result = resolveMounts(
      [{ hostPath: "..", mode: "readwrite" }],
      "/home/user/.tuor",
    );
    expect(result).toEqual([
      { hostPath: "/home/user", guestPath: "/home/user", mode: "readwrite" },
    ]);
  });

  test("preserves absolute hostPath", () => {
    const result = resolveMounts(
      [{ hostPath: "/opt/data", mode: "readwrite" }],
      "/home/user/.tuor",
    );
    expect(result).toEqual([
      { hostPath: "/opt/data", guestPath: "/opt/data", mode: "readwrite" },
    ]);
  });

  test("defaults guestPath to resolved absolute hostPath", () => {
    const result = resolveMounts(
      [{ hostPath: "../project", mode: "readonly" }],
      "/home/user/.tuor",
    );
    expect(result[0]!.guestPath).toBe("/home/user/project");
  });

  test("uses explicit guestPath as-is", () => {
    const result = resolveMounts(
      [{ hostPath: "/opt/data", guestPath: "/workspace", mode: "readonly" }],
      "/anywhere",
    );
    expect(result[0]!.guestPath).toBe("/workspace");
  });

  test("preserves mode from config", () => {
    const result = resolveMounts(
      [{ hostPath: "/opt/data", mode: "overlay" }],
      "/anywhere",
    );
    expect(result[0]!.mode).toBe("overlay");
  });

  test("returns empty array for empty input", () => {
    expect(resolveMounts([], "/anywhere")).toEqual([]);
  });
});

describe("validateMounts", () => {
  const validDeps: MountDeps = {
    pathExists: () => true,
    isDirectory: () => true,
  };

  test("passes for existing directories", () => {
    const mounts: ResolvedMount[] = [
      { hostPath: "/opt/data", guestPath: "/data", mode: "readwrite" },
    ];
    expect(() => validateMounts(mounts, validDeps)).not.toThrow();
  });

  test("throws when path does not exist", () => {
    const deps: MountDeps = {
      pathExists: () => false,
      isDirectory: () => true,
    };
    const mounts: ResolvedMount[] = [
      { hostPath: "/nonexistent", guestPath: "/data", mode: "readwrite" },
    ];
    expect(() => validateMounts(mounts, deps)).toThrow(
      "Mount host path does not exist: /nonexistent",
    );
  });

  test("throws when path is a file, not a directory", () => {
    const deps: MountDeps = {
      pathExists: () => true,
      isDirectory: () => false,
    };
    const mounts: ResolvedMount[] = [
      { hostPath: "/some/file.txt", guestPath: "/data", mode: "readwrite" },
    ];
    expect(() => validateMounts(mounts, deps)).toThrow(
      "Mount host path is not a directory: /some/file.txt",
    );
  });

  test("throws on duplicate guestPaths", () => {
    const mounts: ResolvedMount[] = [
      { hostPath: "/a", guestPath: "/data", mode: "readwrite" },
      { hostPath: "/b", guestPath: "/data", mode: "readwrite" },
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
      { hostPath: "/tmp", guestPath: "/data", mode: "readwrite" },
    ];
    const result = buildVfsMounts(mounts, "/cfg");
    expect(result["/data"]).toBeInstanceOf(RealFSProvider);
  });

  test("readonly mode creates ReadonlyProvider", () => {
    const mounts: ResolvedMount[] = [
      { hostPath: "/tmp", guestPath: "/data", mode: "readonly" },
    ];
    const result = buildVfsMounts(mounts, "/cfg");
    expect(result["/data"]).toBeInstanceOf(ReadonlyProvider);
  });

  test("overlay-tmpfs mode creates OverlayProvider", () => {
    const mounts: ResolvedMount[] = [
      { hostPath: "/tmp", guestPath: "/data", mode: "overlay-tmpfs" },
    ];
    const result = buildVfsMounts(mounts, "/cfg");
    expect(result["/data"]).toBeInstanceOf(OverlayProvider);
  });

  test("overlay mode creates OverlayProvider and state directory", () => {
    const configDir = mkdtempSync(`${tmpdir()}/tuor-test-`);
    try {
      const mounts: ResolvedMount[] = [
        { hostPath: "/tmp", guestPath: "/workspace", mode: "overlay" },
      ];
      const result = buildVfsMounts(mounts, configDir);
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
    };
    expect(prepareMounts([], "/anywhere", deps)).toEqual({});
  });
});
