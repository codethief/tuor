import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { SessionSpec } from "../core/session.ts";
import { applyConfigDefaults, type DefaultedConfig } from "./defaults.ts";
import { interpolateVars } from "./interpolate-vars.ts";
import { findAllConfigDirs, mergeConfigs } from "./merge.ts";
import { createSessionSpecFromConfig } from "./resolve.ts";
import { parseConfig } from "./schema.ts";

export type LoadedEffectiveConfig = {
  config: DefaultedConfig;
  closestConfigDir: string;
};

export type LoadedSessionSpec = {
  spec: SessionSpec;
  closestConfigDir: string;
};

/**
 * Discover, parse, merge, and default Tuor configuration into the effective
 * config a user reasons about (same shape as `config.json`, defaults filled).
 * This is the artifact `show-config` prints. Exits the process if no config is
 * found.
 */
export function loadEffectiveConfig(): LoadedEffectiveConfig {
  const configDirs = findAllConfigDirs(process.cwd(), homedir());
  if (configDirs.length === 0) {
    console.error(
      "No .tuor/config.json found in current directory, any parent, or ~/.config/tuor/.",
    );
    process.exit(1);
  }

  for (const dir of configDirs) {
    // Informational, not data: keep it off stdout so commands like
    // `show-config` can emit clean, pipeable output.
    console.error(`Loading config: ${join(dir, "config.json")}`);
  }

  // Interpolate $VAR / ${VAR} against the host env per layer (before parsing,
  // so interpolated values are still schema-validated and every string value
  // is covered).
  const layers = configDirs.map((dir) => ({
    config: parseConfig(
      interpolateVars(
        JSON.parse(readFileSync(join(dir, "config.json"), "utf-8")),
        process.env,
      ),
    ),
    configDir: dir,
  }));
  const merged = mergeConfigs(layers);
  const closestConfigDir = configDirs[configDirs.length - 1]!;

  return { config: applyConfigDefaults(merged), closestConfigDir };
}

/**
 * Load the effective config and convert it into the `SessionSpec` that `run`
 * boots a VM from.
 */
export function loadSessionSpec(): LoadedSessionSpec {
  const { config, closestConfigDir } = loadEffectiveConfig();
  const spec = createSessionSpecFromConfig(config, closestConfigDir, homedir());
  return { spec, closestConfigDir };
}
