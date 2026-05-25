import { describe, expect, test } from "vitest";
import { resolveWorkdir } from "./workdir.ts";

describe("resolveWorkdir", () => {
  test("returns guestPath as-is for a string workdir", () => {
    const result = resolveWorkdir("/workspace", "/any/configDir");
    expect(result).toEqual({ guestPath: "/workspace" });
  });

  test("does not produce a mount for a string workdir", () => {
    const result = resolveWorkdir("/workspace", "/any/configDir");
    expect(result.mount).toBeUndefined();
  });

  test("uses explicit guestPath from MountConfig", () => {
    const result = resolveWorkdir(
      { hostPath: "/host/project", guestPath: "/guest/project", mode: "readonly" },
      "/any/configDir",
    );
    expect(result.guestPath).toBe("/guest/project");
  });

  test("defaults guestPath to resolved hostPath when not specified", () => {
    const result = resolveWorkdir(
      { hostPath: "../project", mode: "readonly" },
      "/home/user/.tuor",
    );
    expect(result.guestPath).toBe("/home/user/project");
  });

  test("resolves relative hostPath against configDir", () => {
    const result = resolveWorkdir(
      { hostPath: "..", mode: "readonly" },
      "/home/user/.tuor",
    );
    expect(result.guestPath).toBe("/home/user");
  });

  test("returns the MountConfig as mount", () => {
    const mountConfig = {
      hostPath: "/host/project",
      guestPath: "/workspace",
      mode: "readonly",
    } as const;
    const result = resolveWorkdir(mountConfig, "/any/configDir");
    expect(result.mount).toBe(mountConfig);
  });
});
