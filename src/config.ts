import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// --- Types ---

type OciImageRef = { tag: string; engine?: ContainerEngine };
type OciImageBuild = { containerfile: string; context?: string; engine?: ContainerEngine };
type OciImage = OciImageRef | OciImageBuild;
type ContainerEngine = "docker" | "podman";

/**
 * Total size of the rootfs ext4 image in MB. This is not additional space on
 * top of the OCI/Dockerfile contents — the entire filesystem must fit within
 * this budget. When omitted, defaults to 2048 MB.
 */
type RootfsConfig = { ociImage: OciImage; fsSize?: number };
type TuorConfig = { rootfs: RootfsConfig; user?: string };

export type {
  ContainerEngine,
  OciImage,
  OciImageBuild,
  OciImageRef,
  RootfsConfig,
  TuorConfig,
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

const VALID_ENGINES: ContainerEngine[] = ["docker", "podman"];

function parseEngine(obj: Record<string, unknown>): ContainerEngine | undefined {
  if (!("engine" in obj)) return undefined;
  const value = obj.engine;
  if (typeof value !== "string" || !VALID_ENGINES.includes(value as ContainerEngine)) {
    throw new Error(`engine must be "docker" or "podman"`);
  }
  return value as ContainerEngine;
}

function parseFsSize(obj: Record<string, unknown>): number | undefined {
  if (!("fsSize" in obj)) return undefined;
  const value = obj.fsSize;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("fsSize must be a positive integer");
  }
  return value;
}

function parseOciImage(obj: Record<string, unknown>): OciImage {
  const engine = parseEngine(obj);

  if ("containerfile" in obj) {
    if (typeof obj.containerfile !== "string" || obj.containerfile === "") {
      throw new Error("ociImage.containerfile must be a non-empty string");
    }
    if ("context" in obj && typeof obj.context !== "string") {
      throw new Error("ociImage.context must be a string");
    }
    return {
      containerfile: obj.containerfile,
      ...(obj.context !== undefined ? { context: obj.context as string } : {}),
      ...(engine !== undefined ? { engine } : {}),
    };
  }

  if ("tag" in obj) {
    if (typeof obj.tag !== "string" || obj.tag === "") {
      throw new Error("ociImage.tag must be a non-empty string");
    }
    return {
      tag: obj.tag,
      ...(engine !== undefined ? { engine } : {}),
    };
  }

  throw new Error(
    "ociImage must have a 'containerfile' or 'tag' field",
  );
}

function parseConfig(raw: unknown): TuorConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("config must be a JSON object");
  }

  const obj = raw as Record<string, unknown>;

  if (!("rootfs" in obj) || typeof obj.rootfs !== "object" || obj.rootfs === null) {
    throw new Error("config must have a 'rootfs' object");
  }

  const rootfsObj = obj.rootfs as Record<string, unknown>;

  if (!("ociImage" in rootfsObj) || typeof rootfsObj.ociImage !== "object" || rootfsObj.ociImage === null) {
    throw new Error("rootfs must have an 'ociImage' object");
  }

  const ociImage = parseOciImage(rootfsObj.ociImage as Record<string, unknown>);
  const fsSize = parseFsSize(rootfsObj);

  if ("user" in obj) {
    if (typeof obj.user !== "string" || obj.user === "") {
      throw new Error("user must be a non-empty string");
    }
  }

  return {
    rootfs: {
      ociImage,
      ...(fsSize !== undefined ? { fsSize } : {}),
    },
    ...(typeof obj.user === "string" ? { user: obj.user } : {}),
  };
}

export { findConfigDir, parseConfig };
