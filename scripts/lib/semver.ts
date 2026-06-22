import semver from "semver";

// Version validation/comparison helpers for the release scripts. Pure functions over
// the `semver` package — no bespoke precedence logic (it handles numeric/alphanumeric
// prerelease ordering for us).

/**
 * Returns the normalized version, or throws if `version` is not a valid semantic
 * version. Used by the release gate, where there is no previous version to compare
 * against — only a format check.
 */
export function assertValid(version: string): string {
  const normalized = semver.valid(version);
  if (normalized === null) {
    throw new Error(`Not a valid semantic version: ${JSON.stringify(version)}`);
  }
  return normalized;
}

/**
 * Throws unless `next` is a strictly greater semantic version than `current`. Both
 * inputs are format-validated first. `npm version` itself only rejects an *unchanged*
 * version, so this is what actually blocks downgrades.
 */
export function assertGreater(current: string, next: string): void {
  if (!semver.gt(next, current)) {
    throw new Error(
      `Target version ${next} must be strictly greater than the current version ${current}.`,
    );
  }
}
