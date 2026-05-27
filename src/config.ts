import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { scope, type } from "arktype";

// --- Schema (single source of truth for validation + types) ---

const AbsolutePath = type("string > 0").matching(/^\//);

const types = scope({
  AbsolutePath,
  /**
   * - readwrite: full read/write access to the host directory
   * - readonly: host directory is mounted read-only
   * - overlay: host directory is read-only, writes go to a persistent upper
   *   layer stored in .tuor/.state/overlays/
   * - overlay-tmpfs: like overlay but the upper layer is in-memory (lost on
   *   VM shutdown)
   */
  MountMode: "'readwrite' | 'readonly' | 'overlay' | 'overlay-tmpfs'",
  MountConfig: {
    /** Absolute path or path relative to directory containing config file */
    hostPath: "string > 0",
    /** If guestPath is not given explicitly, it will be the same path as on the host. */
    "guestPath?": "AbsolutePath",
    "mode": "MountMode = 'readonly'",
  },
  /**
   * When Nix support is enabled (by providing a NixConfig via `config.nix`),
   * the host's /nix will be mounted read-only into the guest.
   */
  NixConfig: {
    /**
     * Nix profile paths whose bin/ dirs go on PATH (must resolve to /nix/ via
     * symlinks). Auto-detected from $NIX_PROFILES if omitted.
     */
    "profiles?": "AbsolutePath[]",
    /** Mount /lib64 (read-only) for nix-ld dynamic linker support. */
    "nixLd": "boolean = false",
  },
  /**
   * Working directory inside the guest. Either just a guest path (string) to cd
   * into, or a full mount config (which also sets up the host→guest mount and
   * then cd's into the guest path).
   */
  WorkdirConfig: "AbsolutePath | MountConfig",
  TuorConfig: {
    /**
     * When `nix` is given (even if "empty", i.e. just {}), Nix support will be
     * enabled.
     */
    "nix?": "NixConfig",
    /** The user to open the shell under and to make mounted directories available for. */
    "user": "string > 0 = 'root'",
    "mounts?": "MountConfig[]",
    "workdir": "WorkdirConfig = '/'",
    /**
     * Minimum virtual disk size for the rootfs (e.g. "2G", "512M").
     * The COW overlay will be grown to at least this size before boot.
     * Actual host disk usage remains sparse (only written pages cost space).
     */
    "rootfsSize?": "string > 0",
  },
}).export();

type MountMode = typeof types.MountMode.infer;
type MountConfig = typeof types.MountConfig.infer;
type NixConfig = typeof types.NixConfig.infer;
type WorkdirConfig = typeof types.WorkdirConfig.infer;
type TuorConfig = typeof types.TuorConfig.infer;

export type {
  MountConfig,
  MountMode,
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
