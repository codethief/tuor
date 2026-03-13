import { describe, expect, test } from "vitest";
import {
  gondolinTagFromDockerImageId,
  gondolinTagFromOciRef,
  resolveImage,
} from "./image.ts";
import type { ImageDeps } from "./image.ts";
import type { RootfsConfig } from "./config.ts";

function stubDeps(overrides: Partial<ImageDeps> = {}): ImageDeps {
  return {
    detectEngine: async () => "docker",
    buildContainerImage: async () => "sha256:abcdef123456789000",
    gondolinImageExists: () => false,
    buildGondolinImage: async () => {},
    ...overrides,
  };
}

describe("gondolinTagFromDockerImageId", () => {
  test("produces deterministic tag from image id and size", () => {
    const tag = gondolinTagFromDockerImageId("sha256:abcdef123456789abcdef", 2048);
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
    const tag = gondolinTagFromOciRef("docker.io/ubuntu:latest", 2048);
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
  test("builds gondolin image for tag source when gondolin image is missing", async () => {
    const calls: string[] = [];
    const deps = stubDeps({
      gondolinImageExists: () => false,
      buildGondolinImage: async (ociImage, tag) => {
        calls.push(`gondolin:${ociImage}:${tag}`);
      },
    });

    const rootfs: RootfsConfig = { ociImage: { tag: "docker.io/ubuntu:latest" }, fsSize: 2048 };
    const expectedTag = gondolinTagFromOciRef("docker.io/ubuntu:latest", 2048);
    const result = await resolveImage(rootfs, "/project/.tuor", deps);

    expect(result).toBe(expectedTag);
    expect(calls).toEqual([`gondolin:docker.io/ubuntu:latest:${expectedTag}`]);
  });

  test("skips gondolin build for tag source when gondolin image already exists", async () => {
    const calls: string[] = [];
    const deps = stubDeps({
      gondolinImageExists: () => true,
      buildGondolinImage: async () => {
        calls.push("gondolin-build");
      },
    });

    const rootfs: RootfsConfig = { ociImage: { tag: "docker.io/ubuntu:latest" }, fsSize: 2048 };
    const result = await resolveImage(rootfs, "/project/.tuor", deps);

    expect(result).toBe(gondolinTagFromOciRef("docker.io/ubuntu:latest", 2048));
    expect(calls).toEqual([]);
  });

  test("uses explicit engine instead of auto-detecting", async () => {
    let capturedEngine = "";
    const deps = stubDeps({
      detectEngine: async () => {
        throw new Error("should not auto-detect");
      },
      buildContainerImage: async (engine) => {
        capturedEngine = engine;
        return "sha256:aabbccddee11223344";
      },
      gondolinImageExists: () => true,
    });

    const rootfs: RootfsConfig = {
      ociImage: { containerfile: "./Containerfile", engine: "podman" },
      fsSize: 2048,
    };
    await resolveImage(rootfs, "/project/.tuor", deps);

    expect(capturedEngine).toBe("podman");
  });

  test("auto-detects engine when not specified", async () => {
    let capturedEngine = "";
    const deps = stubDeps({
      detectEngine: async () => "docker",
      buildContainerImage: async (engine) => {
        capturedEngine = engine;
        return "sha256:aabbccddee11223344";
      },
      gondolinImageExists: () => true,
    });

    const rootfs: RootfsConfig = { ociImage: { containerfile: "./Containerfile" }, fsSize: 2048 };
    await resolveImage(rootfs, "/project/.tuor", deps);

    expect(capturedEngine).toBe("docker");
  });

  test("passes fsSize through to buildGondolinImage", async () => {
    let capturedSize: number | undefined;
    const deps = stubDeps({
      gondolinImageExists: () => false,
      buildGondolinImage: async (_ociImage, _tag, _engine, rootfsSizeMb) => {
        capturedSize = rootfsSizeMb;
      },
    });

    const rootfs: RootfsConfig = {
      ociImage: { containerfile: "./Containerfile" },
      fsSize: 4096,
    };
    await resolveImage(rootfs, "/project/.tuor", deps);

    expect(capturedSize).toBe(4096);
  });

  test("builds container and gondolin images for containerfile source when gondolin image is missing", async () => {
    const calls: string[] = [];
    const deps = stubDeps({
      buildContainerImage: async (engine, containerfile, context) => {
        calls.push(`build:${engine}:${containerfile}:${context}`);
        return "sha256:aabbccddee11223344";
      },
      gondolinImageExists: () => false,
      buildGondolinImage: async (ociImage, tag) => {
        calls.push(`gondolin:${ociImage}:${tag}`);
      },
    });

    const rootfs: RootfsConfig = { ociImage: { containerfile: "./Containerfile" }, fsSize: 2048 };
    const result = await resolveImage(rootfs, "/project/.tuor", deps);

    const expectedTag = gondolinTagFromDockerImageId("sha256:aabbccddee11223344", 2048);
    expect(result).toBe(expectedTag);
    expect(calls).toEqual([
      "build:docker:/project/.tuor/Containerfile:/project/.tuor",
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

    const rootfs: RootfsConfig = { ociImage: { containerfile: "./Containerfile" }, fsSize: 2048 };
    const result = await resolveImage(rootfs, "/project/.tuor", deps);

    const expectedTag = gondolinTagFromDockerImageId("sha256:aabbccddee11223344", 2048);
    expect(result).toBe(expectedTag);
    expect(calls).toEqual(["docker-build"]);
  });

  test("uses explicit context when provided", async () => {
    let capturedContext = "";
    const deps = stubDeps({
      buildContainerImage: async (_engine, _containerfile, context) => {
        capturedContext = context;
        return "sha256:aabbccddee11223344";
      },
      gondolinImageExists: () => true,
    });

    const rootfs: RootfsConfig = {
      ociImage: { containerfile: "./Containerfile", context: "./build-ctx" },
      fsSize: 2048,
    };
    await resolveImage(rootfs, "/project/.tuor", deps);

    expect(capturedContext).toBe("/project/.tuor/build-ctx");
  });

  test("defaults context to containerfile directory", async () => {
    let capturedContext = "";
    const deps = stubDeps({
      buildContainerImage: async (_engine, _containerfile, context) => {
        capturedContext = context;
        return "sha256:aabbccddee11223344";
      },
      gondolinImageExists: () => true,
    });

    const rootfs: RootfsConfig = { ociImage: { containerfile: "./subdir/Containerfile" }, fsSize: 2048 };
    await resolveImage(rootfs, "/project/.tuor", deps);

    expect(capturedContext).toBe("/project/.tuor/subdir");
  });
});
