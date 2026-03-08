import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, mkdtempSync, readFileSync } from "node:fs";
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
import type { ContainerRuntime, ImageSource, TuorConfig } from "./config.ts";

const DEFAULT_ROOTFS_SIZE_MB = 2048;

// --- Pure helpers ---

function buildTagHash(...parts: (string | number)[]): string {
  return createHash("sha256").update(parts.join("\0")).digest("hex").slice(0, 12);
}

function gondolinTagFromDockerImageId(imageId: string, rootfsSizeMb: number): string {
  return `tuor:${buildTagHash(imageId, rootfsSizeMb)}`;
}

function gondolinTagFromOciRef(ref: string, rootfsSizeMb: number): string {
  return `tuor-oci:${buildTagHash(ref, rootfsSizeMb)}`;
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
  buildGondolinImage: (
    ociImage: string,
    tag: string,
    runtime?: ContainerRuntime,
    rootfsSizeMb?: number,
  ) => Promise<void>;
};

// --- Orchestration ---

async function resolveImage(
  source: ImageSource,
  configDir: string,
  config: Pick<TuorConfig, "runtime" | "rootfsSizeMb">,
  deps: ImageDeps = defaultImageDeps,
): Promise<string> {
  const { runtime } = config;
  const effectiveSizeMb = config.rootfsSizeMb ?? DEFAULT_ROOTFS_SIZE_MB;

  if ("tag" in source) {
    return source.tag;
  }

  if ("oci" in source) {
    const tag = gondolinTagFromOciRef(source.oci, effectiveSizeMb);
    if (!deps.gondolinImageExists(tag)) {
      await deps.buildGondolinImage(source.oci, tag, runtime, effectiveSizeMb);
    }
    return tag;
  }

  const dockerfilePath = resolve(configDir, source.dockerfile);
  const contextPath = source.context
    ? resolve(configDir, source.context)
    : dirname(dockerfilePath);

  const resolvedRuntime = runtime ?? await deps.detectRuntime();
  const imageId = await deps.buildContainerImage(
    resolvedRuntime,
    dockerfilePath,
    contextPath,
  );

  const tag = gondolinTagFromDockerImageId(imageId, effectiveSizeMb);

  if (!deps.gondolinImageExists(tag)) {
    await deps.buildGondolinImage(imageId, tag, resolvedRuntime, effectiveSizeMb);
  }

  return tag;
}

// --- Default implementations (imperative shell) ---

async function detectRuntime(): Promise<"docker" | "podman"> {
  for (const candidate of ["docker", "podman"] as const) {
    const found = await new Promise<boolean>((resolve) => {
      execFile(candidate, ["--version"], (err) => resolve(!err));
    });
    if (found) {
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
  const iidFile = join(mkdtempSync(join(tmpdir(), "tuor-iid-")), "iid");
  const exitCode = await new Promise<number | null>((resolve) => {
    const proc = spawn(
      runtime,
      ["build", "--network=host", "--iidfile", iidFile, "-f", dockerfile, context],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    proc.on("close", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`${runtime} build failed with exit code ${exitCode}`);
  }
  return readFileSync(iidFile, "utf-8").trim();
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
    const { exitCode, stderr } = await new Promise<{ exitCode: number | null; stderr: string }>((resolve) => {
      const proc = spawn(
        "debugfs",
        [rootfsPath, "-R", `dump /usr/bin/${name} ${outPath}`],
        { stdio: ["ignore", "ignore", "pipe"] },
      );
      const chunks: Buffer[] = [];
      proc.stderr!.on("data", (chunk: Buffer) => chunks.push(chunk));
      proc.on("close", (code) => resolve({
        exitCode: code,
        stderr: Buffer.concat(chunks).toString("utf-8"),
      }));
    });
    if (exitCode !== 0) {
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
  runtime?: ContainerRuntime,
  rootfsSizeMb?: number,
): Promise<void> {
  const defaultAssets = await ensureGuestAssets();
  const binaries = await extractSandboxBinaries(defaultAssets.rootfsPath);

  const config = getDefaultBuildConfig();
  config.oci = { image: ociImage, pullPolicy: "if-not-present", runtime };
  config.rootfs = { sizeMb: rootfsSizeMb };
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
