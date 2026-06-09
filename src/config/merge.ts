import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DEFAULT_IGNORE_FILE_REFS } from "./ignore-files.ts";
import type { MountConfig, NetworkConfig, TuorConfig } from "./schema.ts";

// --- Types ---

export type ConfigLayer = {
  config: TuorConfig;
  configDir: string;
};

// --- Public API ---

/**
 * Collect all config directories in merge order (most general first):
 * 1. ~/.config/tuor/ (home-level config)
 * 2. Ancestor .tuor/ directories, from root downward to closest
 *
 * The home config (~/.config/tuor/) is always first if it exists, even if the
 * CWD is inside the home directory (where it would also be found by the
 * directory walk). It is deduplicated so it only appears once.
 */
export function findAllConfigDirs(
  startDir: string,
  homeDir: string,
  exists: (path: string) => boolean = existsSync,
): string[] {
  const homeConfigDir = join(homeDir, ".config", "tuor");
  const result: string[] = [];

  // Home-level config first (most general)
  if (exists(join(homeConfigDir, "config.json"))) {
    result.push(homeConfigDir);
  }

  // Walk up from startDir, collecting .tuor/ dirs (reversed at the end so
  // root-most comes first)
  const ancestors: string[] = [];
  let dir = resolve(startDir);
  while (true) {
    const candidate = join(dir, ".tuor");
    if (exists(join(candidate, "config.json")) && candidate !== homeConfigDir) {
      ancestors.push(candidate);
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  ancestors.reverse(); // root-most first, closest last
  result.push(...ancestors);

  return result;
}

/**
 * Merge multiple config layers (ordered most general → most specific).
 *
 * Before merging, relative paths in each layer's mounts and workdir are
 * resolved to absolute using that layer's configDir, so path resolution stays
 * correct after configs are combined. `host:` ignoreFileRefs are similarly
 * pre-resolved.
 */
export function mergeConfigs(layers: ConfigLayer[]): TuorConfig {
  if (layers.length === 0) {
    throw new Error("mergeConfigs requires at least one config layer");
  }
  if (layers.length === 1) {
    return preResolvePaths(layers[0]!);
  }

  let merged = preResolvePaths(layers[0]!);
  for (let i = 1; i < layers.length; i++) {
    merged = mergeTwoConfigs(merged, preResolvePaths(layers[i]!));
  }
  return merged;
}

// --- Internals ---

/** Merge two configs where `child` overrides `parent`. */
function mergeTwoConfigs(parent: TuorConfig, child: TuorConfig): TuorConfig {
  return {
    // Scalars: child wins (fall back to parent for defaults)
    user: child.user,
    workdir: child.workdir,
    ...lastDefined(child.guestHomeDir, parent.guestHomeDir, "guestHomeDir"),
    ...lastDefined(child.rootfsSize, parent.rootfsSize, "rootfsSize"),
    ...lastDefined(child.nix, parent.nix, "nix"),

    // Arrays: concatenate
    ...mergeArrayField(parent.mounts, child.mounts, "mounts"),
    ...mergeArrayField(parent.volumes, child.volumes, "volumes"),

    // Objects: shallow merge
    ...mergeEnv(parent.env, child.env),

    // Network: merge mode + concatenate host lists
    ...mergeNetwork(parent.network, child.network),
  };
}

function lastDefined<K extends string, V>(
  childVal: V | undefined,
  parentVal: V | undefined,
  key: K,
): Record<K, V> | Record<string, never> {
  const val = childVal ?? parentVal;
  if (val === undefined) return {} as Record<string, never>;
  return { [key]: val } as Record<K, V>;
}

function mergeArrayField<K extends string, T>(
  parentArr: T[] | undefined,
  childArr: T[] | undefined,
  key: K,
): Record<K, T[]> | Record<string, never> {
  const merged = [...(parentArr ?? []), ...(childArr ?? [])];
  if (merged.length === 0) return {} as Record<string, never>;
  return { [key]: merged } as Record<K, T[]>;
}

function mergeEnv(
  parentEnv: TuorConfig["env"],
  childEnv: TuorConfig["env"],
): { env: TuorConfig["env"] } | Record<string, never> {
  if (!parentEnv && !childEnv) return {} as Record<string, never>;
  return { env: { ...parentEnv, ...childEnv } };
}

function mergeNetwork(
  parentNet: NetworkConfig | undefined,
  childNet: NetworkConfig | undefined,
): { network: NetworkConfig } | Record<string, never> {
  if (!parentNet && !childNet) return {} as Record<string, never>;
  if (!parentNet) return { network: childNet! };
  if (!childNet) return { network: parentNet };

  // Child mode wins
  if (childNet.mode === "open" || parentNet.mode === "open") {
    return { network: childNet };
  }

  // Both restricted: concatenate host lists
  return {
    network: {
      mode: "restricted",
      ...mergeStringArrayField(
        parentNet.allowedHosts,
        childNet.allowedHosts,
        "allowedHosts",
      ),
      ...mergeStringArrayField(
        parentNet.allowedInternalHosts,
        childNet.allowedInternalHosts,
        "allowedInternalHosts",
      ),
    },
  };
}

function mergeStringArrayField<K extends string>(
  parentArr: string[] | undefined,
  childArr: string[] | undefined,
  key: K,
): Record<K, string[]> | Record<string, never> {
  const merged = [...new Set([...(parentArr ?? []), ...(childArr ?? [])])];
  if (merged.length === 0) return {} as Record<string, never>;
  return { [key]: merged } as Record<K, string[]>;
}

/**
 * Pre-resolve relative paths in a config layer so they become absolute,
 * independent of configDir.
 */
function preResolvePaths(layer: ConfigLayer): TuorConfig {
  const { config, configDir } = layer;

  return {
    ...config,
    ...(config.mounts
      ? { mounts: config.mounts.map((m) => preResolveMountPaths(m, configDir)) }
      : {}),
    ...(typeof config.workdir === "object"
      ? { workdir: preResolveMountPaths(config.workdir, configDir) }
      : {}),
  };
}

function preResolveMountPaths(m: MountConfig, configDir: string): MountConfig {
  const hostPath = isTildePath(m.hostPath)
    ? m.hostPath
    : resolve(configDir, m.hostPath);

  // Pre-resolve host: ignoreFileRefs so they don't depend on configDir later
  const rawRefs = m.ignoreFileRefs ?? DEFAULT_IGNORE_FILE_REFS;
  const ignoreFileRefs = rawRefs.map((ref) =>
    preResolveIgnoreFileRef(ref, configDir),
  );

  return {
    ...m,
    hostPath,
    ignoreFileRefs,
  };
}

function preResolveIgnoreFileRef(ref: string, configDir: string): string {
  if (!ref.startsWith("host:")) return ref;
  const path = ref.slice("host:".length);
  if (path.startsWith("/")) return ref; // already absolute
  return `host:${resolve(configDir, path)}`;
}

function isTildePath(p: string): boolean {
  return p.startsWith("~") && (p.length === 1 || p[1] === "/");
}
