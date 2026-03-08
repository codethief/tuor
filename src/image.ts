import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  buildAssets,
  ensureGuestAssets,
  getDefaultBuildConfig,
  getDefaultArch,
  importImageFromDirectory,
  resolveImageSelector,
  setImageRef,
} from "@earendil-works/gondolin";
import type { ImageSource } from "./config.ts";

// --- Pure helpers ---

function gondolinTagFromDockerImageId(imageId: string): string {
  const hex = imageId.startsWith("sha256:")
    ? imageId.slice("sha256:".length)
    : imageId;
  return `tuor:${hex.slice(0, 12)}`;
}

function gondolinTagFromOciRef(ref: string): string {
  const hash = createHash("sha256").update(ref).digest("hex").slice(0, 12);
  return `tuor-oci:${hash}`;
}

// --- Dependency injection types ---

type ImageDeps = {
  detectRuntime: () => Promise<"docker" | "podman">;
  buildContainerImage: (
    runtime: string,
    dockerfile: string,
    context: string,
  ) => Promise<string>;
  gondolinImageExists: (tag: string) => boolean;
  buildGondolinImage: (ociImage: string, tag: string) => Promise<void>;
};

// --- Orchestration ---

async function resolveImage(
  source: ImageSource,
  configDir: string,
  deps: ImageDeps = defaultImageDeps,
): Promise<string> {
  if ("tag" in source) {
    return source.tag;
  }

  if ("oci" in source) {
    const tag = gondolinTagFromOciRef(source.oci);
    if (!deps.gondolinImageExists(tag)) {
      await deps.buildGondolinImage(source.oci, tag);
    }
    return tag;
  }

  const dockerfilePath = resolve(configDir, source.dockerfile);
  const contextPath = source.context
    ? resolve(configDir, source.context)
    : dirname(dockerfilePath);

  const runtime = await deps.detectRuntime();
  const imageId = await deps.buildContainerImage(
    runtime,
    dockerfilePath,
    contextPath,
  );

  const tag = gondolinTagFromDockerImageId(imageId);

  if (!deps.gondolinImageExists(tag)) {
    await deps.buildGondolinImage(imageId, tag);
  }

  return tag;
}

// --- Default implementations (imperative shell) ---

async function detectRuntime(): Promise<"docker" | "podman"> {
  for (const candidate of ["docker", "podman"] as const) {
    const proc = Bun.spawn([candidate, "--version"], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitCode = await proc.exited;
    if (exitCode === 0) {
      return candidate;
    }
  }
  throw new Error(
    "No container runtime found. Install Docker or Podman.",
  );
}

async function buildContainerImage(
  runtime: string,
  dockerfile: string,
  context: string,
): Promise<string> {
  const proc = Bun.spawn([runtime, "build", "-q", "-f", dockerfile, context], {
    stdout: "pipe",
    stderr: "inherit",
  });
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    throw new Error(`${runtime} build failed with exit code ${exitCode}`);
  }
  const output = await new Response(proc.stdout).text();
  return output.trim();
}

function gondolinImageExists(tag: string): boolean {
  try {
    resolveImageSelector(tag);
    return true;
  } catch {
    return false;
  }
}

const SANDBOX_BINARIES = [
  "sandboxd",
  "sandboxfs",
  "sandboxssh",
  "sandboxingress",
] as const;

async function extractSandboxBinaries(
  rootfsPath: string,
): Promise<Record<string, string>> {
  const extractDir = mkdtempSync(join(tmpdir(), "tuor-sandbox-binaries-"));
  const paths: Record<string, string> = {};

  for (const name of SANDBOX_BINARIES) {
    const outPath = join(extractDir, name);
    const proc = Bun.spawn(
      ["debugfs", rootfsPath, "-R", `dump /usr/bin/${name} ${outPath}`],
      { stdout: "ignore", stderr: "pipe" },
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      throw new Error(
        `Failed to extract ${name} from default Gondolin image: ${stderr.trim()}`,
      );
    }
    chmodSync(outPath, 0o755);
    paths[name] = outPath;
  }

  return paths;
}

async function buildGondolinImage(
  ociImage: string,
  tag: string,
): Promise<void> {
  const defaultAssets = await ensureGuestAssets();
  const binaries = await extractSandboxBinaries(defaultAssets.rootfsPath);

  const config = getDefaultBuildConfig();
  config.oci = { image: ociImage, pullPolicy: "if-not-present" };
  config.sandboxdPath = binaries["sandboxd"];
  config.sandboxfsPath = binaries["sandboxfs"];
  config.sandboxsshPath = binaries["sandboxssh"];
  config.sandboxingressPath = binaries["sandboxingress"];

  const outputDir = mkdtempSync(join(tmpdir(), "tuor-build-"));
  const result = await buildAssets(config, { outputDir });

  const imported = importImageFromDirectory(result.outputDir);
  setImageRef(tag, imported.buildId, getDefaultArch());
}

const defaultImageDeps: ImageDeps = {
  detectRuntime,
  buildContainerImage,
  gondolinImageExists,
  buildGondolinImage,
};

export {
  gondolinTagFromDockerImageId,
  gondolinTagFromOciRef,
  resolveImage,
  defaultImageDeps,
};
export type { ImageDeps };
