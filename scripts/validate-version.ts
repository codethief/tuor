#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { assertValid } from "./lib/semver.ts";

// Release-time defence-in-depth: fail fast if the version read from package.json by the
// release gate is malformed, before it is ever interpolated into a tag ref.

const version = process.argv[2];
if (version === undefined) {
  throw new Error("Usage: validate-version.ts <version>");
}

assertValid(version);
