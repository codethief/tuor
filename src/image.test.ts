import { describe, expect, test } from "bun:test";
import {
  gondolinTagFromDockerImageId,
  gondolinTagFromOciRef,
  resolveImage,
} from "./image.ts";
import type { ImageDeps } from "./image.ts";

const DEFAULT_ROOTFS_SIZE_MB = 2048;

function stubDeps(overrides: Partial<ImageDeps> = {}): ImageDeps {
  return {
    detectRuntime: async () => "docker",
    buildContainerImage: async () => "sha256:abcdef123456789000",
    gondolinImageExists: () => false,
    buildGondolinImage: async () => {},
    ...overrides,
  };
}

describe("gondolinTagFromDockerImageId", () => {
  test("produces deterministic tag from image id and size", () => {
    const tag = gondolinTagFromDockerImageId("sha256:abcdef123456789abcdef", DEFAULT_ROOTFS_SIZE_MB);
    expect(tag).toMatch(/^tuor:[0-9a-f]{12}$/);
  });

  test("produces same tag for same inputs", () => {
    expect(gondolinTagFromDockerImageId("sha256:abc123", 2048)).toBe(
      gondolinTagFromDockerImageId("sha256:abc123", 2048),
    );
  });

  test("produces different tags for different image ids", () => {
    expect(gondolinTagFromDockerImageId("sha256:abc123", 2048)).not.toBe(
      gondolinTagFromDockerImageId("sha256:def456", 2048),
    );
  });

  test("produces different tags for different rootfs sizes", () => {
    expect(gondolinTagFromDockerImageId("sha256:abc123", 2048)).not.toBe(
      gondolinTagFromDockerImageId("sha256:abc123", 4096),
    );
  });
});

describe("gondolinTagFromOciRef", () => {
  test("produces deterministic tag from oci reference", () => {
    const tag = gondolinTagFromOciRef("docker.io/ubuntu:latest", DEFAULT_ROOTFS_SIZE_MB);
    expect(tag).toMatch(/^tuor-oci:[0-9a-f]{12}$/);
  });

  test("produces same tag for same inputs", () => {
    expect(gondolinTagFromOciRef("ubuntu:22.04", 2048)).toBe(
      gondolinTagFromOciRef("ubuntu:22.04", 2048),
    );
  });

  test("produces different tags for different references", () => {
    expect(gondolinTagFromOciRef("ubuntu:22.04", 2048)).not.toBe(
      gondolinTagFromOciRef("ubuntu:24.04", 2048),
    );
  });

  test("produces different tags for different rootfs sizes", () => {
    expect(gondolinTagFromOciRef("ubuntu:22.04", 2048)).not.toBe(
      gondolinTagFromOciRef("ubuntu:22.04", 4096),
    );
  });
});

describe("resolveImage", () => {
  test("returns tag directly for tag source", async () => {
    const deps = stubDeps();
    const result = await resolveImage(
      { tag: "default:latest" },
      "/config",
      {},
      deps,
    );
    expect(result).toBe("default:latest");
  });

  test("builds gondolin image for oci source when gondolin image is missing", async () => {
    const calls: string[] = [];
    const deps = stubDeps({
      gondolinImageExists: () => false,
      buildGondolinImage: async (ociImage, tag) => {
        calls.push(`gondolin:${ociImage}:${tag}`);
      },
    });

    const expectedTag = gondolinTagFromOciRef("docker.io/ubuntu:latest", DEFAULT_ROOTFS_SIZE_MB);
    const result = await resolveImage(
      { oci: "docker.io/ubuntu:latest" },
      "/project/.tuor",
      {},
      deps,
    );

    expect(result).toBe(expectedTag);
    expect(calls).toEqual([`gondolin:docker.io/ubuntu:latest:${expectedTag}`]);
  });

  test("skips gondolin build for oci source when gondolin image already exists", async () => {
    const calls: string[] = [];
    const deps = stubDeps({
      gondolinImageExists: () => true,
      buildGondolinImage: async () => {
        calls.push("gondolin-build");
      },
    });

    const result = await resolveImage(
      { oci: "docker.io/ubuntu:latest" },
      "/project/.tuor",
      {},
      deps,
    );

    expect(result).toBe(gondolinTagFromOciRef("docker.io/ubuntu:latest", DEFAULT_ROOTFS_SIZE_MB));
    expect(calls).toEqual([]);
  });

  test("uses explicit runtime instead of auto-detecting", async () => {
    let capturedRuntime = "";
    const deps = stubDeps({
      detectRuntime: async () => {
        throw new Error("should not auto-detect");
      },
      buildContainerImage: async (runtime) => {
        capturedRuntime = runtime;
        return "sha256:aabbccddee11223344";
      },
      gondolinImageExists: () => true,
    });

    await resolveImage(
      { dockerfile: "./Dockerfile" },
      "/project/.tuor",
      { runtime: "podman" },
      deps,
    );

    expect(capturedRuntime).toBe("podman");
  });

  test("auto-detects runtime when not specified", async () => {
    let capturedRuntime = "";
    const deps = stubDeps({
      detectRuntime: async () => "docker",
      buildContainerImage: async (runtime) => {
        capturedRuntime = runtime;
        return "sha256:aabbccddee11223344";
      },
      gondolinImageExists: () => true,
    });

    await resolveImage(
      { dockerfile: "./Dockerfile" },
      "/project/.tuor",
      {},
      deps,
    );

    expect(capturedRuntime).toBe("docker");
  });

  test("passes rootfsSizeMb through to buildGondolinImage", async () => {
    let capturedSize: number | undefined;
    const deps = stubDeps({
      gondolinImageExists: () => false,
      buildGondolinImage: async (_ociImage, _tag, _runtime, rootfsSizeMb) => {
        capturedSize = rootfsSizeMb;
      },
    });

    await resolveImage(
      { dockerfile: "./Dockerfile" },
      "/project/.tuor",
      { rootfsSizeMb: 4096 },
      deps,
    );

    expect(capturedSize).toBe(4096);
  });

  test("builds docker and gondolin images for dockerfile source when gondolin image is missing", async () => {
    const calls: string[] = [];
    const deps = stubDeps({
      buildContainerImage: async (runtime, dockerfile, context) => {
        calls.push(`build:${runtime}:${dockerfile}:${context}`);
        return "sha256:aabbccddee11223344";
      },
      gondolinImageExists: () => false,
      buildGondolinImage: async (ociImage, tag) => {
        calls.push(`gondolin:${ociImage}:${tag}`);
      },
    });

    const result = await resolveImage(
      { dockerfile: "./Dockerfile" },
      "/project/.tuor",
      {},
      deps,
    );

    const expectedTag = gondolinTagFromDockerImageId("sha256:aabbccddee11223344", DEFAULT_ROOTFS_SIZE_MB);
    expect(result).toBe(expectedTag);
    expect(calls).toEqual([
      "build:docker:/project/.tuor/Dockerfile:/project/.tuor",
      `gondolin:sha256:aabbccddee11223344:${expectedTag}`,
    ]);
  });

  test("skips gondolin build when gondolin image already exists", async () => {
    const calls: string[] = [];
    const deps = stubDeps({
      buildContainerImage: async () => {
        calls.push("docker-build");
        return "sha256:aabbccddee11223344";
      },
      gondolinImageExists: () => true,
      buildGondolinImage: async () => {
        calls.push("gondolin-build");
      },
    });

    const result = await resolveImage(
      { dockerfile: "./Dockerfile" },
      "/project/.tuor",
      {},
      deps,
    );

    const expectedTag = gondolinTagFromDockerImageId("sha256:aabbccddee11223344", DEFAULT_ROOTFS_SIZE_MB);
    expect(result).toBe(expectedTag);
    expect(calls).toEqual(["docker-build"]);
  });

  test("uses explicit context when provided", async () => {
    let capturedContext = "";
    const deps = stubDeps({
      buildContainerImage: async (_runtime, _dockerfile, context) => {
        capturedContext = context;
        return "sha256:aabbccddee11223344";
      },
      gondolinImageExists: () => true,
    });

    await resolveImage(
      { dockerfile: "./Dockerfile", context: "./build-ctx" },
      "/project/.tuor",
      {},
      deps,
    );

    expect(capturedContext).toBe("/project/.tuor/build-ctx");
  });

  test("defaults context to dockerfile directory", async () => {
    let capturedContext = "";
    const deps = stubDeps({
      buildContainerImage: async (_runtime, _dockerfile, context) => {
        capturedContext = context;
        return "sha256:aabbccddee11223344";
      },
      gondolinImageExists: () => true,
    });

    await resolveImage(
      { dockerfile: "./subdir/Dockerfile" },
      "/project/.tuor",
      {},
      deps,
    );

    expect(capturedContext).toBe("/project/.tuor/subdir");
  });
});
