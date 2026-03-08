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

type TuorConfig = {
  image: ImageSource;
};

export type {
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

function parseConfig(raw: unknown): TuorConfig {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("config must be a JSON object");
  }

  const obj = raw as Record<string, unknown>;

  if (!("image" in obj) || typeof obj.image !== "object" || obj.image === null) {
    throw new Error("config must have an 'image' object");
  }

  const image = obj.image as Record<string, unknown>;

  if ("dockerfile" in image) {
    if (typeof image.dockerfile !== "string" || image.dockerfile === "") {
      throw new Error("image.dockerfile must be a non-empty string");
    }
    if ("context" in image && typeof image.context !== "string") {
      throw new Error("image.context must be a string");
    }
    return {
      image: {
        dockerfile: image.dockerfile,
        ...(image.context !== undefined
          ? { context: image.context as string }
          : {}),
      },
    };
  }

  if ("oci" in image) {
    if (typeof image.oci !== "string" || image.oci === "") {
      throw new Error("image.oci must be a non-empty string");
    }
    return { image: { oci: image.oci } };
  }

  if ("tag" in image) {
    if (typeof image.tag !== "string" || image.tag === "") {
      throw new Error("image.tag must be a non-empty string");
    }
    return { image: { tag: image.tag } };
  }

  throw new Error(
    "image must have a 'dockerfile', 'oci', or 'tag' field",
  );
}

export { findConfigDir, parseConfig };
