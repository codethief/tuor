import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { scope, type } from "arktype";
import { SIZE_FORMAT } from "../core/image.ts";

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
     * VM resource sizing (RAM, vCPU count).
     */
    "resources?": "ResourcesConfig",

    /**
     * Root filesystem configuration: base image and/or size.
     */
    "rootfs?": "RootfsConfig",

    /**
     * The user (as numeric uid/gid) that the guest shell runs under.
     */
    "guestUser?": "GuestUserConfig",

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
  // Guest user
  // --------------------------------------------------------------------------

  /**
   * The user the guest shell runs under, as numeric uid/gid. Enforced to root
   * (`{ uid: 0, gid: 0 }`) for now.
   */
  GuestUserConfig: {
    "+": "reject",
    uid: "0",
    gid: "0",
    /**
     * Override the guest user's home directory (used for `~` expansion in guest
     * paths). Defaults to /root (only root is supported for now).
     */
    "homedir?": "AbsolutePath",
  },

  /**
   * Ownership (numeric uid/gid) presented to the guest for a mount's or volume's
   * entries. Each field is optional and falls back to the guest user's uid/gid
   * (`guestUser`).
   *
   * This is display-only: it changes what the guest sees via stat(); it does not
   * change on-host ownership.
   */
  OwnerConfig: {
    "+": "reject",
    "uid?": "number.integer >= 0",
    "gid?": "number.integer >= 0",
  },

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
    /**
     * Ownership (uid/gid) presented to the guest for this mount's entries.
     * Defaults to the guest user (`guestUser`). Display-only — see OwnerConfig.
     */
    "owner?": "OwnerConfig",
  },
  VolumeConfig: {
    "+": "reject",
    guestPath: "AbsolutePath | TildePath",
    /**
     * Ownership (uid/gid) presented to the guest for this volume's entries.
     * Defaults to the guest user (`guestUser`). Display-only — see OwnerConfig.
     */
    "owner?": "OwnerConfig",
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
   * the guest (see config.guestUser.homedir).
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
  },

  // --------------------------------------------------------------------------
  // Root filesystem
  // --------------------------------------------------------------------------

  /**
   * Root filesystem: which image the guest boots from and how big its disk is.
   *
   * NOTE: This is Tuor's config type — it is distinct from Gondolin's own
   * build-time `RootfsConfig` (`{ label, sizeMb }`) and from Gondolin's runtime
   * `rootfs.{mode,size}` VM option, both of which it feeds into.
   */
  RootfsConfig: {
    "+": "reject",
    /**
     * Source image for the guest rootfs. Omit to boot Gondolin's default
     * `alpine-base` image.
     */
    "image?": "RootfsImageConfig",
    /**
     * Target rootfs size in QEMU-compatible syntax: a positive integer with a
     * *mandatory* K/M/G/T suffix, e.g. "512M", "8G".
     *
     * The setting will only ever grow the rootfs, never shrink it, and is
     * applied at different stages, depending on `rootfs.image`:
     * - No custom `image` set => The disk is *grown* at runtime (using Gondolin
     *   `rootfs.size`), which requires `resize2fs` to be installed in the
     *   guest. Note that this currently doesn't work due to
     *   https://github.com/earendil-works/gondolin/issues/132
     * - Custom `image` set => The size gets baked into the image at build time
     *   (Gondolin `rootfs.sizeMb`), so no in-guest `resize2fs` is needed (which
     *   minimal/distroless images typically lack).
     *
     * The filesystem is sparse either way, so a large (but mostly empty) rootfs
     * won't take up more host disk space.
     */
    "size?": type("string > 0").matching(SIZE_FORMAT),
  },
  /**
   * An optional OCI image to build the guest rootfs from. Essentially a config
   * setting for https://earendil-works.github.io/gondolin/custom-images/ .
   *
   * Note that the choice of image doesn't affect the guest kernel which is
   * always taken from Alpine.
   *
   * Tuor builds the VM image from the OCI image on first use and caches them in
   * Gondolin's content-addressed image store (`~/.cache/gondolin/images`, or
   * `$GONDOLIN_IMAGE_STORE`) under a `tuor/<hash>:latest` ref,  where `<hash>`
   * covers the image ref, the architecture, `rootfs.size` and the Gondolin
   * version. The caching can be fine-tuned using `buildPolicy` and
   * `pullPolicy`, see below.
   *
   * Host requirements:
   * - `cpio`
   * - `lz4`
   * - `mke2fs` or `mkfs.ext4`
   * - `debugfs`
   *
   * On Debian/Ubuntu: `apt install cpio lz4 e2fsprogs`.
   */
  RootfsImageConfig: {
    "+": "reject",
    /**
     * The OCI image to be used for the rootfs. The architecture is always the
     * host's — cross-arch builds are not supported.
     *
     * Format: `repo/name[:tag]` or `repo/name@sha256:…`
     */
    ref: "string > 0",
    /**
     * Container engine used to pull & export the OCI image. Maps to Gondolin's
     * `oci.runtime`. Omit to let Gondolin auto-detect (docker, else podman).
     */
    "engine?": "'docker' | 'podman'",
    /**
     * When to trigger a rebuild of the rootfs image from the OCI image. Allowed
     * values:
     *
     * - always: rebuild the rootfs image every run. Combine with `pullPolicy`
     *   to say where the image itself comes from — "always" to track a moving
     *   tag, "never" to rebuild from whatever is in the local store.
     * - if-not-present: build once per (ref, arch, size, gondolin version),
     *   then reuse. Since `ref` — not the OCI image contents — is the cache
     *   identity, a changed `:latest` tag in your engine's local image store
     *   will *not* invalidate the VM build.
     *
     * Note that Tuor currently does not prune old images from Gondolin's image
     * store, nor from Docker/Podman's.
     */
    buildPolicy: "'always' | 'if-not-present' = 'if-not-present'",
    /**
     * Whether to fetch `ref` fresh from its registry, for the runs on which
     * Tuor actually builds the rootfs image (see `buildPolicy`). Maps to
     * Gondolin's `oci.pullPolicy`. Allowed values:
     *
     * - always: pull afresh, so a mutable tag picks up its current contents.
     * - if-not-present: pull only when the engine's local image store has no
     *   `ref`. Mutable tags like `:latest` are not refreshed.
     * - never: use the engine's local image store only, and fail if `ref` isn't
     *   in it.
     */
    pullPolicy: "'always' | 'if-not-present' | 'never' = 'if-not-present'",
  },
}).export();

export type GuestUserConfig = typeof types.GuestUserConfig.infer;
export type OwnerConfig = typeof types.OwnerConfig.infer;
export type VolumeConfig = typeof types.VolumeConfig.infer;
export type MountConfig = typeof types.MountConfig.infer;
export type NixConfig = typeof types.NixConfig.infer;
export type QemuConfig = typeof types.QemuConfig.infer;
export type ResourcesConfig = typeof types.ResourcesConfig.infer;
export type RootfsConfig = typeof types.RootfsConfig.infer;
export type RootfsImageConfig = typeof types.RootfsImageConfig.infer;
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
