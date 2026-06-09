import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { ScopedPattern } from "../core/shadow.ts";

// --- Types ---

export type IgnoreFileRef =
  | { source: "host"; path: string }
  | { source: "mount"; path: string; recursive: boolean }; // recursive is True <=> path must be a filename (not contain any slashes)

export const DEFAULT_IGNORE_FILE_REFS = [
  "host:./tuorignore",
  "mount:.tuorignore",
];

export type IgnoreFileDeps = {
  readFile: (path: string) => string;
  pathExists: (path: string) => boolean;
  /** Find all files named `filename` under `rootDir`, returning absolute paths. */
  walkFiles: (rootDir: string, filename: string) => string[];
};

export function parseIgnoreFileRef(ref: string): IgnoreFileRef {
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
export function collectIgnorePatterns(
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
        result.push(
          ..._parseIgnoreFile(deps.readFile(filePath)).map((pattern) => ({
            pattern,
            scope: "/",
          })),
        );
        break;
      }
      case "mount": {
        if (ref.recursive) {
          for (const absPath of deps.walkFiles(hostPath, ref.path)) {
            const dir = relative(hostPath, dirname(absPath));
            const scope = dir === "" ? "/" : `/${dir}`;
            result.push(
              ..._parseIgnoreFile(deps.readFile(absPath)).map((pattern) => ({
                pattern,
                scope,
              })),
            );
          }
        } else {
          const filePath = join(hostPath, ref.path);
          if (!deps.pathExists(filePath)) continue;
          result.push(
            ..._parseIgnoreFile(deps.readFile(filePath)).map((pattern) => ({
              pattern,
              scope: "/",
            })),
          );
        }
        break;
      }
    }
  }

  return result;
}

export function _parseIgnoreFile(contents: string): string[] {
  return contents
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"));
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

export const defaultIgnoreFileDeps: IgnoreFileDeps = {
  readFile: (p) => readFileSync(p, "utf-8"),
  pathExists: existsSync,
  walkFiles: walkFilesRecursive,
};
