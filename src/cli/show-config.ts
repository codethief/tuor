import { buildCommand, type CommandContext } from "@stricli/core";
import type { DefaultedConfig } from "../config/defaults.ts";
import { loadEffectiveConfig } from "../config/load.ts";
import type { EnvValue } from "../config/schema.ts";

type Flags = {
  readonly showSecrets?: boolean;
};

export const command = buildCommand({
  func(this: CommandContext, flags: Flags) {
    const { config } = loadEffectiveConfig();
    const output = flags.showSecrets ? config : redactSecrets(config);
    this.process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  },
  parameters: {
    flags: {
      showSecrets: {
        kind: "boolean",
        brief: "Include real secret values instead of redacting them",
        optional: true,
      },
    },
  },
  docs: {
    brief:
      "Print the effective config (after inheritance & defaults) that `run` would use",
    customUsage: [
      { input: "", brief: "Print the effective config (secrets redacted)" },
      { input: "--show-secrets", brief: "Include real secret values" },
      { input: "| jq .", brief: "Pipe the JSON to another tool" },
    ],
  },
});

/**
 * Return a copy of `config` with every secret env var's literal value replaced
 * by a placeholder, so the effective config can be printed without leaking
 * tokens. Only entries marked `secret: true` are touched (matching how `run`
 * treats secrets); host-sourced secrets carry no value and non-secret vars are
 * left as-is. The input is not mutated; if nothing was redacted the original is
 * returned unchanged.
 */
export function redactSecrets(config: DefaultedConfig): DefaultedConfig {
  if (!config.env) return config;

  let redactedAny = false;
  const env: Record<string, EnvValue> = {};
  for (const [key, value] of Object.entries(config.env)) {
    if (isSecretWithValue(value)) {
      env[key] = { ...value, value: "<redacted>" };
      redactedAny = true;
    } else {
      env[key] = value;
    }
  }

  return redactedAny ? { ...config, env } : config;
}

function isSecretWithValue(
  value: EnvValue,
): value is Extract<EnvValue, { secret: true }> & { value: string } {
  return (
    typeof value === "object" && "secret" in value && value.value !== undefined
  );
}
