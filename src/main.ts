#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { findConfigDir, parseConfig } from "./config/schema.ts";
import { resolveConfig } from "./config/resolve.ts";
import { runSession } from "./core/session.ts";

const configDir = findConfigDir(process.cwd());
if (!configDir) {
  console.error(
    "No .tuor/config.json found in current directory or any parent.",
  );
  process.exit(1);
}

const raw = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
const config = parseConfig(raw);
const spec = resolveConfig(config, configDir, homedir());

const dashDash = process.argv.indexOf("--");
const command = dashDash >= 0 ? process.argv.slice(dashDash + 1) : undefined;

await runSession(spec, command);
