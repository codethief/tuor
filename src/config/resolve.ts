import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type {
  MountSpec,
  MountValidationDeps,
  VolumeSpec,
} from "../core/mounts.ts";
import { validateMounts } from "../core/mounts.ts";
import type {
  QemuSpec,
  ResourcesSpec,
  SecretSpec,
  SessionSpec,
} from "../core/session.ts";
import type { ScopedPattern } from "../core/shadow.ts";
import type { DefaultedConfig } from "./defaults.ts";
import { expandTilde } from "./homedir.ts";
import {
  collectIgnorePatterns,
  DEFAULT_IGNORE_FILE_REFS,
  defaultIgnoreFileDeps,
  type IgnoreFileDeps,
  parseIgnoreFileRef,
} from "./ignore-files.ts";
import { type NixDeps, resolveNixSetup } from "./nix.ts";
import type {
  EnvValue,
  MountConfig,
  TuorConfig,
  VolumeConfig,
  WorkdirConfig,
} from "./schema.ts";
import { getOverlaysDir } from "./state-dir.ts";

// --- Types ---

export type ResolveDeps = {
  mountValidation: MountValidationDeps;
  ignoreFile: IgnoreFileDeps;
  nix?: NixDeps;
  hostEnv: Record<string, string | undefined>;
  warn: (message: string) => void;
};

// --- Public API ---

/**
 * Convert an already-defaulted config into the `SessionSpec` that `run` boots a
 * VM from. This is pure *structural conversion* (path expansion, env/secret
 * split, nix→mounts, computed overlay dirs) plus filesystem validation — all
 * config-level defaults are expected to be filled in already (see
 * {@link applyConfigDefaults}).
 */
export function createSessionSpecFromConfig(
  config: DefaultedConfig,
  configDir: string,
  hostHomeDir: string,
  deps: ResolveDeps = defaultResolveDeps,
): SessionSpec {
  const guestHomeDir = config.guestHomeDir;

  // Resolve workdir
  const { guestWorkdir, workdirMount } = resolveWorkdir(
    config.workdir,
    configDir,
    hostHomeDir,
    guestHomeDir,
  );

  // Collect all mount configs
  const mountConfigs = [
    ...(config.mounts ?? []),
    ...(workdirMount ? [workdirMount] : []),
  ];

  // Resolve each mount config into a MountSpec
  const userMounts = mountConfigs.map((m) =>
    resolveMountConfig(
      m,
      configDir,
      hostHomeDir,
      guestHomeDir,
      deps.ignoreFile,
    ),
  );

  // Resolve nix
  const nixSetup = config.nix
    ? resolveNixSetup(config.nix, deps.nix)
    : undefined;

  const allMounts = [...(nixSetup?.mounts ?? []), ...userMounts];

  // Resolve volumes
  const volumes = (config.volumes ?? []).map((v) =>
    resolveVolumeConfig(v, configDir, guestHomeDir),
  );

  validateMounts(allMounts, volumes, deps.mountValidation);

  // Resolve env: user env wins over nix env
  const nixEnv = nixSetup?.env ?? {};
  const { env: userEnv, secrets } = config.env
    ? _resolveEnv(config.env, deps.hostEnv, deps.warn)
    : { env: {}, secrets: {} };
  const mergedEnv = { ...nixEnv, ...userEnv };
  const hasEnv = Object.keys(mergedEnv).length > 0;
  const hasSecrets = Object.keys(secrets).length > 0;

  const qemu = resolveQemu(config.qemu);
  const resources = resolveResources(config.resources);

  return {
    workdir: guestWorkdir,
    network: config.network,
    mounts: allMounts,
    ...(volumes.length > 0 ? { volumes } : {}),
    ...(resources ? { resources } : {}),
    ...(hasEnv ? { env: mergedEnv } : {}),
    ...(hasSecrets ? { secrets } : {}),
    ...(qemu ? { qemu } : {}),
    ...(config.bootCommands && config.bootCommands.length > 0
      ? { bootCommands: config.bootCommands }
      : {}),
  };
}

// --- Internals ---

function resolveMountConfig(
  m: MountConfig,
  configDir: string,
  hostHomeDir: string,
  guestHomeDir: string,
  ignoreFileDeps: IgnoreFileDeps,
): MountSpec {
  // When guestPath is omitted, we use the expanded *host* path — even if
  // hostPath contained a tilde. This is intentional: the whole point of
  // omitting guestPath is to keep host and guest paths identical (e.g. so
  // that paths in log messages match the host). Users who want ~ to expand
  // to the *guest* user's home can provide an explicit guestPath like "~/…".
  const hostPath = resolve(configDir, expandTilde(m.hostPath, hostHomeDir));
  const guestPath = m.guestPath
    ? expandTilde(m.guestPath, guestHomeDir)
    : hostPath;

  // Collect shadow patterns from ignore list + ignore file refs
  const ignoreFileRefs = m.ignoreFileRefs ?? DEFAULT_IGNORE_FILE_REFS;
  const refs = ignoreFileRefs.map(parseIgnoreFileRef);
  const filePatterns = collectIgnorePatterns(
    refs,
    hostPath,
    configDir,
    ignoreFileDeps,
  );
  const inlinePatterns: ScopedPattern[] = (m.ignore ?? []).map((pattern) => ({
    pattern,
    scope: "/",
  }));
  const shadowPatterns = [...inlinePatterns, ...filePatterns];

  return {
    hostPath,
    guestPath,
    mode: m.mode,
    shadowPatterns,
    ...(m.mode === "overlay"
      ? { overlayStateDir: _getOverlayStateDir(configDir, guestPath) }
      : {}),
  };
}

export type ResolvedEnv = {
  env: Record<string, string>;
  secrets: Record<string, SecretSpec>;
};

export function _resolveEnv(
  env: Record<string, EnvValue>,
  hostEnv: Record<string, string | undefined>,
  warn: (message: string) => void,
): ResolvedEnv {
  const resolved: Record<string, string> = {};
  const secrets: Record<string, SecretSpec> = {};

  for (const [key, value] of Object.entries(env)) {
    if (typeof value === "string") {
      // User provided a literal value (already $VAR-interpolated) through
      // shorthand.
      resolved[key] = value;
      continue;
    }

    let resolvedValue: string;
    if (value.value !== undefined) {
      // User provided a literal value (already $VAR-interpolated)
      resolvedValue = value.value;
    } else {
      // No value provided => read from host env var of the same name.
      const hostValue = hostEnv[key];
      if (hostValue === undefined) {
        warn(`env var "${key}": host variable "${key}" is not set, skipping`);
        continue;
      }
      resolvedValue = hostValue;
    }

    if ("secret" in value) {
      secrets[key] = { hosts: value.injectForHosts, value: resolvedValue };
    } else {
      resolved[key] = resolvedValue;
    }
  }

  return { env: resolved, secrets };
}

function resolveWorkdir(
  workdir: WorkdirConfig,
  configDir: string,
  hostHomeDir: string,
  guestHomeDir: string,
): { guestWorkdir: string; workdirMount?: MountConfig } {
  if (typeof workdir === "string") {
    return { guestWorkdir: expandTilde(workdir, guestHomeDir) };
  }
  const resolvedHostPath = resolve(
    configDir,
    expandTilde(workdir.hostPath, hostHomeDir),
  );
  // See comment in resolveMountConfig: omitted guestPath intentionally uses the
  // expanded host path so that host and guest paths stay identical.
  const guestWorkdir = workdir.guestPath
    ? expandTilde(workdir.guestPath, guestHomeDir)
    : resolvedHostPath;
  return {
    guestWorkdir,
    workdirMount: workdir,
  };
}

/**
 * Pass the configured QEMU knobs through verbatim. We ship no defaults: any
 * field left unset falls back to Gondolin's own auto-selection (which detects
 * /dev/kvm and picks kvm/host/microvm, or max/q35 under software emulation).
 * Returns undefined when nothing is configured.
 */
function resolveQemu(qemu: TuorConfig["qemu"]): QemuSpec | undefined {
  if (!qemu || Object.keys(qemu).length === 0) return undefined;
  return { ...qemu };
}

/**
 * Pass the configured VM resource knobs through verbatim. We ship no defaults:
 * any field left unset falls back to Gondolin's own default (currently 1G
 * memory, 2 cpus). Returns undefined when nothing is configured.
 */
function resolveResources(
  resources: TuorConfig["resources"],
): ResourcesSpec | undefined {
  if (!resources || Object.keys(resources).length === 0) return undefined;
  return { ...resources };
}

function resolveVolumeConfig(
  v: VolumeConfig,
  configDir: string,
  guestHomeDir: string,
): VolumeSpec {
  const guestPath = expandTilde(v.guestPath, guestHomeDir);
  return {
    guestPath,
    stateDir: _getOverlayStateDir(configDir, guestPath),
  };
}

/** Compute the on-disk path for a persistent overlay's upper layer. */
export function _getOverlayStateDir(
  configDir: string,
  guestPath: string,
): string {
  const stripped = guestPath.replace(/^\//, "");
  const sanitized = stripped === "" ? "_root" : stripped.replace(/\//g, "_");
  return join(getOverlaysDir(configDir), sanitized);
}

// --- Default deps ---

const defaultResolveDeps: ResolveDeps = {
  mountValidation: {
    pathExists: existsSync,
    isDirectory: (p) => statSync(p).isDirectory(),
  },
  ignoreFile: defaultIgnoreFileDeps,
  hostEnv: process.env,
  warn: (message) => console.warn(`[env] ${message}`),
};
