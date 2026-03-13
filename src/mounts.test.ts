import { describe, expect, test } from "vitest";
import {
  resolveMounts,
  validateMounts,
  prepareMounts,
  type ResolvedMount,
  type MountDeps,
} from "./mounts.ts";

describe("resolveMounts", () => {
  test("resolves relative hostPath against configDir", () => {
    const result = resolveMounts(
      [{ hostPath: "..", readOnly: false }],
      "/home/user/.tuor",
    );
    expect(result).toEqual([
      { hostPath: "/home/user", guestPath: "/home/user", readOnly: false },
    ]);
  });

  test("preserves absolute hostPath", () => {
    const result = resolveMounts(
      [{ hostPath: "/opt/data", readOnly: false }],
      "/home/user/.tuor",
    );
    expect(result).toEqual([
      { hostPath: "/opt/data", guestPath: "/opt/data", readOnly: false },
    ]);
  });

  test("defaults guestPath to resolved absolute hostPath", () => {
    const result = resolveMounts(
      [{ hostPath: "../project", readOnly: false }],
      "/home/user/.tuor",
    );
    expect(result[0]!.guestPath).toBe("/home/user/project");
  });

  test("uses explicit guestPath as-is", () => {
    const result = resolveMounts(
      [{ hostPath: "/opt/data", guestPath: "/workspace", readOnly: false }],
      "/anywhere",
    );
    expect(result[0]!.guestPath).toBe("/workspace");
  });

  test("preserves readOnly from config", () => {
    const result = resolveMounts(
      [{ hostPath: "/opt/data", readOnly: true }],
      "/anywhere",
    );
    expect(result[0]!.readOnly).toBe(true);
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
      { hostPath: "/opt/data", guestPath: "/data", readOnly: false },
    ];
    expect(() => validateMounts(mounts, validDeps)).not.toThrow();
  });

  test("throws when path does not exist", () => {
    const deps: MountDeps = {
      pathExists: () => false,
      isDirectory: () => true,
    };
    const mounts: ResolvedMount[] = [
      { hostPath: "/nonexistent", guestPath: "/data", readOnly: false },
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
      { hostPath: "/some/file.txt", guestPath: "/data", readOnly: false },
    ];
    expect(() => validateMounts(mounts, deps)).toThrow(
      "Mount host path is not a directory: /some/file.txt",
    );
  });

  test("throws on duplicate guestPaths", () => {
    const mounts: ResolvedMount[] = [
      { hostPath: "/a", guestPath: "/data", readOnly: false },
      { hostPath: "/b", guestPath: "/data", readOnly: false },
    ];
    expect(() => validateMounts(mounts, validDeps)).toThrow(
      "Duplicate guest mount path: /data",
    );
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
