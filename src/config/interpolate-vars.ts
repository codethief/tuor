/**
 * Interpolation of host environment variables into config string values.
 *
 * Runs on the raw JSON tree (before schema parsing), so it covers *every*
 * string value — paths, network hosts, env values, … — without enumerating
 * config fields. Object keys are deliberately left untouched.
 */

export type InterpolationVars = Record<string, string | undefined>;

/**
 * Recursively interpolate `$VAR` / `${VAR}` references in every string value of
 * `value`, looking names up in `vars`. Object keys are never interpolated;
 * numbers, booleans and null pass through unchanged.
 *
 * Syntax (see {@link VAR_PATTERN}):
 * - `$NAME` / `${NAME}` where NAME matches `[A-Za-z_][A-Za-z0-9_]*`
 * - `$$` is an escape for a literal `$`
 * - A `$` not forming one of the above (e.g. `"$5"`, a trailing `"100$"`, or a
 *   malformed `"${FOO-BAR}"`) is left as-is.
 *
 * Throws if a referenced variable is not present in `vars` (fail-fast: an unset
 * variable silently collapsing a path to "" would be worse than a hard error).
 */
export function interpolateVars(
  value: unknown,
  vars: InterpolationVars,
): unknown {
  return interpolate(value, vars, "");
}

// --- Internals ---

// Alternation order matters: `$$` must be tried before the bare `$NAME` form.
const VAR_PATTERN =
  /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g;

function interpolate(
  value: unknown,
  vars: InterpolationVars,
  path: string,
  // `path` is threaded purely to make the missing-variable error point at the
  // offending location in the config tree.
): unknown {
  if (typeof value === "string") {
    return interpolateString(value, vars, path);
  }
  if (Array.isArray(value)) {
    return value.map((item, i) => interpolate(item, vars, `${path}[${i}]`));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, val]) => [
        key, // keys are never interpolated
        interpolate(val, vars, path ? `${path}.${key}` : key),
      ]),
    );
  }
  return value;
}

function interpolateString(
  str: string,
  vars: InterpolationVars,
  path: string,
): string {
  return str.replace(VAR_PATTERN, (match, braced?: string, bare?: string) => {
    if (match === "$$") return "$";
    const name = braced ?? bare!;
    const resolved = vars[name];
    if (resolved === undefined) {
      throw new Error(
        `Config interpolation error${path ? ` at "${path}"` : ""}: ` +
          `environment variable "${name}" is not set`,
      );
    }
    return resolved;
  });
}
