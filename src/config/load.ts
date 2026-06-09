import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionSpec } from "../core/session.ts";
import { findAllConfigDirs, mergeConfigs } from "./merge.ts";
import { resolveConfig } from "./resolve.ts";
import { parseConfig } from "./schema.ts";

export type LoadedConfig = {
  spec: SessionSpec;
  closestConfigDir: string;
};

/**
 * Discover, parse, merge, and resolve Tuor configuration.
 * Exits the process if no config is found.
 */
export function loadConfig(): LoadedConfig {
  const configDirs = findAllConfigDirs(process.cwd(), homedir());
  if (configDirs.length === 0) {
    console.error(
      "No .tuor/config.json found in current directory, any parent, or ~/.config/tuor/.",
    );
    process.exit(1);
  }

  for (const dir of configDirs) {
    console.log(`Loading config: ${join(dir, "config.json")}`);
  }

  const layers = configDirs.map((dir) => ({
    config: parseConfig(
      JSON.parse(readFileSync(join(dir, "config.json"), "utf-8")),
    ),
    configDir: dir,
  }));
  const config = mergeConfigs(layers);
  const closestConfigDir = configDirs[configDirs.length - 1]!;
  const spec = resolveConfig(config, closestConfigDir, homedir());

  return { spec, closestConfigDir };
}
