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
import type { ContainerEngine, OciImage, RootfsConfig } from "./config.ts";

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
  detectEngine: () => Promise<"docker" | "podman">;
  buildContainerImage: (
    engine: string,
    containerfile: string,
    context: string,
  ) => Promise<string>;
  gondolinImageExists: (tag: string) => boolean;
  buildGondolinImage: (
    ociImage: string,
    tag: string,
    engine?: ContainerEngine,
    rootfsSizeMb?: number,
  ) => Promise<void>;
};

// --- Orchestration ---

async function resolveImage(
  rootfs: RootfsConfig,
  configDir: string,
  deps: ImageDeps = defaultImageDeps,
): Promise<string> {
  const { ociImage } = rootfs;
  const effectiveSizeMb = rootfs.fsSize ?? DEFAULT_ROOTFS_SIZE_MB;

  if ("tag" in ociImage) {
    const { engine } = ociImage;
    const tag = gondolinTagFromOciRef(ociImage.tag, effectiveSizeMb);
    if (!deps.gondolinImageExists(tag)) {
      await deps.buildGondolinImage(ociImage.tag, tag, engine, effectiveSizeMb);
    }
    return tag;
  }

  const containerfilePath = resolve(configDir, ociImage.containerfile);
  const contextPath = ociImage.context
    ? resolve(configDir, ociImage.context)
    : dirname(containerfilePath);

  const resolvedEngine = ociImage.engine ?? await deps.detectEngine();
  const imageId = await deps.buildContainerImage(
    resolvedEngine,
    containerfilePath,
    contextPath,
  );

  const tag = gondolinTagFromDockerImageId(imageId, effectiveSizeMb);

  if (!deps.gondolinImageExists(tag)) {
    await deps.buildGondolinImage(imageId, tag, resolvedEngine, effectiveSizeMb);
  }

  return tag;
}

// --- Default implementations (imperative shell) ---

async function detectEngine(): Promise<"docker" | "podman"> {
  for (const candidate of ["docker", "podman"] as const) {
    const found = await new Promise<boolean>((resolve) => {
      execFile(candidate, ["--version"], (err) => resolve(!err));
    });
    if (found) {
      return candidate;
    }
  }
  throw new Error(
    "No container engine found. Install Docker or Podman.",
  );
}

async function buildContainerImage(
  engine: string,
  containerfile: string,
  context: string,
): Promise<string> {
  const iidFile = join(mkdtempSync(join(tmpdir(), "tuor-iid-")), "iid");
  const exitCode = await new Promise<number | null>((resolve) => {
    const proc = spawn(
      engine,
      ["build", "--network=host", "--iidfile", iidFile, "-f", containerfile, context],
      { stdio: ["ignore", "inherit", "inherit"] },
    );
    proc.on("close", resolve);
  });
  if (exitCode !== 0) {
    throw new Error(`${engine} build failed with exit code ${exitCode}`);
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
  engine?: ContainerEngine,
  rootfsSizeMb?: number,
): Promise<void> {
  const defaultAssets = await ensureGuestAssets();
  const binaries = await extractSandboxBinaries(defaultAssets.rootfsPath);

  const config = getDefaultBuildConfig();
  config.oci = { image: ociImage, pullPolicy: "if-not-present", runtime: engine };
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
  detectEngine,
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
