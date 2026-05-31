#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { parseConfig } from "./config/schema.ts";
import { findAllConfigDirs, mergeConfigs } from "./config/merge.ts";
import { resolveConfig } from "./config/resolve.ts";
import { runSession } from "./core/session.ts";

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
  config: parseConfig(JSON.parse(readFileSync(join(dir, "config.json"), "utf-8"))),
  configDir: dir,
}));
const config = mergeConfigs(layers);
const closestConfigDir = configDirs[configDirs.length - 1]!;
const spec = resolveConfig(config, closestConfigDir, homedir());

const dashDash = process.argv.indexOf("--");
const command = dashDash >= 0 ? process.argv.slice(dashDash + 1) : undefined;

await runSession(spec, command);
