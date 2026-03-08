import { describe, expect, test } from "bun:test";
import {
  gondolinTagFromDockerImageId,
  gondolinTagFromOciRef,
  resolveImage,
} from "./image.ts";
import type { ImageDeps } from "./image.ts";

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
  test("extracts first 12 hex chars from sha256 prefixed id", () => {
    expect(gondolinTagFromDockerImageId("sha256:abcdef123456789abcdef")).toBe(
      "tuor:abcdef123456",
    );
  });

  test("handles id without sha256 prefix", () => {
    expect(gondolinTagFromDockerImageId("abcdef123456789abcdef")).toBe(
      "tuor:abcdef123456",
    );
  });
});

describe("gondolinTagFromOciRef", () => {
  test("produces deterministic tag from oci reference", () => {
    const tag = gondolinTagFromOciRef("docker.io/ubuntu:latest");
    expect(tag).toMatch(/^tuor-oci:[0-9a-f]{12}$/);
  });

  test("produces same tag for same reference", () => {
    expect(gondolinTagFromOciRef("ubuntu:22.04")).toBe(
      gondolinTagFromOciRef("ubuntu:22.04"),
    );
  });

  test("produces different tags for different references", () => {
    expect(gondolinTagFromOciRef("ubuntu:22.04")).not.toBe(
      gondolinTagFromOciRef("ubuntu:24.04"),
    );
  });
});

describe("resolveImage", () => {
  test("returns tag directly for tag source", async () => {
    const deps = stubDeps();
    const result = await resolveImage(
      { tag: "default:latest" },
      "/config",
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

    const expectedTag = gondolinTagFromOciRef("docker.io/ubuntu:latest");
    const result = await resolveImage(
      { oci: "docker.io/ubuntu:latest" },
      "/project/.tuor",
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
      deps,
    );

    expect(result).toBe(gondolinTagFromOciRef("docker.io/ubuntu:latest"));
    expect(calls).toEqual([]);
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
      deps,
    );

    expect(result).toBe("tuor:aabbccddee11");
    expect(calls).toEqual([
      "build:docker:/project/.tuor/Dockerfile:/project/.tuor",
      "gondolin:sha256:aabbccddee11223344:tuor:aabbccddee11",
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
      deps,
    );

    expect(result).toBe("tuor:aabbccddee11");
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
      deps,
    );

    expect(capturedContext).toBe("/project/.tuor/subdir");
  });
});
