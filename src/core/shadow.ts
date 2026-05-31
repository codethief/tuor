// --- Types ---

/**
 * A pattern with a scope — the directory it applies to.
 * Scope "/" means the pattern applies from the mount root.
 * Scope "/sub" means the pattern only applies under /sub/.
 *
 * Unless scope is "/", it must not carry a trailing slash.
 */
export type ScopedPattern = { pattern: string; scope: string };

type ShadowPredicate = (ctx: { op: string; path: string }) => boolean;

type CompiledRule = { anchored: string } | { unanchored: string; scope: string };
// `anchored`, `unanchored`, `scope` are paths.


// --- Shadow predicate ---

/**
 * Matching rules (inspired by .gitignore):
 * - Bare name (no `/` except an optional trailing one): matches at any depth
 *   within its scope. E.g. ".envrc" with scope "/sub" matches "/sub/.envrc",
 *   "/sub/deep/.envrc", but not "/.envrc".
 * - Path containing `/` (after stripping an optional trailing `/`): anchored
 *   relative to its scope. E.g. "build/out" with scope "/sub" matches only
 *   "/sub/build/out".
 * - A trailing `/` is stripped before matching (it does NOT restrict matching
 *   to directories). Exception: a bare "/" is never stripped to empty.
 *
 * In all cases, a match on a path also shadows everything below it
 * (e.g. ".git" shadows ".git/config").
 */
export function buildShadowPredicate(patterns: ScopedPattern[]): ShadowPredicate {
  const rules: CompiledRule[] = [];

  for (const { pattern: rawPattern, scope } of patterns) {
    // Strip trailing slash
    const pattern = rawPattern.length > 1 && rawPattern.endsWith("/")
      ? rawPattern.slice(0, -1)
      : rawPattern;

    const containsSlash = pattern.includes("/");
    if (!containsSlash) {
      rules.push({ unanchored: pattern, scope });
    } else {
      // Anchored relative to scope
      const normalizedScope = scope === "/" ? "" : scope;
      const patternWithoutLeadingSlash = pattern.startsWith("/") ? pattern.slice(1) : pattern;
      rules.push({ anchored: `${normalizedScope}/${patternWithoutLeadingSlash}` });
    }
  }

  return ({ path }) => {
    const p = path.startsWith("/") ? path : `/${path}`;

    for (const rule of rules) {
      if (doesRuleMatch(rule, p)) {
        return true;
      }
    }

    return false;
  };
}

/**
 * `path` is relative to mount point, with leading /.
 */
function doesRuleMatch(rule: CompiledRule, path: string) {
  if ("anchored" in rule) {
    return (
      rule.anchored === "/" ||
      path === rule.anchored ||
      path.startsWith(rule.anchored + "/")
    );
  } else {
    const { unanchored, scope } = rule;

    if (scope === "/") {
      return matchUnanchored(path, unanchored);
    } else {
      return (
        path.startsWith(scope + "/") &&
        matchUnanchored(path.slice(scope.length), unanchored)
        // When slicing^ make sure to preserve the slash right after scope
      );
    }
  }
}


/**
 * @param path Path to be matched
 * @param unanchored Partial path to match against. Must not contain a leading or trailing slash.
 */
function matchUnanchored(path: string, unanchored: string): boolean {
  return path.endsWith(`/${unanchored}`) || path.includes(`/${unanchored}/`);
}
