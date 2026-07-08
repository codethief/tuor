import { describe, expect, test } from "vitest";
import { applyConfigDefaults } from "./defaults.ts";
import type { TuorConfig } from "./schema.ts";

/**
 * A merged config as it reaches applyConfigDefaults: user/workdir are optional
 * (no schema default) and only present when a layer set them explicitly.
 */
function config(overrides: Partial<TuorConfig> = {}): TuorConfig {
  return { ...overrides };
}

describe("applyConfigDefaults", () => {
  describe("user / workdir", () => {
    test("defaults user to root when omitted", () => {
      expect(applyConfigDefaults(config()).user).toBe("root");
    });

    test("defaults workdir to / when omitted", () => {
      expect(applyConfigDefaults(config()).workdir).toBe("/");
    });

    test("preserves an explicit user and workdir", () => {
      const result = applyConfigDefaults(
        config({ user: "dev", workdir: "/w" }),
      );
      expect(result.user).toBe("dev");
      expect(result.workdir).toBe("/w");
    });

    test("infers guestHomeDir from the defaulted user when user is omitted", () => {
      expect(applyConfigDefaults(config()).guestHomeDir).toBe("/root");
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

  describe("guestHomeDir", () => {
    test("infers /root for the root user when omitted", () => {
      const result = applyConfigDefaults(config({ user: "root" }));
      expect(result.guestHomeDir).toBe("/root");
    });

    test("infers /home/<user> for a non-root user when omitted", () => {
      const result = applyConfigDefaults(config({ user: "dev" }));
      expect(result.guestHomeDir).toBe("/home/dev");
    });

    test("preserves an explicit guestHomeDir", () => {
      const result = applyConfigDefaults(
        config({ guestHomeDir: "/custom/home" }),
      );
      expect(result.guestHomeDir).toBe("/custom/home");
    });
  });

  test("leaves other fields untouched", () => {
    const input = config({ user: "dev", workdir: "/work", rootfsSize: "2G" });
    const result = applyConfigDefaults(input);
    expect(result.user).toBe("dev");
    expect(result.workdir).toBe("/work");
    expect(result.rootfsSize).toBe("2G");
  });

  test("does not mutate the input config", () => {
    const input = config();
    applyConfigDefaults(input);
    expect(input.network).toBeUndefined();
    expect(input.guestHomeDir).toBeUndefined();
  });
});
