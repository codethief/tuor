import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import type { SessionSpec } from "../core/session.ts";
import type { MountSpec, MountValidationDeps } from "../core/mounts.ts";
import { validateMounts } from "../core/mounts.ts";
import type { ScopedPattern } from "../core/shadow.ts";
import type { MountConfig, TuorConfig, WorkdirConfig } from "./schema.ts";
import { expandTilde, inferGuestHomeDir } from "./homedir.ts";
import {
  parseIgnoreFileRef,
  collectIgnorePatterns,
  defaultIgnoreFileDeps,
  type IgnoreFileDeps,
} from "./ignore-files.ts";
import { resolveNixSetup, type NixDeps } from "./nix.ts";

// --- Types ---

export type ResolveDeps = {
  mountValidation: MountValidationDeps;
  ignoreFile: IgnoreFileDeps;
  nix?: NixDeps;
};

// --- Public API ---

export function resolveConfig(
  config: TuorConfig,
  configDir: string,
  hostHomeDir: string,
  deps: ResolveDeps = defaultResolveDeps,
): SessionSpec {
  const guestHomeDir = config.guestHomeDir ?? inferGuestHomeDir(config.user);

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
    resolveMountConfig(m, configDir, hostHomeDir, guestHomeDir, deps.ignoreFile),
  );

  // Resolve nix
  const nixSetup = config.nix
    ? resolveNixSetup(config.nix, deps.nix)
    : undefined;

  const allMounts = [...(nixSetup?.mounts ?? []), ...userMounts];

  validateMounts(allMounts, deps.mountValidation);

  return {
    user: config.user,
    workdir: guestWorkdir,
    mounts: allMounts,
    ...(config.rootfsSize ? { rootfsSize: config.rootfsSize } : {}),
    ...(nixSetup ? {
      env: nixSetup.env,
      bootCommands: [nixSetup.tlsSetupCommand],
    } : {}),
  };
}

// --- Internals ---

const DEFAULT_IGNORE_FILE_REFS = ["host:./tuorignore", "mount:.tuorignore"];

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
  const filePatterns = collectIgnorePatterns(refs, hostPath, configDir, ignoreFileDeps);
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

function resolveWorkdir(
  workdir: WorkdirConfig,
  configDir: string,
  hostHomeDir: string,
  guestHomeDir: string,
): { guestWorkdir: string; workdirMount?: MountConfig } {
  if (typeof workdir === "string") {
    return { guestWorkdir: expandTilde(workdir, guestHomeDir) };
  }
  const resolvedHostPath = resolve(configDir, expandTilde(workdir.hostPath, hostHomeDir));
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

/** Compute the on-disk path for a persistent overlay's upper layer. */
export function _getOverlayStateDir(configDir: string, guestPath: string): string {
  const stripped = guestPath.replace(/^\//, "");
  const sanitized = stripped === "" ? "_root" : stripped.replace(/\//g, "_");
  return join(configDir, ".state", "overlays", sanitized);
}

// --- Default deps ---

const defaultResolveDeps: ResolveDeps = {
  mountValidation: {
    pathExists: existsSync,
    isDirectory: (p) => statSync(p).isDirectory(),
  },
  ignoreFile: defaultIgnoreFileDeps,
};


