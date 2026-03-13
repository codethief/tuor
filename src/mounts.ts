import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import {
  RealFSProvider,
  ReadonlyProvider,
  type VirtualProvider,
} from "@earendil-works/gondolin";
import type { MountConfig } from "./config.ts";

// --- Types ---

type ResolvedMount = {
  hostPath: string;
  guestPath: string;
  readOnly: boolean;
};

type MountDeps = {
  pathExists: (p: string) => boolean;
  isDirectory: (p: string) => boolean;
};

// --- Functional core ---

function resolveMounts(
  mounts: MountConfig[],
  configDir: string,
): ResolvedMount[] {
  return mounts.map((m) => {
    const hostPath = resolve(configDir, m.hostPath);
    return {
      hostPath,
      guestPath: m.guestPath ?? hostPath,
      readOnly: m.readOnly,
    };
  });
}

// --- Validation (uses injected deps) ---

function validateMounts(mounts: ResolvedMount[], deps: MountDeps): void {
  for (const mount of mounts) {
    if (!deps.pathExists(mount.hostPath)) {
      throw new Error(`Mount host path does not exist: ${mount.hostPath}`);
    }
    if (!deps.isDirectory(mount.hostPath)) {
      throw new Error(
        `Mount host path is not a directory: ${mount.hostPath}. ` +
          "Gondolin's RealFSProvider only supports directories.",
      );
    }
  }

  const seen = new Set<string>();
  for (const mount of mounts) {
    if (seen.has(mount.guestPath)) {
      throw new Error(`Duplicate guest mount path: ${mount.guestPath}`);
    }
    seen.add(mount.guestPath);
  }
}

// --- Imperative shell ---

function buildVfsMounts(
  mounts: ResolvedMount[],
): Record<string, VirtualProvider> {
  const result: Record<string, VirtualProvider> = {};
  for (const mount of mounts) {
    const provider = new RealFSProvider(mount.hostPath);
    result[mount.guestPath] = mount.readOnly
      ? new ReadonlyProvider(provider)
      : provider;
  }
  return result;
}

// --- Public API ---

const defaultMountDeps: MountDeps = {
  pathExists: existsSync,
  isDirectory: (p) => statSync(p).isDirectory(),
};

function prepareMounts(
  mounts: MountConfig[],
  configDir: string,
  deps: MountDeps = defaultMountDeps,
): Record<string, VirtualProvider> {
  const resolved = resolveMounts(mounts, configDir);
  validateMounts(resolved, deps);
  return buildVfsMounts(resolved);
}

export { resolveMounts, validateMounts, buildVfsMounts, prepareMounts };
export type { ResolvedMount, MountDeps };
