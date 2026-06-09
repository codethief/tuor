import { buildCommand } from "@stricli/core";
import { loadConfig } from "../config/load.ts";
import { runSession } from "../core/session.ts";

type Flags = {
  readonly dangerouslyOpenNetwork?: boolean;
};

export const command = buildCommand({
  func: async (flags: Flags, ...args: string[]) => {
    const { spec } = loadConfig();

    if (flags.dangerouslyOpenNetwork) {
      spec.network = { mode: "open" };
    }

    const command = args.length > 0 ? args : undefined;
    await runSession(spec, command);
  },
  parameters: {
    flags: {
      dangerouslyOpenNetwork: {
        kind: "boolean",
        brief: "Override the configured network policy to allow all egress",
        optional: true,
      },
    },
    positional: {
      kind: "array",
      parameter: {
        brief: "Command to run in the VM",
        parse: String,
        placeholder: "command",
      },
    },
  },
  docs: {
    brief: "Start a VM from the nearest .tuor/config.json",
    customUsage: [
      { input: "", brief: "Start an interactive shell" },
      { input: "-- npm install", brief: "Run a command in the VM" },
      {
        input: "--dangerously-open-network",
        brief: "Run with unrestricted network",
      },
    ],
  },
});
