import { existsSync, mkdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  RealFSProvider,
  ReadonlyProvider,
  MemoryProvider,
  ShadowProvider,
  type VirtualProvider,
} from "@earendil-works/gondolin";
import { OverlayProvider } from "./overlay-provider.ts";
import type { MountConfig, MountMode } from "./config.ts";
import {
  parseIgnoreFileRef,
  collectIgnorePatterns,
  buildShadowPredicate,
  defaultIgnoreFileDeps,
  type IgnoreFileDeps,
} from "./ignore-file.ts";

// --- Types ---

type ResolvedMount = {
  hostPath: string;
  guestPath: string;
  mode: MountMode;
  ignore?: string[];
  ignoreFileRefs: string[];
};

type MountDeps = {
  pathExists: (p: string) => boolean;
  isDirectory: (p: string) => boolean;
  ignoreFile: IgnoreFileDeps;
};

// --- Functional core ---

const DEFAULT_IGNORE_FILE_REFS = ["host:./tuorignore", "mount:.tuorignore"];

function resolveMounts(
  mounts: MountConfig[],
  configDir: string,
): ResolvedMount[] {
  return mounts.map((m) => {
    const hostPath = resolve(configDir, m.hostPath);
    return {
      hostPath,
      guestPath: m.guestPath ?? hostPath,
      mode: m.mode,
      ...(m.ignore ? { ignore: m.ignore } : {}),
      ignoreFileRefs: m.ignoreFileRefs ?? DEFAULT_IGNORE_FILE_REFS,
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
      // TODO The check for equality is not enough. We should actually check
      // that the different guestPaths don't contain each other.
      throw new Error(`Duplicate guest mount path: ${mount.guestPath}`);
    }
    seen.add(mount.guestPath);
  }
}

// --- Helpers ---

/** Compute the on-disk path for a persistent overlay's upper layer. */
function getOverlayStateDir(configDir: string, guestPath: string): string {
  const stripped = guestPath.replace(/^\//, "");
  const sanitized = stripped === "" ? "_root" : stripped.replace(/\//g, "_");
  return join(configDir, ".state", "overlays", sanitized);
}

// --- Imperative shell ---

function buildVfsMounts(
  mounts: ResolvedMount[],
  configDir: string,
  ignoreFileDeps: IgnoreFileDeps = defaultIgnoreFileDeps,
): Record<string, VirtualProvider> {
  const result: Record<string, VirtualProvider> = {};
  for (const mount of mounts) {
    let backend: VirtualProvider = new RealFSProvider(mount.hostPath);

    const refs = mount.ignoreFileRefs.map(parseIgnoreFileRef);
    const filePatterns = collectIgnorePatterns(refs, mount.hostPath, configDir, ignoreFileDeps);
    const allPatterns = [...(mount.ignore ?? []).map((pattern) => ({ pattern, scope: "/" })), ...filePatterns];

    if (allPatterns.length > 0) {
      const predicate = buildShadowPredicate(allPatterns);
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
        const stateDir = getOverlayStateDir(configDir, mount.guestPath);
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

// --- Public API ---

const defaultMountDeps: MountDeps = {
  pathExists: existsSync,
  isDirectory: (p) => statSync(p).isDirectory(),
  ignoreFile: defaultIgnoreFileDeps,
};

function prepareMounts(
  mounts: MountConfig[],
  configDir: string,
  deps: MountDeps = defaultMountDeps,
): Record<string, VirtualProvider> {
  const resolved = resolveMounts(mounts, configDir);
  validateMounts(resolved, deps);
  return buildVfsMounts(resolved, configDir, deps.ignoreFile);
}

export { resolveMounts, validateMounts, buildVfsMounts, getOverlayStateDir, prepareMounts };
export type { ResolvedMount, MountDeps };
