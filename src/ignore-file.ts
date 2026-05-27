import { dirname, join, relative, resolve } from "node:path";
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from "node:fs";

// --- Types ---

type IgnoreFileRef =
  | { source: "host"; path: string }
  | { source: "mount"; path: string; recursive: boolean };  // recursive is True <=> path must be a filename (not contain any slashes)

type IgnoreFileDeps = {
  readFile: (path: string) => string;
  pathExists: (path: string) => boolean;
  /** Find all files named `filename` under `rootDir`, returning absolute paths. */
  walkFiles: (rootDir: string, filename: string) => string[];  // TODO Rename to findAllFiles()
};

/**
 * A pattern with a scope — the directory it applies to.
 * Scope "/" means the pattern applies from the mount root.
 * Scope "/sub" means the pattern only applies under /sub/.
 * 
 * Unless scope is "/", it must not carry a trailing slash.
 */
type ScopedPattern = { pattern: string; scope: string };


// --- Parsing ---

function parseIgnoreFileRef(ref: string): IgnoreFileRef {
  const colonIdx = ref.indexOf(":");
  if (colonIdx === -1) {
    throw new Error(
      `Invalid ignore file ref "${ref}": must start with "host:" or "mount:"`,
    );
  }

  const prefix = ref.slice(0, colonIdx);
  const path = ref.slice(colonIdx + 1);

  if (path === "") {
    throw new Error(`Invalid ignore file ref "${ref}": path is empty`);
  }

  switch (prefix) {
    case "host":
      return { source: "host", path };
    case "mount":
      return {
        source: "mount",
        path,
        recursive: !path.startsWith("/"),
      };
    default:
      throw new Error(
        `Invalid ignore file ref "${ref}": unknown prefix "${prefix}", expected "host" or "mount"`,
      );
  }
}

/**
 * Find & parse all ignore files, return of all patterns (with scope) of files
 * to be ignored.
 *
 * Missing ignore files are silently skipped — the user may or may not have
 * created them.
 */
function collectIgnorePatterns(
  refs: IgnoreFileRef[],
  hostPath: string,
  configDir: string,
  deps: IgnoreFileDeps,
): ScopedPattern[] {
  const result: ScopedPattern[] = [];

  for (const ref of refs) {
    switch (ref.source) {
      case "host": {
        const filePath = resolve(configDir, ref.path);
        if (!deps.pathExists(filePath)) continue;
        // host: patterns are scoped to the mount root
        result.push(..._parseIgnoreFile(deps.readFile(filePath)).map(pattern => ({ pattern, scope: "/" })));
        break;
      }
      case "mount": {
        if (ref.recursive) {
          for (const absPath of deps.walkFiles(hostPath, ref.path)) {
            const dir = relative(hostPath, dirname(absPath));
            const scope = dir === "" ? "/" : `/${dir}`;
            result.push(..._parseIgnoreFile(deps.readFile(absPath)).map(pattern => ({ pattern, scope })));
          }
        } else {
          const filePath = join(hostPath, ref.path);
          if (!deps.pathExists(filePath)) continue;
          result.push(..._parseIgnoreFile(deps.readFile(filePath)).map(pattern => ({ pattern, scope: "/" })));
        }
        break;
      }
    }
  }

  return result;
}


function _parseIgnoreFile(contents: string): string[] {
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
}



// --- Shadow predicate ---

type ShadowPredicate = (ctx: { op: string; path: string }) => boolean;

type CompiledRule = { anchored: string } | { unanchored: string; scope: string };
// `anchored`, `unanchored`, `scope` are paths.


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
function buildShadowPredicate(patterns: ScopedPattern[]): ShadowPredicate {
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
      if (_doesRuleMatch(rule, p)) {
        return true;
      }      
    }

    return false;
  };
}

/**
 * `path` is relative to mount point, with leading /.
 */
function _doesRuleMatch(rule: CompiledRule, path: string) {
  if ("anchored" in rule) {
    return (
      rule.anchored === "/" ||
      path === rule.anchored || 
      path.startsWith(rule.anchored + "/")
    );
  } else {
    const { unanchored, scope } = rule;

    if (scope === "/") {
      return _matchUnanchored(path, unanchored);
    } else {
      return (
        path.startsWith(scope + "/") &&
        _matchUnanchored(path.slice(scope.length), unanchored)
        // When slicing^ make sure to preserve the slash right after scope
      );
    }
  }
}


/**
 * @param path Path to be matched
 * @param unanchored Partial path to match against. Must not contain a leading or trailing slash.
 */
function _matchUnanchored(path: string, unanchored: string): boolean {
  return path.endsWith(`/${unanchored}`) || path.includes(`/${unanchored}/`);
}


// --- Default deps (real filesystem) ---

function walkFilesRecursive(rootDir: string, filename: string): string[] {
  const results: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        if (!statSync(full).isDirectory()) continue;
        const real = realpathSync(full);
        if (dir.startsWith(real + "/") || dir === real) {
          throw new Error(
            `Symlink cycle detected while scanning for ${filename}: ` +
            `${full} resolves to ancestor ${real}. ` +
            "Right now, Tuor's ignore files feature does not support symlink cycles",
          );
        }
        walk(full);
      } else if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === filename) {
        results.push(full);
      }
    }
  };
  walk(rootDir);
  return results;
}

const defaultIgnoreFileDeps: IgnoreFileDeps = {
  readFile: (p) => readFileSync(p, "utf-8"),
  pathExists: existsSync,
  walkFiles: walkFilesRecursive,
};

export {
  _parseIgnoreFile,
  parseIgnoreFileRef,
  collectIgnorePatterns,
  buildShadowPredicate,
  defaultIgnoreFileDeps,
};
export type { IgnoreFileRef, IgnoreFileDeps, ShadowPredicate, ScopedPattern };
