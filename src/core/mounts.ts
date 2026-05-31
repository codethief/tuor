import { mkdirSync } from "node:fs";
import {
  RealFSProvider,
  ReadonlyProvider,
  MemoryProvider,
  ShadowProvider,
  type VirtualProvider,
} from "@earendil-works/gondolin";
import { OverlayProvider } from "./overlay-provider.ts";
import { buildShadowPredicate, type ScopedPattern } from "./shadow.ts";

// --- Types ---

export const MOUNT_MODES = ["readwrite", "readonly", "overlay", "overlay-tmpfs"] as const;
export type MountMode = (typeof MOUNT_MODES)[number];

/** A volume: a persistent guest directory without a host backing directory. */
export type VolumeSpec = {
  guestPath: string;
  /** On-host directory where the volume's data is stored. */
  stateDir: string;
};

/** Core's input contract for a single mount — fully resolved, no optionals. */
export type MountSpec = {
  hostPath: string;
  guestPath: string;
  mode: MountMode;
  shadowPatterns: ScopedPattern[];
  /** Pre-computed path for persistent overlay state. Only for 'overlay' mode. */
  overlayStateDir?: string;
};

export type MountValidationDeps = {
  pathExists: (p: string) => boolean;
  isDirectory: (p: string) => boolean;
};

export function validateMounts(
  mounts: MountSpec[],
  volumes: VolumeSpec[],
  deps: MountValidationDeps,
): void {
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

  // Check for duplicate guestPaths across mounts and volumes
  const allGuestPaths = [
    ...mounts.map((m) => m.guestPath),
    ...volumes.map((v) => v.guestPath),
  ];
  const seen = new Set<string>();
  for (const guestPath of allGuestPaths) {
    if (seen.has(guestPath)) {
      // TODO The check for equality is not enough. We should actually check
      // that the different guestPaths don't contain each other.
      throw new Error(`Duplicate guest mount path: ${guestPath}`);
    }
    seen.add(guestPath);
  }
}

export function buildVfsVolumes(
  volumes: VolumeSpec[],
): Record<string, VirtualProvider> {
  const result: Record<string, VirtualProvider> = {};
  for (const vol of volumes) {
    mkdirSync(vol.stateDir, { recursive: true });
    result[vol.guestPath] = new RealFSProvider(vol.stateDir);
  }
  return result;
}

export function buildVfsMounts(
  mounts: MountSpec[],
): Record<string, VirtualProvider> {
  const result: Record<string, VirtualProvider> = {};
  for (const mount of mounts) {
    let backend: VirtualProvider = new RealFSProvider(mount.hostPath);

    if (mount.shadowPatterns.length > 0) {
      const predicate = buildShadowPredicate(mount.shadowPatterns);
      backend = new ShadowProvider(backend, { shouldShadow: predicate, writeMode: "deny" });
    }

    switch (mount.mode) {
      case "readwrite":
        result[mount.guestPath] = backend;
        break;
      case "readonly":
        result[mount.guestPath] = new ReadonlyProvider(backend);
        break;
      case "overlay-tmpfs":
        result[mount.guestPath] = new OverlayProvider(backend, new MemoryProvider());
        break;
      case "overlay": {
        const stateDir = mount.overlayStateDir;
        if (!stateDir) {
          throw new Error(
            `Overlay mount for ${mount.guestPath} is missing overlayStateDir`,
          );
        }
        mkdirSync(stateDir, { recursive: true });
        result[mount.guestPath] = new OverlayProvider(
          backend,
          new RealFSProvider(stateDir),
        );
        break;
      }
    }
  }
  return result;
}


