import { describe, expect, test } from "vitest";
import type { SessionSpec } from "../core/session.ts";
import { redactSecrets } from "./show-config.ts";

const baseSpec: SessionSpec = {
  user: "root",
  workdir: "/workspace",
  network: { mode: "restricted", allowedHosts: [], allowedInternalHosts: [] },
  mounts: [],
};

describe("redactSecrets", () => {
  test("replaces secret values with a placeholder, preserving hosts", () => {
    const spec: SessionSpec = {
      ...baseSpec,
      env: { EDITOR: "vim" },
      secrets: {
        GH_TOKEN: { hosts: ["*.github.com"], value: "ghp_supersecret" },
      },
    };

    const result = redactSecrets(spec);

    expect(result.secrets).toEqual({
      GH_TOKEN: { hosts: ["*.github.com"], value: "<redacted>" },
    });
    // Non-secret fields are untouched.
    expect(result.env).toEqual({ EDITOR: "vim" });
    expect(result.user).toBe("root");
    expect(result.network).toEqual(spec.network);
  });

  test("does not mutate the input spec", () => {
    const spec: SessionSpec = {
      ...baseSpec,
      secrets: { TOKEN: { hosts: ["api.example.com"], value: "real-value" } },
    };

    redactSecrets(spec);

    expect(spec.secrets?.TOKEN?.value).toBe("real-value");
  });

  test("returns the spec unchanged when there are no secrets", () => {
    const result = redactSecrets(baseSpec);
    expect(result).toBe(baseSpec);
  });
});
