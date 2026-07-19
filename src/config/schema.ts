import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { scope, type } from "arktype";

const types = scope({
  // --------------------------------------------------------------------------
  // Config root
  // --------------------------------------------------------------------------

  TuorConfig: {
    "+": "reject",

    /**
     * Shell commands run once, as root, right after the VM boots and before the
     * interactive shell / user command starts. Each entry is a command line
     * executed via `sh -c` in the configured `workdir`. Useful for provisioning
     * the guest (installing packages, seeding directories, …).
     *
     * Commands run in order; if any exits non-zero, boot is aborted and the VM
     * is shut down (fail fast) so the workload never runs in a half-provisioned
     * guest. Across config layers the lists are concatenated (parent first).
     */
    "bootCommands?": "(string > 0)[]",

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
     * Low-level QEMU tuning (accel/cpu/machine type). Mainly useful to speed up
     * software emulation when the host has no KVM — see QemuConfig.
     */
    "qemu?": "QemuConfig",

    /**
     * VM resource sizing (RAM, vCPU count, rootfs disk size).
     */
    "resources?": "ResourcesConfig",

    /**
     * The user to open the shell under and to make mounted directories
     * available for. Must currently be root due to Gondolin-related
     * constraints.
     *
     * Optional (no schema default): the "root" default is applied post-merge in
     * applyConfigDefaults, so an inherited value isn't clobbered by a child
     * layer that merely omitted the field.
     */
    "user?": "string > 0",

    /**
     * Volumes are host-backed, initially empty directories that the VM guest
     * can persist files in. They are stored in `.tuor/.state/overlays/`.
     */
    "volumes?": "VolumeConfig[]",

    /**
     * Configure the default working directory for the VM guest.
     *
     * Optional (no schema default): the "/" default is applied post-merge in
     * applyConfigDefaults, so an inherited value isn't clobbered by a child
     * layer that merely omitted the field.
     */
    "workdir?": "WorkdirConfig",
  },

  // --------------------------------------------------------------------------
  // Environment variables
  // --------------------------------------------------------------------------

  /**
   * Env var sourced from the host or given an explicit value.
   * - `value` omitted → read the host env var named like the (guest) key
   * - `value` present → used as-is (already `$VAR`-interpolated at load time)
   *
   * (A bare string is the common shorthand for `{ value: "…" }`.)
   */
  EnvFromHost: {
    "+": "reject",
    "value?": "string",
  },
  /**
   * Env var injected as a Gondolin secret: the guest sees a placeholder; the
   * real value is substituted only in HTTP requests to `injectForHosts`.
   * `value` is sourced as for {@link EnvFromHost} (omit it to read the host
   * env var named like the key).
   */
  EnvSecret: {
    "+": "reject",
    "value?": "string",
    secret: "true",
    /** Host patterns allowed to receive this secret (wildcard supported). */
    injectForHosts: "string[] > 0",
  },
  /** An env var value: a literal/interpolated string, host-sourced, or a secret. */
  EnvValue: "string | EnvSecret | EnvFromHost",

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

  // --------------------------------------------------------------------------
  // QEMU tuning
  // --------------------------------------------------------------------------

  /**
   * QEMU knobs, forwarded verbatim to Gondolin's
   * `sandbox.{accel,cpu,machineType}`. Any field left unset falls back to
   * Gondolin's own auto-selection (which already detects /dev/kvm and picks kvm
   * vs. software emulation accordingly). We ship no defaults of our own.
   *
   * In case of software emulation (tcg), it might be worth increasing QEMU's
   * host-side translation block cache (tb-size) by setting e.g.
   * ```
   * accel: "tcg,tb-size=1024"
   * ```
   */
  QemuConfig: {
    "+": "reject",
    /**
     * QEMU `-accel` string, including sub-options, e.g.
     * "tcg,tb-size=1024" or "kvm".
     */
    "accel?": "string > 0",
    /** QEMU `-cpu` model, e.g. "host", "max", "qemu64". */
    "cpu?": "string > 0",
    /** QEMU `-machine` type, e.g. "q35", "microvm", "virt". */
    "machineType?": "string > 0",
  },

  // --------------------------------------------------------------------------
  // VM resources
  // --------------------------------------------------------------------------

  /**
   * VM resource sizing, forwarded verbatim to Gondolin.
   */
  ResourcesConfig: {
    "+": "reject",
    /**
     * VM RAM in QEMU syntax: a positive integer with an optional K/M/G/T
     * suffix, e.g. "512M", "2G". Maps to Gondolin's `memory` top-level option.
     * Gondolin default: "1G".
     */
    "memory?": type("string > 0").matching(/^\d+[KMGT]?$/i),
    /**
     * VM vCPU count (positive integer). Maps to Gondolin's `cpus` top-level
     * option. Gondolin default: 2. Note that this config option is distinct
     * from `QemuConfig.cpu` (the emulated CPU *model*)!
     */
    "cpus?": "number.integer >= 1",
    /**
     * Minimum virtual disk size for the rootfs (e.g. "2G", "512M"). The COW
     * overlay will be grown to at least this size before boot. Actual host disk
     * usage remains sparse (only written pages cost space). The config option
     * maps to Gondolin's `rootfs.size` and defaults to the size of the base
     * image used by Gondolin (no minimum growth).
     */
    "rootfsSize?": "string > 0",
  },
}).export();

export type VolumeConfig = typeof types.VolumeConfig.infer;
export type MountConfig = typeof types.MountConfig.infer;
export type NixConfig = typeof types.NixConfig.infer;
export type QemuConfig = typeof types.QemuConfig.infer;
export type ResourcesConfig = typeof types.ResourcesConfig.infer;
export type NetworkConfig = typeof types.NetworkConfig.infer;
export type EnvFromHost = typeof types.EnvFromHost.infer;
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
