import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { scope, type } from "arktype";

// --- Schema (single source of truth for validation + types) ---

const AbsolutePath = type("string > 0").matching(/^\//);

const types = scope({
  AbsolutePath,
  MountConfig: {
    hostPath: "string > 0",
    "guestPath?": "AbsolutePath",
    "readOnly": "boolean = false",
  },
  NixConfig: {
    /** Nix profile paths whose bin/ dirs go on PATH (must resolve to /nix/ via symlinks). Auto-detected from $NIX_PROFILES if omitted. */
    "profiles?": "AbsolutePath[]",
    /** Mount /lib64 for nix-ld dynamic linker support. */
    "nixLd": "boolean = false",
  },
  /**
   * Working directory inside the guest. Either just a guest path (string) to cd
   * into, or a full mount config (which also sets up the host→guest mount and
   * then cd's into the guest path).
   */
  WorkdirConfig: "AbsolutePath | MountConfig",
  TuorConfig: {
    "nix?": "NixConfig",
    "user": "string > 0 = 'root'",
    "mounts?": "MountConfig[]",
    "workdir": "WorkdirConfig = '/'",
  },
}).export();

type MountConfig = typeof types.MountConfig.infer;
type NixConfig = typeof types.NixConfig.infer;
type WorkdirConfig = typeof types.WorkdirConfig.infer;
type TuorConfig = typeof types.TuorConfig.infer;

export type {
  MountConfig,
  NixConfig,
  TuorConfig,
  WorkdirConfig,
};

// --- Config discovery ---

function findConfigDir(
  startDir: string,
  exists: (path: string) => boolean = existsSync,
): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (exists(join(dir, ".tuor", "config.json"))) {
      return join(dir, ".tuor");
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

// --- Config parsing ---

function parseConfig(raw: unknown): TuorConfig {
  const result = types.TuorConfig(raw);
  if (result instanceof type.errors) {
    throw new Error(result.summary);
  }
  return result;
}

export { findConfigDir, parseConfig };
