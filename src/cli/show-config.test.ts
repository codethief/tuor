import { describe, expect, test } from "vitest";
import type { DefaultedConfig } from "../config/defaults.ts";
import { redactSecrets } from "./show-config.ts";

const baseConfig: DefaultedConfig = {
  guestUser: { uid: 0, gid: 0 },
  workdir: "/workspace",
  guestHomeDir: "/root",
  network: { mode: "restricted", allowedHosts: [], allowedInternalHosts: [] },
};

describe("redactSecrets", () => {
  test("replaces a secret's literal value, preserving injectForHosts", () => {
    const config: DefaultedConfig = {
      ...baseConfig,
      env: {
        EDITOR: "vim",
        GH_TOKEN: {
          secret: true,
          injectForHosts: ["*.github.com"],
          value: "ghp_supersecret",
        },
      },
    };

    const result = redactSecrets(config);

    expect(result.env).toEqual({
      EDITOR: "vim",
      GH_TOKEN: {
        secret: true,
        injectForHosts: ["*.github.com"],
        value: "<redacted>",
      },
    });
  });

  test("leaves a host-sourced secret (no value) untouched", () => {
    const config: DefaultedConfig = {
      ...baseConfig,
      env: {
        API_KEY: { secret: true, injectForHosts: ["api.example.com"] },
      },
    };

    const result = redactSecrets(config);

    expect(result.env).toEqual({
      API_KEY: { secret: true, injectForHosts: ["api.example.com"] },
    });
  });

  test("does not mutate the input config", () => {
    const config: DefaultedConfig = {
      ...baseConfig,
      env: {
        TOKEN: {
          secret: true,
          injectForHosts: ["api.example.com"],
          value: "real-value",
        },
      },
    };

    redactSecrets(config);

    const token = config.env?.TOKEN;
    expect(typeof token === "object" && token.value).toBe("real-value");
  });

  test("returns the config unchanged when there are no secrets", () => {
    const config: DefaultedConfig = {
      ...baseConfig,
      env: { EDITOR: "vim" },
    };
    expect(redactSecrets(config)).toBe(config);
  });

  test("returns the config unchanged when there is no env", () => {
    expect(redactSecrets(baseConfig)).toBe(baseConfig);
  });
});
