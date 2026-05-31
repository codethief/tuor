import { existsSync, realpathSync } from "node:fs";
import type { NixConfig } from "./schema.ts";
import type { MountSpec } from "../core/mounts.ts";

// --- Types ---

type NixSetup = {
  mounts: MountSpec[];
  env: Record<string, string>;
  tlsSetupCommand: string;
};

export type NixDeps = {
  hostEnv: Record<string, string | undefined>;
  resolveProfiles: () => string[];
  realpath: (path: string) => string;
  nixExists: () => boolean;
  lib64Exists: () => boolean;
  warn: (message: string) => void;
};

// --- Public API ---

export function resolveNixSetup(
  config: NixConfig,
  deps: NixDeps = defaultNixDeps,
): NixSetup {
  if (!deps.nixExists()) {
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
    mounts: buildMounts(config, deps),
    env: buildEnv(profiles, deps.hostEnv, deps.realpath, deps.warn),
    tlsSetupCommand: TLS_SETUP_COMMAND,
  };
}

// --- Internals ---

const COMBINED_CA_BUNDLE = "/run/gondolin/nix-ca-bundle.crt";

const TLS_SETUP_COMMAND = [
  "cat /etc/ssl/certs/ca-certificates.crt /etc/gondolin/mitm/ca.crt",
  `> ${COMBINED_CA_BUNDLE}`,
].join(" ");

/**
 * Env vars to forward from the host, resolved through symlinks so they point
 * into /nix/store (which is mounted in the guest). Entries whose resolved path
 * doesn't land under /nix/ are dropped with a warning.
 *
 * "path-list" vars (like NIX_LD_LIBRARY_PATH) are colon-separated; each
 * component is resolved individually and non-/nix/ entries are filtered out.
 */
const FORWARDED_ENV_VARS: { key: string; kind: "path" | "path-list" }[] = [
  { key: "NIX_LD_LIBRARY_PATH", kind: "path-list" },
  { key: "LOCALE_ARCHIVE", kind: "path" },
  { key: "TZDIR", kind: "path" },
];


/**
 * Resolve explicit profile paths to their real paths, validating that each
 * resolves to somewhere under /nix/.
 */
function resolveExplicitProfiles(
  profiles: string[],
  deps: NixDeps,
): string[] {
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

function buildMounts(config: NixConfig, deps: NixDeps): MountSpec[] {
  const mounts: MountSpec[] = [
    { hostPath: "/nix", guestPath: "/nix", mode: "readonly", shadowPatterns: [] },
  ];

  if (config.nixLd) {
    if (!deps.lib64Exists()) {
      throw new Error(
        "nixLd is enabled but /lib64 does not exist on the host. " +
          "Is nix-ld installed?",
      );
    }
    mounts.push({ hostPath: "/lib64", guestPath: "/lib64", mode: "readonly", shadowPatterns: [] });
  }

  return mounts;
}

function buildEnv(
  profiles: string[],
  hostEnv: Record<string, string | undefined>,
  realpath: (path: string) => string,
  warn: (message: string) => void,
): Record<string, string> {
  const pathEntries = profiles.map((p) => `${p}/bin`);

  const env: Record<string, string> = {
    PATH: pathEntries.join(":"),
    NIX_SSL_CERT_FILE: COMBINED_CA_BUNDLE,
  };

  for (const { key, kind } of FORWARDED_ENV_VARS) {
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
  const nixProfiles = hostEnv["NIX_PROFILES"];
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
  resolveProfiles: () => _resolveDefaultProfiles(process.env),
  realpath: realpathSync,
  nixExists: () => existsSync("/nix"),
  lib64Exists: () => existsSync("/lib64"),
  warn: (message) => console.warn(`[nix] ${message}`),
};


