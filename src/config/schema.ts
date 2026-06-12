import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { scope, type } from "arktype";

const types = scope({
  // --------------------------------------------------------------------------
  // Config root
  // --------------------------------------------------------------------------

  TuorConfig: {
    "+": "reject",

    /** Environment variables to set in the guest. */
    "env?": { "[string]": "EnvValue" },

    /**
     * Override the assumed guest user home directory (used for ~ expansion in
     * guestPaths). Defaults to /root when config.user = root, /home/$user
     * otherwise.
     */
    "guestHomeDir?": "AbsolutePath",

    /**
     * Mount existing host directories in the VM guest's file system.
     */
    "mounts?": "MountConfig[]",

    /** Network egress policy for the VM. Defaults to restricted (block all). */
    "network?": "NetworkConfig",

    /**
     * When `nix` is given (even if "empty", i.e. just {}), Nix convenience mode
     * (see below) will be enabled.
     */
    "nix?": "NixConfig",

    /**
     * Minimum virtual disk size for the rootfs (e.g. "2G", "512M").
     * The COW overlay will be grown to at least this size before boot.
     * Actual host disk usage remains sparse (only written pages cost space).
     */
    "rootfsSize?": "string > 0",

    /**
     * The user to open the shell under and to make mounted directories
     * available for. Must currently be root due to Gondolin-related
     * constraints.
     */
    user: "string > 0 = 'root'",

    /**
     * Volumes are host-backed, initially empty directories that the VM guest
     * can persist files in. They are stored in `.tuor/.state/overlays/`.
     */
    "volumes?": "VolumeConfig[]",

    /**
     * Configure the default working directory for the VM guest
     */
    workdir: "WorkdirConfig = '/'",
  },

  // --------------------------------------------------------------------------
  // Environment variables
  // --------------------------------------------------------------------------

  /**
   * Env var sourced from the host environment.
   * - `{ fromHost: true }` reads the var with the same name from the host env
   * - `{ fromHost: "OTHER_NAME" }` reads OTHER_NAME from the host env
   */
  EnvValueFromHost: {
    "+": "reject",
    fromHost: "string > 0 | true",
  },
  /**
   * Env var injected as a Gondolin secret: the guest sees a placeholder; the
   * real value is substituted only in HTTP requests to the listed hosts.
   */
  EnvSecret: {
    "+": "reject",
    secret: "true",
    fromHost: "string > 0 | true",
    /** Host patterns allowed to receive this secret (wildcard supported). */
    hosts: "string[] > 0",
  },
  /** An env var value: literal, host-sourced, or a secret. */
  EnvValue: "string | EnvValueFromHost | EnvSecret",

  // --------------------------------------------------------------------------
  // Mounting & volumes, working directory
  // --------------------------------------------------------------------------

  MountConfig: {
    "+": "reject",
    /** Absolute path or path relative to directory containing config file */
    hostPath: "string > 0",
    /**
     * If guestPath is not given explicitly, it will be the same path as on the
     * host.
     */
    "guestPath?": "AbsolutePath | TildePath",
    mode: "MountMode = 'readonly'",
    /**
     * Patterns to hide from the guest. Bare names (e.g. ".env") match at any
     * depth; paths containing "/" are anchored to the mount root. A trailing
     * "/" is stripped (exception: bare "/"). Write operations to hidden files
     * will fail, unless `mode` is one of the overlay modes.
     */
    "ignore?": "string[] > 0",
    /**
     * References to ignore files (one path per line, # comments).
     * Each entry is prefixed with a source:
     * - "host:<path>" — resolved relative to .tuor/ config dir (or absolute)
     * - "mount:<path>" — resolved within the mounted host directory;
     *   relative paths (e.g. "mount:.tuorignore") trigger recursive lookup,
     *   absolute paths (e.g. "mount:/.tuorignore") match a single file.
     *
     * Loaded once at boot; changes require VM restart.
     */
    "ignoreFileRefs?": "(string > 0)[]",
  },
  VolumeConfig: {
    "+": "reject",
    guestPath: "AbsolutePath | TildePath",
  },
  /**
   * Working directory inside the guest. Either just a guest path (string) to cd
   * into, or a full mount config (which also sets up the host→guest mount and
   * then cd's into the guest path).
   */
  WorkdirConfig: "AbsolutePath | TildePath | MountConfig",

  /** Path starting with / */
  AbsolutePath: type("string > 0").matching(/^\//),
  /**
   * Path starting with ~ (bare "~" or "~/…"), expanded either on the host or on
   * the guest (see config.guestHomeDir).
   */
  TildePath: type("string > 0").matching(/^~(\/|$)/),

  /**
   * - readwrite: full read/write access to the host directory
   * - readonly: host directory is mounted read-only
   * - overlay: host directory is read-only, writes go to a persistent upper
   *   layer stored in .tuor/.state/overlays/
   * - overlay-tmpfs: like overlay but the upper layer is in-memory (lost on
   *   VM shutdown)
   */
  MountMode: "'readwrite' | 'readonly' | 'overlay' | 'overlay-tmpfs'",

  // --------------------------------------------------------------------------
  // Network
  // --------------------------------------------------------------------------

  /**
   * Network mode: unrestricted access (`open`) or restricted to an allowlist of
   * hosts that the guest can connect to via HTTP/HTTPS.
   */
  NetworkConfig: [
    { "+": "reject", mode: "'open'" },
    "|",
    {
      "+": "reject",
      mode: "'restricted'",
      /**
       * Host patterns allowed for HTTPS egress (wildcard supported, e.g.
       * "*.github.com"). Gondolin's createHttpHooks handles matching.
       */
      "allowedHosts?": "string[]",
      /**
       * Internal hosts to be exempted from Gondolin's blockInternalRanges
       * features, which disallows traffic to internal/private IP ranges
       * (RFC1918, loopback, etc.). Uses the same wildcard syntax as
       * allowedHosts.
       */
      "allowedInternalHosts?": "string[]",
    },
  ],

  // --------------------------------------------------------------------------
  // NixOS convenience mode
  // --------------------------------------------------------------------------

  /**
   * When a Nix config is present, Tuor will
   * - mount /nix into the VM read-only.
   * - in the guest set NIX_SSL_CERT_FILE to Gondolin's certificate bundle,
   *   which contains the cert required for intercepting HTTPS requests.
   * - forward host env variables (LOCALE_ARCHIVE, TZDIR) to the guest, after
   *   resolving them to /nix/store paths, if possible.
   */
  NixConfig: {
    "+": "reject",
    /**
     * Nix profile paths whose bin/ dirs go on PATH (must resolve to /nix/ via
     * symlinks). Auto-detected from $NIX_PROFILES if omitted.
     */
    "profiles?": "AbsolutePath[]",
    /**
     * Enable nix-ld support:
     * - Mount /lib64 (read-only)
     * - Forward NIX_LD_LIBRARY_PATH env var to the guest, after resolving it to
     *   a /nix/store path.
     */
    nixLd: "boolean = false",
  },
}).export();

export type VolumeConfig = typeof types.VolumeConfig.infer;
export type MountConfig = typeof types.MountConfig.infer;
export type NixConfig = typeof types.NixConfig.infer;
export type NetworkConfig = typeof types.NetworkConfig.infer;
export type EnvValueFromHost = typeof types.EnvValueFromHost.infer;
export type EnvSecret = typeof types.EnvSecret.infer;
export type EnvValue = typeof types.EnvValue.infer;
export type WorkdirConfig = typeof types.WorkdirConfig.infer;
export type TuorConfig = typeof types.TuorConfig.infer;

export function findConfigDir(
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

export function parseConfig(raw: unknown): TuorConfig {
  const result = types.TuorConfig(raw);
  if (result instanceof type.errors) {
    throw new Error(result.summary);
  }
  return result;
}
