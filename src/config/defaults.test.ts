import { describe, expect, test } from "vitest";
import { applyConfigDefaults } from "./defaults.ts";
import type { TuorConfig } from "./schema.ts";

function config(overrides: Partial<TuorConfig> = {}): TuorConfig {
  return { user: "root", workdir: "/", ...overrides };
}

describe("applyConfigDefaults", () => {
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
