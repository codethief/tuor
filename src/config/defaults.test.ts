import { describe, expect, test } from "vitest";
import { applyConfigDefaults } from "./defaults.ts";
import type { TuorConfig } from "./schema.ts";

/**
 * A merged config as it reaches applyConfigDefaults: guestUser/workdir are
 * optional (no schema default) and only present when a layer set them
 * explicitly.
 */
function config(overrides: Partial<TuorConfig> = {}): TuorConfig {
  return { ...overrides };
}

describe("applyConfigDefaults", () => {
  describe("guestUser / workdir", () => {
    test("defaults guestUser to root (uid/gid 0, homedir /root) when omitted", () => {
      expect(applyConfigDefaults(config()).guestUser).toEqual({
        uid: 0,
        gid: 0,
        homedir: "/root",
      });
    });

    test("defaults workdir to / when omitted", () => {
      expect(applyConfigDefaults(config()).workdir).toBe("/");
    });

    test("preserves an explicit guestUser and workdir", () => {
      const result = applyConfigDefaults(
        config({ guestUser: { uid: 0, gid: 0 }, workdir: "/w" }),
      );
      expect(result.guestUser).toEqual({ uid: 0, gid: 0, homedir: "/root" });
      expect(result.workdir).toBe("/w");
    });
  });

  describe("network", () => {
    test("defaults omitted network to restricted with empty allowlists", () => {
      const result = applyConfigDefaults(config());
      expect(result.network).toEqual({
        mode: "restricted",
        allowedHosts: [],
        allowedInternalHosts: [],
      });
    });

    test("passes open network through unchanged", () => {
      const result = applyConfigDefaults(config({ network: { mode: "open" } }));
      expect(result.network).toEqual({ mode: "open" });
    });

    test("fills missing allowlists on a restricted network", () => {
      const result = applyConfigDefaults(
        config({ network: { mode: "restricted", allowedHosts: ["*.gh.com"] } }),
      );
      expect(result.network).toEqual({
        mode: "restricted",
        allowedHosts: ["*.gh.com"],
        allowedInternalHosts: [],
      });
    });
  });

  describe("guestUser.homedir", () => {
    test("defaults to /root when omitted", () => {
      const result = applyConfigDefaults(config());
      expect(result.guestUser.homedir).toBe("/root");
    });

    test("preserves an explicit guestUser.homedir", () => {
      const result = applyConfigDefaults(
        config({ guestUser: { uid: 0, gid: 0, homedir: "/custom/home" } }),
      );
      expect(result.guestUser.homedir).toBe("/custom/home");
    });
  });

  test("leaves other fields untouched", () => {
    const input = config({
      guestUser: { uid: 0, gid: 0 },
      workdir: "/work",
      resources: { rootfsSize: "2G" },
    });
    const result = applyConfigDefaults(input);
    expect(result.guestUser).toEqual({ uid: 0, gid: 0, homedir: "/root" });
    expect(result.workdir).toBe("/work");
    expect(result.resources).toEqual({ rootfsSize: "2G" });
  });

  test("does not mutate the input config", () => {
    const input = config();
    applyConfigDefaults(input);
    expect(input.network).toBeUndefined();
    expect(input.guestUser).toBeUndefined();
  });
});
