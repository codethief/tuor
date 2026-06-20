#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { readFileSync } from "node:fs";
import { assertGreater } from "./lib/semver.ts";

// Prepare-time guard: verify the target version strictly increases over the current
// package.json version. Mutates nothing — `npm version` does the actual bump.

const next = process.argv[2];
if (next === undefined) {
  throw new Error("Usage: check-version-increases.ts <target-version>");
}

const parsed: unknown = JSON.parse(readFileSync("./package.json", "utf8"));
if (
  typeof parsed !== "object" ||
  parsed === null ||
  !("version" in parsed) ||
  typeof parsed.version !== "string"
) {
  throw new Error("package.json does not contain a string `version` field.");
}

assertGreater(parsed.version, next);
