import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReadonlyProvider, RealFSProvider } from "@earendil-works/gondolin";
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
      },
      {
        hostPath: "/b",
        guestPath: "/data",
        mode: "readwrite",
        shadowPatterns: [],
      },
    ];
    expect(() => validateMounts(mounts, [], validDeps)).toThrow(
      "Duplicate guest mount path: /data",
    );
  });
});

describe("buildVfsMounts", () => {
  test("readwrite mode creates RealFSProvider", () => {
    const mounts: MountSpec[] = [
      {
        hostPath: "/tmp",
        guestPath: "/data",
        mode: "readwrite",
        shadowPatterns: [],
      },
    ];
    const result = buildVfsMounts(mounts);
    expect(result["/data"]).toBeInstanceOf(RealFSProvider);
  });

  test("readonly mode creates ReadonlyProvider", () => {
    const mounts: MountSpec[] = [
      {
        hostPath: "/tmp",
        guestPath: "/data",
        mode: "readonly",
        shadowPatterns: [],
      },
    ];
    const result = buildVfsMounts(mounts);
    expect(result["/data"]).toBeInstanceOf(ReadonlyProvider);
  });

  test("overlay-tmpfs mode creates OverlayProvider", () => {
    const mounts: MountSpec[] = [
      {
        hostPath: "/tmp",
        guestPath: "/data",
        mode: "overlay-tmpfs",
        shadowPatterns: [],
      },
    ];
    const result = buildVfsMounts(mounts);
    expect(result["/data"]).toBeInstanceOf(OverlayProvider);
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

  test("no shadow patterns does not wrap with ShadowProvider", () => {
    const mounts: MountSpec[] = [
      {
        hostPath: "/tmp",
        guestPath: "/data",
        mode: "readwrite",
        shadowPatterns: [],
      },
    ];
    const result = buildVfsMounts(mounts);
    expect(result["/data"]).toBeInstanceOf(RealFSProvider);
  });

  test("overlay mode creates OverlayProvider and state directory", () => {
    const configDir = mkdtempSync(`${tmpdir()}/tuor-test-`);
    try {
      const stateDir = `${configDir}/.state/overlays/workspace`;
      const mounts: MountSpec[] = [
        {
          hostPath: "/tmp",
          guestPath: "/workspace",
          mode: "overlay",
          shadowPatterns: [],
          overlayStateDir: stateDir,
        },
      ];
      const result = buildVfsMounts(mounts);
      expect(result["/workspace"]).toBeInstanceOf(OverlayProvider);
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
      },
    ];
    const volumes: VolumeSpec[] = [
      { guestPath: "/cache", stateDir: "/tmp/state/cache" },
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
      },
    ];
    const volumes: VolumeSpec[] = [
      { guestPath: "/data", stateDir: "/tmp/state/data" },
    ];
    expect(() => validateMounts(mounts, volumes, validDeps)).toThrow(
      "Duplicate guest mount path: /data",
    );
  });

  test("throws when two volumes have the same guestPath", () => {
    const volumes: VolumeSpec[] = [
      { guestPath: "/cache", stateDir: "/tmp/state/cache1" },
      { guestPath: "/cache", stateDir: "/tmp/state/cache2" },
    ];
    expect(() => validateMounts([], volumes, validDeps)).toThrow(
      "Duplicate guest mount path: /cache",
    );
  });
});

describe("buildVfsVolumes", () => {
  test("creates RealFSProvider backed by state directory", () => {
    const stateDir = mkdtempSync(`${tmpdir()}/tuor-test-`);
    try {
      const volumes: VolumeSpec[] = [{ guestPath: "/cache", stateDir }];
      const result = buildVfsVolumes(volumes);
      expect(result["/cache"]).toBeInstanceOf(RealFSProvider);
    } finally {
      rmSync(stateDir, { recursive: true });
    }
  });

  test("creates state directory if it does not exist", () => {
    const base = mkdtempSync(`${tmpdir()}/tuor-test-`);
    try {
      const stateDir = join(base, "nested", "volume");
      const volumes: VolumeSpec[] = [{ guestPath: "/data", stateDir }];
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
