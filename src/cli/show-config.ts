import { buildCommand, type CommandContext } from "@stricli/core";
import { loadConfig } from "../config/load.ts";
import type { SessionSpec } from "../core/session.ts";

type Flags = {
  readonly showSecrets?: boolean;
};

export const command = buildCommand({
  func(this: CommandContext, flags: Flags) {
    const { spec } = loadConfig();
    const output = flags.showSecrets ? spec : redactSecrets(spec);
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
      "Print the effective config (after inheritance & resolution) that `run` would use",
    customUsage: [
      { input: "", brief: "Print the effective config (secrets redacted)" },
      { input: "--show-secrets", brief: "Include real secret values" },
      { input: "| jq .", brief: "Pipe the JSON to another tool" },
    ],
  },
});

/**
 * Return a copy of `spec` with every secret's value replaced by a placeholder,
 * so the effective config can be printed without leaking tokens. Host lists and
 * all other fields are left untouched; the input is not mutated.
 */
export function redactSecrets(spec: SessionSpec): SessionSpec {
  if (!spec.secrets) return spec;
  const secrets: SessionSpec["secrets"] = {};
  for (const [key, secret] of Object.entries(spec.secrets)) {
    secrets[key] = { ...secret, value: "<redacted>" };
  }
  return { ...spec, secrets };
}
