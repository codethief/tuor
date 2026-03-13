import { resolve } from "node:path";
import type { MountConfig, WorkdirConfig } from "./config.ts";

// --- Types ---

type ResolvedWorkdir = {
  guestPath: string;
  mount?: MountConfig;
};

// --- Functional core ---

function resolveWorkdir(
  workdir: WorkdirConfig,
  configDir: string,
): ResolvedWorkdir {
  if (typeof workdir === "string") {
    return { guestPath: workdir };
  }
  const resolvedHostPath = resolve(configDir, workdir.hostPath);
  return {
    guestPath: workdir.guestPath ?? resolvedHostPath,
    mount: workdir,
  };
}

export { resolveWorkdir };
export type { ResolvedWorkdir };
