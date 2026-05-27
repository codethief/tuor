import { resolve } from "node:path";
import type { MountConfig, WorkdirConfig } from "./config.ts";
import { expandTilde } from "./homedir.ts";

// --- Types ---

type ResolvedWorkdir = {
  guestPath: string;
  mount?: MountConfig;
};

// --- Functional core ---

function resolveWorkdir(
  workdir: WorkdirConfig,
  configDir: string,
  hostHomeDir: string,
  guestHomeDir: string,
): ResolvedWorkdir {
  if (typeof workdir === "string") {
    return { guestPath: expandTilde(workdir, guestHomeDir) };
  }
  const resolvedHostPath = resolve(configDir, expandTilde(workdir.hostPath, hostHomeDir));
  // See comment in resolveMounts: omitted guestPath intentionally uses the
  // expanded host path so that host and guest paths stay identical.
  const guestPath = workdir.guestPath
    ? expandTilde(workdir.guestPath, guestHomeDir)
    : resolvedHostPath;
  return {
    guestPath,
    mount: workdir,
  };
}

export { resolveWorkdir };
export type { ResolvedWorkdir };
