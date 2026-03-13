import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { scope, type } from "arktype";

// --- Schema (single source of truth for validation + types) ---

const types = scope({
  ContainerEngine: "'docker' | 'podman'",
  OciImageRef: {
    tag: "string > 0",
    "engine?": "ContainerEngine",
  },
  OciImageBuild: {
    containerfile: "string > 0",
    "context?": "string",
    "engine?": "ContainerEngine",
  },
  OciImage: "OciImageRef | OciImageBuild",
  /**
   * Total size of the rootfs ext4 image in MB. This is not additional space on
   * top of the OCI/Dockerfile contents — the entire filesystem must fit within
   * this budget. Defaults to 2048 MB.
   */
  RootfsConfig: {
    ociImage: "OciImage",
    "fsSize": "number.integer > 0 = 2048",
  },
  AbsoluteGuestPath: type("string > 0").matching(/^\//),
  MountConfig: {
    hostPath: "string > 0",
    "guestPath?": "AbsoluteGuestPath",
    "readOnly": "boolean = false",
  },
  /**
   * Working directory inside the guest. Either just a guest path (string) to cd
   * into, or a full mount config (which also sets up the host→guest mount and
   * then cd's into the guest path).
   */
  WorkdirConfig: "AbsoluteGuestPath | MountConfig",
  TuorConfig: {
    rootfs: "RootfsConfig",

    /**
     * User must currently be root or the user with UID 1000 (or whatever UID
     * you use on the host), see
     * https://github.com/earendil-works/gondolin/issues/74
     */
    "user": "string > 0 = 'root'",

    "mounts?": "MountConfig[]",
    "workdir": "WorkdirConfig = '/'",
  },
}).export();

type ContainerEngine = typeof types.ContainerEngine.infer;
type OciImageRef = typeof types.OciImageRef.infer;
type OciImageBuild = typeof types.OciImageBuild.infer;
type OciImage = typeof types.OciImage.infer;
type RootfsConfig = typeof types.RootfsConfig.infer;
type MountConfig = typeof types.MountConfig.infer;
type WorkdirConfig = typeof types.WorkdirConfig.infer;
type TuorConfig = typeof types.TuorConfig.infer;

export type {
  ContainerEngine,
  MountConfig,
  OciImage,
  OciImageBuild,
  OciImageRef,
  RootfsConfig,
  TuorConfig,
  WorkdirConfig,
};

// --- Config discovery ---

function findConfigDir(
  startDir: string,
  exists: (path: string) => boolean = existsSync,
): string | null {
  let dir = resolve(startDir);
  while (true) {
    if (exists(join(dir, ".tuor", "config.json"))) {
      return join(dir, ".tuor");
    }
    const parent = dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

// --- Config parsing ---

function parseConfig(raw: unknown): TuorConfig {
  const result = types.TuorConfig(raw);
  if (result instanceof type.errors) {
    throw new Error(result.summary);
  }
  return result;
}

export { findConfigDir, parseConfig };
