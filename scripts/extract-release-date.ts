#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { readFileSync } from "node:fs";
import { extractReleaseDate } from "./lib/changelog.ts";

// Release-time: print the date from the already-merged `# ${version} (${date})` heading
// in CHANGELOG.md, for composing the GitHub Release title.

const rawVersion = process.argv[2];
if (rawVersion === undefined) {
  throw new Error("Usage: extract-release-date.ts <version>");
}
const version = rawVersion.replace(/^v/, "");

const content = readFileSync("CHANGELOG.md", "utf8");
console.log(extractReleaseDate(content, version));
