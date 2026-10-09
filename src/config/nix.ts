import { existsSync, realpathSync } from "node:fs";
import { dirname } from "node:path";
import type { MountSpec, Owner } from "../core/mounts.ts";
import type { NixConfig } from "./schema.ts";

// --- Types ---

type NixSetup = {
  mounts: MountSpec[];
  env: Record<string, string>;
  /** Shell commands that must run in the guest before the workload starts. */
  bootCommands: string[];
};

export type NixDeps = {
  hostEnv: Record<string, string | undefined>;
  hostArch: string;
  resolveProfiles: () => string[];
  realpath: (path: string) => string;
  pathExists: (path: string) => boolean;
  warn: (message: string) => void;
};

// --- Public API ---

export function resolveNixSetup(
  config: NixConfig,
  deps: NixDeps = defaultNixDeps,
  defaultOwner: Owner = { uid: 0, gid: 0 },
): NixSetup {
  if (!deps.pathExists("/nix")) {
    throw new Error("/nix does not exist on the host. Is Nix installed?");
  }

  const profiles = config.profiles
    ? resolveExplicitProfiles(config.profiles, deps)
    : deps.resolveProfiles();
  if (profiles.length === 0) {
    throw new Error(
      "No Nix profiles found. Set $NIX_PROFILES or specify profiles in the nix config.",
    );
  }

  return {
    mounts: buildMounts(defaultOwner),
    env: buildEnv(config, profiles, deps.hostEnv, deps.realpath, deps.warn),
    bootCommands: buildNixLdBootCommands(config, deps),
  };
}

// --- Internals ---

/** Gondolin's init script merges system + MITM CAs into this bundle. */
const GONDOLIN_CA_BUNDLE = "/run/gondolin/ca-certificates.crt";

/**
 * An env var forwarded from the host, resolved through symlinks so it points
 * into /nix/store (which is mounted in the guest). Values whose resolved path
 * doesn't land under /nix/ are dropped with a warning.
 *
 * "path-list" vars are colon-separated; each component is resolved
 * individually and non-/nix/ entries are filtered out.
 */
type ForwardedEnvVar = { key: string; kind: "path" | "path-list" };

/** Forwarded whenever Nix mode is enabled. */
const FORWARDED_ENV_VARS: ForwardedEnvVar[] = [
  { key: "LOCALE_ARCHIVE", kind: "path" },
  { key: "TZDIR", kind: "path" },
];

/**
 * Env vars that configure nix-ld itself, so they are only forwarded when
 * `nixLd` is enabled. NIX_LD names the real glibc loader that the shim hands
 * off to — without it the shim aborts, so forwarding it is not optional.
 */
const NIX_LD_ENV_VARS: ForwardedEnvVar[] = [
  { key: "NIX_LD", kind: "path" },
  { key: "NIX_LD_LIBRARY_PATH", kind: "path-list" },
];

/**
 * Resolve explicit profile paths to their real paths, validating that each
 * resolves to somewhere under /nix/.
 */
function resolveExplicitProfiles(profiles: string[], deps: NixDeps): string[] {
  return profiles.map((p) => {
    const resolved = deps.realpath(p);
    if (!resolved.startsWith("/nix/")) {
      throw new Error(
        `Nix profile "${p}" resolves to "${resolved}", which is not under /nix/.`,
      );
    }
    return resolved;
  });
}

/**
 * Full path of the glibc dynamic loader, which nix-ld replaces with its own
 * shim. Both the directory and the file name are arch-dependent: x86-64 puts
 * the loader in /lib64/ld-linux-x86-64.so.2, aarch64 in
 * /lib/ld-linux-aarch64.so.1.
 *
 * Takes a Node.js `process.arch` value.
 */
export function _loaderPath(hostArch: string): string {
  switch (hostArch) {
    case "x64":
      return "/lib64/ld-linux-x86-64.so.2";
    case "arm64":
      return "/lib/ld-linux-aarch64.so.1";
    default:
      throw new Error(
        `nixLd is enabled but the host architecture "${hostArch}" is not ` +
          "supported. Supported architectures: x64, arm64.",
      );
  }
}

/**
 * Symlink nix-ld's shim into place inside the guest.
 *
 * We deliberately do *not* mount the host's loader directory onto the guest's.
 * On aarch64 that directory is /lib, which in the guest holds musl's own
 * loader plus /lib/apk and /lib/modules; shadowing it leaves the guest unable
 * to exec anything at all. Linking the single file we actually need sidesteps
 * that, and costs no extra mount: the shim lives in /nix/store, which Nix mode
 * already mounts.
 */
function buildNixLdBootCommands(config: NixConfig, deps: NixDeps): string[] {
  if (!config.nixLd) return [];

  const loaderPath = _loaderPath(deps.hostArch);
  if (!deps.pathExists(loaderPath)) {
    throw new Error(
      `nixLd is enabled but ${loaderPath} does not exist on the host. ` +
        "Is nix-ld installed?",
    );
  }

  // The host's loader is a symlink into /nix/store; resolve it so the guest
  // link points at something reachable through the /nix mount.
  const target = deps.realpath(loaderPath);
  if (!target.startsWith("/nix/")) {
    throw new Error(
      `nixLd is enabled but ${loaderPath} resolves to "${target}", which is ` +
        "not under /nix/ and therefore not reachable inside the guest.",
    );
  }

  return [`mkdir -p ${dirname(loaderPath)} && ln -sf ${target} ${loaderPath}`];
}

function buildMounts(defaultOwner: Owner): MountSpec[] {
  return [
    {
      hostPath: "/nix",
      guestPath: "/nix",
      mode: "readonly",
      shadowPatterns: [],
      owner: defaultOwner,
    },
  ];
}

function buildEnv(
  config: NixConfig,
  profiles: string[],
  hostEnv: Record<string, string | undefined>,
  realpath: (path: string) => string,
  warn: (message: string) => void,
): Record<string, string> {
  const pathEntries = profiles.map((p) => `${p}/bin`);

  const env: Record<string, string> = {
    PATH: pathEntries.join(":"),
    NIX_SSL_CERT_FILE: GONDOLIN_CA_BUNDLE,
  };

  const forwarded = config.nixLd
    ? [...FORWARDED_ENV_VARS, ...NIX_LD_ENV_VARS]
    : FORWARDED_ENV_VARS;

  for (const { key, kind } of forwarded) {
    const value = hostEnv[key];
    if (value === undefined) continue;

    if (kind === "path") {
      const resolved = resolveToNixStore(value, key, realpath, warn);
      if (resolved !== undefined) {
        env[key] = resolved;
      }
    } else {
      const entries = value.split(":").filter(Boolean);
      const resolved = entries
        .map((entry) => resolveToNixStore(entry, key, realpath, warn))
        .filter((r): r is string => r !== undefined);
      if (resolved.length > 0) {
        env[key] = resolved.join(":");
      }
    }
  }

  return env;
}

/**
 * Resolve a path through symlinks; return it only if it lands under /nix/.
 * Warns when a path is dropped (doesn't resolve under /nix/ or doesn't exist).
 */
function resolveToNixStore(
  path: string,
  envVar: string,
  realpath: (p: string) => string,
  warn: (message: string) => void,
): string | undefined {
  try {
    const resolved = realpath(path);
    if (resolved.startsWith("/nix/")) {
      return resolved;
    }
    warn(
      `${envVar}: dropping "${path}" (resolves to "${resolved}", which is not under /nix/)`,
    );
    return undefined;
  } catch {
    warn(`${envVar}: dropping "${path}" (path does not exist)`);
    return undefined;
  }
}

// --- Default deps ---

/**
 * Resolve Nix profiles from $NIX_PROFILES. Each entry is resolved to its real
 * path (following symlinks) so it points into /nix/store, which is accessible
 * via the /nix mount. Entries that don't exist or don't have a bin/ dir are
 * skipped.
 */
export function _resolveDefaultProfiles(
  hostEnv: Record<string, string | undefined>,
): string[] {
  const nixProfiles = hostEnv.NIX_PROFILES;
  if (!nixProfiles) {
    return [];
  }

  const profiles: string[] = [];
  for (const entry of nixProfiles.split(/\s+/).filter(Boolean)) {
    try {
      const resolved = realpathSync(entry);
      if (existsSync(`${resolved}/bin`)) {
        profiles.push(resolved);
      }
    } catch {
      // Entry doesn't exist, skip
    }
  }
  return profiles;
}

const defaultNixDeps: NixDeps = {
  hostEnv: process.env,
  hostArch: process.arch,
  resolveProfiles: () => _resolveDefaultProfiles(process.env),
  realpath: realpathSync,
  pathExists: existsSync,
  warn: (message) => console.warn(`[nix] ${message}`),
};
