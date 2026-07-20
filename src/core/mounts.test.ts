import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ReadonlyProvider,
  RealFSProvider,
  type VirtualProvider,
} from "@earendil-works/gondolin";
import { describe, expect, test } from "vitest";
import {
  buildVfsMounts,
  buildVfsVolumes,
  type MountSpec,
  type MountValidationDeps,
  type VolumeSpec,
  validateMounts,
} from "./mounts.ts";
import { OverlayProvider } from "./overlay-provider.ts";
import { OwnershipProvider } from "./ownership-provider.ts";

const OWNER = { uid: 0, gid: 0 };

/**
 * buildVfsMounts/buildVfsVolumes wrap every provider in an OwnershipProvider
 * (outermost). Reach past it to assert on the underlying mode-specific provider.
 */
function inner(provider: VirtualProvider | undefined): VirtualProvider {
  return (provider as unknown as { backend: VirtualProvider }).backend;
}

describe("validateMounts", () => {
  const validDeps: MountValidationDeps = {
    pathExists: () => true,
    isDirectory: () => true,
  };

  test("passes for existing directories", () => {
    const mounts: MountSpec[] = [
      {
        hostPath: "/opt/data",
        guestPath: "/data",
        mode: "readwrite",
        shadowPatterns: [],
        owner: OWNER,
      },
    ];
    expect(() => validateMounts(mounts, [], validDeps)).not.toThrow();
  });

  test("throws when path does not exist", () => {
    const deps: MountValidationDeps = {
      pathExists: () => false,
      isDirectory: () => true,
    };
    const mounts: MountSpec[] = [
      {
        hostPath: "/nonexistent",
        guestPath: "/data",
        mode: "readwrite",
        shadowPatterns: [],
        owner: OWNER,
      },
    ];
    expect(() => validateMounts(mounts, [], deps)).toThrow(
      "Mount host path does not exist: /nonexistent",
    );
  });

  test("throws when path is a file, not a directory", () => {
    const deps: MountValidationDeps = {
      pathExists: () => true,
      isDirectory: () => false,
    };
    const mounts: MountSpec[] = [
      {
        hostPath: "/some/file.txt",
        guestPath: "/data",
        mode: "readwrite",
        shadowPatterns: [],
        owner: OWNER,
      },
    ];
    expect(() => validateMounts(mounts, [], deps)).toThrow(
      "Mount host path is not a directory: /some/file.txt",
    );
  });

  test("throws on duplicate guestPaths", () => {
    const mounts: MountSpec[] = [
      {
        hostPath: "/a",
        guestPath: "/data",
        mode: "readwrite",
        shadowPatterns: [],
        owner: OWNER,
      },
      {
        hostPath: "/b",
        guestPath: "/data",
        mode: "readwrite",
        shadowPatterns: [],
        owner: OWNER,
      },
    ];
    expect(() => validateMounts(mounts, [], validDeps)).toThrow(
      "Duplicate guest mount path: /data",
    );
  });
});

describe("buildVfsMounts", () => {
  test("wraps every mount in an OwnershipProvider", () => {
    const mounts: MountSpec[] = [
      {
        hostPath: "/tmp",
        guestPath: "/data",
        mode: "readwrite",
        shadowPatterns: [],
        owner: OWNER,
      },
    ];
    const result = buildVfsMounts(mounts);
    expect(result["/data"]).toBeInstanceOf(OwnershipProvider);
  });

  test("readwrite mode wraps a RealFSProvider", () => {
    const mounts: MountSpec[] = [
      {
        hostPath: "/tmp",
        guestPath: "/data",
        mode: "readwrite",
        shadowPatterns: [],
        owner: OWNER,
      },
    ];
    const result = buildVfsMounts(mounts);
    expect(inner(result["/data"])).toBeInstanceOf(RealFSProvider);
  });

  test("readonly mode wraps a ReadonlyProvider", () => {
    const mounts: MountSpec[] = [
      {
        hostPath: "/tmp",
        guestPath: "/data",
        mode: "readonly",
        shadowPatterns: [],
        owner: OWNER,
      },
    ];
    const result = buildVfsMounts(mounts);
    expect(inner(result["/data"])).toBeInstanceOf(ReadonlyProvider);
  });

  test("overlay-tmpfs mode wraps an OverlayProvider", () => {
    const mounts: MountSpec[] = [
      {
        hostPath: "/tmp",
        guestPath: "/data",
        mode: "overlay-tmpfs",
        shadowPatterns: [],
        owner: OWNER,
      },
    ];
    const result = buildVfsMounts(mounts);
    expect(inner(result["/data"])).toBeInstanceOf(OverlayProvider);
  });

  test("presents the configured owner via stat", async () => {
    const hostDir = mkdtempSync(`${tmpdir()}/tuor-test-`);
    try {
      writeFileSync(join(hostDir, "file.txt"), "hello");
      const mounts: MountSpec[] = [
        {
          hostPath: hostDir,
          guestPath: "/data",
          mode: "readwrite",
          shadowPatterns: [],
          owner: { uid: 1234, gid: 5678 },
        },
      ];
      const provider = buildVfsMounts(mounts)["/data"]!;
      const stats = await provider.stat("/file.txt");
      expect(stats.uid).toBe(1234);
      expect(stats.gid).toBe(5678);
    } finally {
      rmSync(hostDir, { recursive: true });
    }
  });

  test("shadow patterns wrap backend with ShadowProvider, hiding specified files", async () => {
    const hostDir = mkdtempSync(`${tmpdir()}/tuor-test-`);
    try {
      writeFileSync(join(hostDir, "visible.txt"), "hello");
      writeFileSync(join(hostDir, ".env"), "SECRET=123");
      const mounts: MountSpec[] = [
        {
          hostPath: hostDir,
          guestPath: "/data",
          mode: "readonly",
          shadowPatterns: [{ pattern: ".env", scope: "/" }],
          owner: OWNER,
        },
      ];
      const result = buildVfsMounts(mounts);
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

  test("overlay mode wraps an OverlayProvider and creates the state directory", () => {
    const configDir = mkdtempSync(`${tmpdir()}/tuor-test-`);
    try {
      const stateDir = `${configDir}/.state/overlays/workspace`;
      const mounts: MountSpec[] = [
        {
          hostPath: "/tmp",
          guestPath: "/workspace",
          mode: "overlay",
          shadowPatterns: [],
          owner: OWNER,
          overlayStateDir: stateDir,
        },
      ];
      const result = buildVfsMounts(mounts);
      expect(inner(result["/workspace"])).toBeInstanceOf(OverlayProvider);
      expect(existsSync(stateDir)).toBe(true);
    } finally {
      rmSync(configDir, { recursive: true });
    }
  });

  test("overlay mode throws when overlayStateDir is missing", () => {
    const mounts: MountSpec[] = [
      {
        hostPath: "/tmp",
        guestPath: "/workspace",
        mode: "overlay",
        shadowPatterns: [],
        owner: OWNER,
      },
    ];
    expect(() => buildVfsMounts(mounts)).toThrow(/missing overlayStateDir/);
  });
});

describe("validateMounts with volumes", () => {
  const validDeps: MountValidationDeps = {
    pathExists: () => true,
    isDirectory: () => true,
  };

  test("passes when mount and volume guestPaths are distinct", () => {
    const mounts: MountSpec[] = [
      {
        hostPath: "/opt/data",
        guestPath: "/data",
        mode: "readwrite",
        shadowPatterns: [],
        owner: OWNER,
      },
    ];
    const volumes: VolumeSpec[] = [
      { guestPath: "/cache", stateDir: "/tmp/state/cache", owner: OWNER },
    ];
    expect(() => validateMounts(mounts, volumes, validDeps)).not.toThrow();
  });

  test("throws when volume guestPath collides with mount guestPath", () => {
    const mounts: MountSpec[] = [
      {
        hostPath: "/opt/data",
        guestPath: "/data",
        mode: "readwrite",
        shadowPatterns: [],
        owner: OWNER,
      },
    ];
    const volumes: VolumeSpec[] = [
      { guestPath: "/data", stateDir: "/tmp/state/data", owner: OWNER },
    ];
    expect(() => validateMounts(mounts, volumes, validDeps)).toThrow(
      "Duplicate guest mount path: /data",
    );
  });

  test("throws when two volumes have the same guestPath", () => {
    const volumes: VolumeSpec[] = [
      { guestPath: "/cache", stateDir: "/tmp/state/cache1", owner: OWNER },
      { guestPath: "/cache", stateDir: "/tmp/state/cache2", owner: OWNER },
    ];
    expect(() => validateMounts([], volumes, validDeps)).toThrow(
      "Duplicate guest mount path: /cache",
    );
  });
});

describe("buildVfsVolumes", () => {
  test("wraps a RealFSProvider (backed by the state directory) in ownership", () => {
    const stateDir = mkdtempSync(`${tmpdir()}/tuor-test-`);
    try {
      const volumes: VolumeSpec[] = [
        { guestPath: "/cache", stateDir, owner: OWNER },
      ];
      const result = buildVfsVolumes(volumes);
      expect(result["/cache"]).toBeInstanceOf(OwnershipProvider);
      expect(inner(result["/cache"])).toBeInstanceOf(RealFSProvider);
    } finally {
      rmSync(stateDir, { recursive: true });
    }
  });

  test("creates state directory if it does not exist", () => {
    const base = mkdtempSync(`${tmpdir()}/tuor-test-`);
    try {
      const stateDir = join(base, "nested", "volume");
      const volumes: VolumeSpec[] = [
        { guestPath: "/data", stateDir, owner: OWNER },
      ];
      buildVfsVolumes(volumes);
      expect(existsSync(stateDir)).toBe(true);
    } finally {
      rmSync(base, { recursive: true });
    }
  });

  test("returns empty object for empty volumes list", () => {
    expect(buildVfsVolumes([])).toEqual({});
  });
});
