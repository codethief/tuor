#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { readFileSync, writeFileSync } from "node:fs";
import { rollUnreleasedSection } from "./lib/changelog.ts";

// Prepare-time: roll `# Unreleased` into a dated section in place. Date is today (UTC).

const rawVersion = process.argv[2];
if (rawVersion === undefined) {
  throw new Error("Usage: roll-changelog.ts <version>");
}
const version = rawVersion.replace(/^v/, "");
const dateIso = new Date().toISOString().slice(0, 10);

const path = "CHANGELOG.md";
const content = readFileSync(path, "utf8");
writeFileSync(path, rollUnreleasedSection(content, version, dateIso));
