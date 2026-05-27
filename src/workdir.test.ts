import { describe, expect, test } from "vitest";
import { resolveWorkdir } from "./workdir.ts";

const HOST_HOME = "/home/hostuser";
const GUEST_HOME = "/home/guestuser";

describe("resolveWorkdir", () => {
  test("returns guestPath as-is for a string workdir", () => {
    const result = resolveWorkdir("/workspace", "/any/configDir", HOST_HOME, GUEST_HOME);
    expect(result).toEqual({ guestPath: "/workspace" });
  });

  test("does not produce a mount for a string workdir", () => {
    const result = resolveWorkdir("/workspace", "/any/configDir", HOST_HOME, GUEST_HOME);
    expect(result.mount).toBeUndefined();
  });

  test("uses explicit guestPath from MountConfig", () => {
    const result = resolveWorkdir(
      { hostPath: "/host/project", guestPath: "/guest/project", mode: "readonly" },
      "/any/configDir",
      HOST_HOME,
      GUEST_HOME,
    );
    expect(result.guestPath).toBe("/guest/project");
  });

  test("defaults guestPath to resolved hostPath when not specified", () => {
    const result = resolveWorkdir(
      { hostPath: "../project", mode: "readonly" },
      "/home/user/.tuor",
      HOST_HOME,
      GUEST_HOME,
    );
    expect(result.guestPath).toBe("/home/user/project");
  });

  test("resolves relative hostPath against configDir", () => {
    const result = resolveWorkdir(
      { hostPath: "..", mode: "readonly" },
      "/home/user/.tuor",
      HOST_HOME,
      GUEST_HOME,
    );
    expect(result.guestPath).toBe("/home/user");
  });

  test("returns the MountConfig as mount", () => {
    const mountConfig = {
      hostPath: "/host/project",
      guestPath: "/workspace",
      mode: "readonly",
    } as const;
    const result = resolveWorkdir(mountConfig, "/any/configDir", HOST_HOME, GUEST_HOME);
    expect(result.mount).toBe(mountConfig);
  });

  test("expands ~ in string workdir using guest home dir", () => {
    const result = resolveWorkdir("~/workspace", "/any/configDir", HOST_HOME, "/root");
    expect(result.guestPath).toBe("/root/workspace");
  });

  test("expands ~ in MountConfig hostPath using host home dir", () => {
    const result = resolveWorkdir(
      { hostPath: "~/project", mode: "readonly" },
      "/any/configDir",
      "/home/alice",
      GUEST_HOME,
    );
    expect(result.guestPath).toBe("/home/alice/project");
  });

  test("expands ~ in MountConfig guestPath using guest home dir", () => {
    const result = resolveWorkdir(
      { hostPath: "/host/project", guestPath: "~/project", mode: "readonly" },
      "/any/configDir",
      HOST_HOME,
      "/home/bob",
    );
    expect(result.guestPath).toBe("/home/bob/project");
  });
});
