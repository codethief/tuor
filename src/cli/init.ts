import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildCommand, type CommandContext } from "@stricli/core";
import type { TuorConfig } from "../config/schema.ts";
import { STATE_DIR_NAME } from "../config/state-dir.ts";
import { MOUNT_MODES, type MountMode } from "../core/mounts.ts";

type Flags = {
  readonly openNetwork?: boolean;
  readonly workspaceMode?: MountMode;
};

export const command = buildCommand({
  func(this: CommandContext, flags: Flags) {
    const workspaceMode = flags.workspaceMode ?? "overlay";

    const tuorDir = join(process.cwd(), ".tuor");
    if (existsSync(join(tuorDir, "config.json"))) {
      this.process.stderr.write(
        `.tuor/config.json already exists. Remove it first if you want to re-initialize.\n`,
      );
      return new Error("Config already exists");
    }

    mkdirSync(tuorDir, { recursive: true });

    const config: TuorConfig = {
      network: flags.openNetwork
        ? {
            mode: "open",
          }
        : {
            mode: "restricted",
            allowedHosts: [],
            allowedInternalHosts: [],
          },
      user: "root",
      workdir: {
        hostPath: "..",
        mode: workspaceMode,
      },
    };

    writeFileSync(
      join(tuorDir, "config.json"),
      JSON.stringify(config, null, 2) + "\n",
    );
    writeFileSync(join(tuorDir, ".gitignore"), `${STATE_DIR_NAME}\n`);
    writeFileSync(
      join(tuorDir, "tuorignore"),
      [
        "# Files potentially holding secrets",
        ".env",
        ".envrc",
        "",
        "# Make sure VM guest cannot manipulate ignore files or config",
        ".tuor",
        ".tuorignore",
        "tuorignore",
        "",
      ].join("\n"),
    );

    this.process.stdout.write(`Initialized .tuor/ in ${process.cwd()}\n`);
  },
  parameters: {
    flags: {
      openNetwork: {
        kind: "boolean",
        brief: "Set network mode to open (unrestricted egress)",
        optional: true,
      },
      workspaceMode: {
        kind: "enum",
        values: MOUNT_MODES,
        brief: "Mount mode for the workspace directory",
        default: "overlay",
        optional: true,
      },
    },
  },
  docs: {
    brief: "Initialize a .tuor/ directory with a default configuration",
    customUsage: [
      {
        input: "",
        brief: "Initialize with defaults (overlay, restricted network)",
      },
      { input: "--open-network", brief: "Initialize with open network" },
      {
        input: "--workspace-mode readwrite",
        brief: "Initialize with read-write workspace",
      },
    ],
  },
});
