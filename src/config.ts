import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

// --- Types ---

type DockerfileImageSource = {
  dockerfile: string;
  context?: string;
};

type OciImageSource = {
  oci: string;
};

type TagImageSource = {
  tag: string;
};

type ImageSource = DockerfileImageSource | OciImageSource | TagImageSource;

type ContainerRuntime = "docker" | "podman";

/**
 * Total size of the rootfs ext4 image in MB. This is not additional space on
 * top of the OCI/Dockerfile contents — the entire filesystem must fit within
 * this budget. When omitted, defaults to 2048 MB.
 */
type TuorConfig = {
  image: ImageSource;
  runtime?: ContainerRuntime;
  rootfsSizeMb?: number;
};

export type {
  ContainerRuntime,
  DockerfileImageSource,
  OciImageSource,
  TagImageSource,
  ImageSource,
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

const VALID_RUNTIMES: ContainerRuntime[] = ["docker", "podman"];

function parseRuntime(obj: Record<string, unknown>): ContainerRuntime | undefined {
  if (!("runtime" in obj)) return undefined;
  const value = obj.runtime;
  if (typeof value !== "string" || !VALID_RUNTIMES.includes(value as ContainerRuntime)) {
    throw new Error(`runtime must be "docker" or "podman"`);
  }
  return value as ContainerRuntime;
}

function parseRootfsSizeMb(obj: Record<string, unknown>): number | undefined {
  if (!("rootfsSizeMb" in obj)) return undefined;
  const value = obj.rootfsSizeMb;
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error("rootfsSizeMb must be a positive integer");
  }
  return value;
}

function parseImageSource(image: Record<string, unknown>): ImageSource {
  if ("dockerfile" in image) {
    if (typeof image.dockerfile !== "string" || image.dockerfile === "") {
      throw new Error("image.dockerfile must be a non-empty string");
    }
    if ("context" in image && typeof image.context !== "string") {
      throw new Error("image.context must be a string");
    }
    return {
      dockerfile: image.dockerfile,
      ...(image.context !== undefined
        ? { context: image.context as string }
        : {}),
    };
  }

  if ("oci" in image) {
    if (typeof image.oci !== "string" || image.oci === "") {
      throw new Error("image.oci must be a non-empty string");
    }
    return { oci: image.oci };
  }

  if ("tag" in image) {
    if (typeof image.tag !== "string" || image.tag === "") {
      throw new Error("image.tag must be a non-empty string");
    }
    return { tag: image.tag };
  }

  throw new Error(
    "image must have a 'dockerfile', 'oci', or 'tag' field",
  );
}

function parseConfig(raw: unknown): TuorConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("config must be a JSON object");
  }

  const obj = raw as Record<string, unknown>;

  if (!("image" in obj) || typeof obj.image !== "object" || obj.image === null) {
    throw new Error("config must have an 'image' object");
  }

  const image = parseImageSource(obj.image as Record<string, unknown>);
  const runtime = parseRuntime(obj);
  const rootfsSizeMb = parseRootfsSizeMb(obj);

  return {
    image,
    ...(runtime !== undefined ? { runtime } : {}),
    ...(rootfsSizeMb !== undefined ? { rootfsSizeMb } : {}),
  };
}

export { findConfigDir, parseConfig };
