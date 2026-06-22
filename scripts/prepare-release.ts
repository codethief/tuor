#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rollUnreleasedSection } from "./lib/changelog.ts";
import { assertGreater, assertValid } from "./lib/semver.ts";

// Local release prep. Must be run from a clean, up-to-date `master` checkout.
// From there it:
// - validates that the target version increases,
// - branches off master, bumps package.json + lockfile,
// - rolls the CHANGELOG's `# Unreleased` section into a dated one,
// - commits,
// - pushes `release/vX`, and
// - prints a PR link.
//
// Merging that PR is what triggers the actual release (master.yml ->
// release.yml).
//
// Run: `./scripts/prepare-release.ts 0.2.0`

const rawVersion = process.argv[2];

if (rawVersion === undefined) {
  throw new Error("Usage: prepare-release.ts <version>   (e.g. 0.2.0)");
}
const version = rawVersion.replace(/^v/, "");
assertValid(version);

const branch = `release/v${version}`;
const repoRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();

// Must be run from master: the release is cut from here, and this guarantees
// the prepare-release.ts being executed is master's own copy (not a
// stale/divergent one on a feature branch). This script does not fetch — make
// sure master is current (git pull) first.
const currentBranch = capture("git", "rev-parse", "--abbrev-ref", "HEAD");
if (currentBranch !== "master") {
  throw new Error(
    `Must be on master to prepare a release (currently on '${currentBranch}').`,
  );
}

// Refuse to run on a dirty tree: we commit only the release files, so stray
// local changes would just be confusing (or silently left behind on the release
// branch).
if (capture("git", "status", "--porcelain") !== "") {
  throw new Error(
    "Working tree is not clean — commit or stash your changes first.",
  );
}

// Validate everything that can throw BEFORE branching or mutating files. We're
// on a clean master, so the working tree is exactly master.
// rollUnreleasedSection throws on a missing/empty `# Unreleased` section;
// assertGreater on a non-increasing version.
const currentVersion = packageVersion(
  readFileSync(join(repoRoot, "package.json"), "utf8"),
);
assertGreater(currentVersion, version);
const rolledChangelog = rollUnreleasedSection(
  readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8"),
  version,
  new Date().toISOString().slice(0, 10), // today, UTC
);
console.log(
  `Preparing release v${version} (current master is ${currentVersion})…`,
);

// Apply: branch off master (HEAD), bump, roll, commit, push.
run("git", "switch", "--create", branch);
run("npm", "version", version, "--no-git-tag-version"); // bumps package.json + package-lock.json
writeFileSync(join(repoRoot, "CHANGELOG.md"), rolledChangelog);
run(
  "git",
  "commit",
  "package.json",
  "package-lock.json",
  "CHANGELOG.md",
  "-m",
  `Release v${version}`,
);
run("git", "push", "--set-upstream", "origin", branch);

console.log(`\n✓ Pushed ${branch}. Open the release PR:\n  ${compareUrl()}\n`);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Runs a command in the repo root and returns its trimmed stdout. */
function capture(file: string, ...args: string[]): string {
  return execFileSync(file, args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

/** Runs a command in the repo root, streaming its output to the terminal. */
function run(file: string, ...args: string[]): void {
  execFileSync(file, args, { cwd: repoRoot, stdio: "inherit" });
}

/** Extracts the `version` field from package.json text (validated, no casts). */
function packageVersion(packageJson: string): string {
  const parsed: unknown = JSON.parse(packageJson);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("version" in parsed) ||
    typeof parsed.version !== "string"
  ) {
    throw new Error("package.json does not contain a string `version` field.");
  }
  return parsed.version;
}

/** Builds the GitHub "open a PR" compare link for the pushed branch. */
function compareUrl(): string {
  const url = capture("git", "remote", "get-url", "origin");
  const match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(url);
  const owner = match?.[1];
  const repo = match?.[2];
  if (owner === undefined || repo === undefined) {
    throw new Error(
      `Could not parse a GitHub repo from the origin URL: ${url}`,
    );
  }
  return `https://github.com/${owner}/${repo}/compare/master...${branch}?expand=1`;
}
