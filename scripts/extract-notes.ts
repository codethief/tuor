#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { readFileSync, writeFileSync } from "node:fs";
import { extractReleaseNotes } from "./lib/changelog.ts";

// Release-time: pull the already-merged dated section's body out of CHANGELOG.md and
// write it to a file for `gh release create --notes-file`.

const rawVersion = process.argv[2];
const outPath = process.argv[3];
if (rawVersion === undefined || outPath === undefined) {
  throw new Error("Usage: extract-notes.ts <version> <output-path>");
}
const version = rawVersion.replace(/^v/, "");

const content = readFileSync("CHANGELOG.md", "utf8");
writeFileSync(outPath, extractReleaseNotes(content, version));
