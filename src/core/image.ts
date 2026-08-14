import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type Architecture,
  type BuildConfig,
  type BuildOptions,
  type BuildResult,
  buildAssets,
  getDefaultBuildConfig,
  type ImportedImage,
  importImageFromDirectory,
  type LocalImageRef,
  listImageRefs,
  type ResolvedImage,
  resolveImageSelector,
  setImageRef,
} from "@earendil-works/gondolin";

// --- Types ---

export type RootfsPullPolicy = "always" | "if-not-present" | "never";
export type RootfsBuildPolicy = "always" | "if-not-present";
export type ContainerEngine = "docker" | "podman";

/**
 * Core's input contract for a custom guest rootfs: the OCI image to build from
 * plus the knobs that affect the built assets.
 *
 * The two policies are independent axes: `pullPolicy` says where the OCI image
 * comes from, `buildPolicy` whether the guest assets are rebuilt from it. Since
 * a reused asset needs no image at all, `pullPolicy` only matters on the runs
 * that actually build.
 */
export type RootfsImageSpec = {
  /** OCI image ref: `repo/name[:tag]` or `repo/name@sha256:…`. */
  ref: string;
  pullPolicy: RootfsPullPolicy;
  buildPolicy: RootfsBuildPolicy;
  /** Omitted → Gondolin auto-detects (docker, else podman). */
  engine?: ContainerEngine;
  /** Total rootfs size baked into the built image (see `parseSizeToMb`). */
  rootfsSizeMb?: number;
};

/**
 * Injectable seams for {@link ensureImageAssets}: the Gondolin entry points it
 * drives plus host probing and logging. Exists so the cache decision and the
 * host-tool preflight are unit-testable without Docker or a real build.
 */
export type ImageDeps = {
  /** Whether `command` is on PATH. */
  hasCommand: (command: string) => boolean;
  listImageRefs: () => LocalImageRef[];
  resolveImageSelector: (
    selector: string,
    arch?: Architecture,
  ) => ResolvedImage;
  importImageFromDirectory: (assetDir: string) => ImportedImage;
  setImageRef: (
    reference: string,
    buildId: string,
    arch: Architecture,
  ) => unknown;
  buildAssets: (
    config: BuildConfig,
    options: BuildOptions,
  ) => Promise<BuildResult>;
  /** Version of the installed Gondolin — part of the cache identity. */
  gondolinVersion: () => string;
  /** Architecture to build for — part of the cache identity. */
  hostArch: () => Architecture;
  log: (message: string) => void;
};

// --- Public API ---

/**
 * Ensure Gondolin guest assets exist for `spec` and return the directory
 * holding them (ready to hand to `VM.create({ sandbox: { imagePath } })`).
 *
 * Assets are cached in **Gondolin's own content-addressed image store**
 * (`~/.cache/gondolin/images`, or `$GONDOLIN_IMAGE_STORE`) rather than a Tuor
 * cache directory, so we inherit its atomic writes, content dedup and
 * concurrent-import handling; Tuor owns no cache dir of its own. Each build is
 * tagged with a `tuor/<hash>:latest` ref (see {@link _tuorImageRef}), which also
 * makes Tuor-built images identifiable in Gondolin tooling.
 *
 * Building is slow (image pull + mke2fs), so it happens at most once per cache
 * identity — unless `buildPolicy` is "always", which rebuilds every run.
 * `pullPolicy` governs the separate question of where the OCI image comes
 * from, and so only matters on the runs that do build.
 */
export async function ensureImageAssets(
  spec: RootfsImageSpec,
  deps: ImageDeps = defaultImageDeps,
): Promise<string> {
  const arch = deps.hostArch();
  const tuorRef = _tuorImageRef(spec, arch, deps.gondolinVersion());
  const reuseCached = spec.buildPolicy !== "always";

  const cached = reuseCached ? resolveCached(tuorRef, arch, deps) : undefined;
  if (cached) return cached;

  // Fail fast on a host that can't build, *before* Gondolin downloads sandbox
  // helper binaries (which it does before reaching its own engine check).
  _preflightBuildTools(spec.engine, deps.hasCommand);

  return await withBuildLock(_lockPath(tuorRef), deps, async (contended) => {
    // A concurrent builder may have finished while we waited for the lock.
    if (contended && reuseCached) {
      const now = resolveCached(tuorRef, arch, deps);
      if (now) return now;
    }
    return await buildAndStore(spec, arch, tuorRef, deps);
  });
}

/**
 * Regex for byte size values: a positive integer plus a *mandatory* K/M/G/T
 * unit.
 *
 * Note that the unit suffix is mandatory for expliciteness, even if that might
 * not be required by Gondolin/QEMU.
 */
export const SIZE_FORMAT = /^(\d+)([KMGT])$/i;

/**
 * Convert a `rootfs.size` value (`"8G"`, `"512M"`) into whole megabytes,
 * rounded up, minimum 1.
 */
export function parseSizeToMb(size: string): number {
  const match = SIZE_FORMAT.exec(size.trim());
  if (!match) {
    throw new Error(
      `Invalid rootfs size: "${size}". Expected a positive integer with a ` +
        'K/M/G/T suffix, e.g. "512M" or "8G".',
    );
  }
  const unit = match[2]!.toUpperCase() as keyof typeof BYTES_PER_UNIT;
  const bytes = Number(match[1]) * BYTES_PER_UNIT[unit];
  return Math.max(1, Math.ceil(bytes / (1024 * 1024)));
}

// --- Internals ---

const BYTES_PER_UNIT = {
  K: 1024,
  M: 1024 ** 2,
  G: 1024 ** 3,
  T: 1024 ** 4,
} as const;

/** How long to wait for a concurrent builder before building anyway. */
const LOCK_TIMEOUT_MS = 10 * 60 * 1000;
const LOCK_POLL_INTERVAL_MS = 500;

/**
 * Map Node's `process.arch` onto Gondolin's architecture names. v1 builds for
 * the host architecture only — cross-arch builds are out of scope, and a
 * mismatched arch would yield an unbootable rootfs.
 *
 * Takes `nodeArch` explicitly rather than defaulting to `process.arch`: reading
 * the ambient value is the default dep's job, so that injecting `hostArch` is
 * the *only* way to vary the arch (see {@link ImageDeps}).
 */
export function _hostArch(nodeArch: string): Architecture {
  switch (nodeArch) {
    case "arm64":
      return "aarch64";
    case "x64":
      return "x86_64";
    default:
      throw new Error(
        `Unsupported host architecture "${nodeArch}" for building a custom ` +
          "rootfs. Only arm64 and x64 are supported.",
      );
  }
}

/**
 * The Gondolin image ref under which Tuor stores the assets built for `spec`.
 */
export function _tuorImageRef(
  spec: RootfsImageSpec,
  arch: Architecture,
  gondolinVersion: string,
): string {
  // In the ref include all parameters that might change the build outcome.
  // Gondolin ref names allow only `[A-Za-z0-9._/-]`, so hash them all.
  const identity = JSON.stringify([
    spec.ref,
    arch,
    spec.rootfsSizeMb ?? null,
    gondolinVersion, // Different versions of Gondolin bake different assets into the rootfs.
  ]);
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 32);
  return `tuor/${hash}:latest`;
}

/**
 * Whether the image store holds assets for `tuorRef` on `arch`.
 *
 * Presence is a plain lookup over `listImageRefs()` rather than catching a throw
 * from `resolveImageSelector`: Gondolin does not export its `ImageResolutionError`,
 * so a miss would be indistinguishable from a real failure. (`listImageRefs`
 * already omits broken ref links, so a hit here really is resolvable.)
 *
 * Whether a hit may be *used* is the caller's call — a policy of "always"
 * ignores the cache entirely.
 */
export function _hasCachedAssets(
  tuorRef: string,
  arch: Architecture,
  refs: LocalImageRef[],
): boolean {
  return refs.some(
    (ref) => ref.reference === tuorRef && ref.targets[arch] !== undefined,
  );
}

/**
 * Verify the host can build a custom rootfs, naming the missing tool when it
 * can't.
 *
 * Gondolin checks for these too, but too late to be useful: `cpio`/`lz4` are
 * invoked inside a shell pipeline, so their absence surfaces as a bare non-zero
 * exit code that names nothing, and the container-engine check only runs after
 * sandbox helper binaries have been downloaded.
 *
 * We deliberately do not pick an engine — that stays Gondolin's job. We just
 * assert that *some* engine exists.
 */
export function _preflightBuildTools(
  engine: ContainerEngine | undefined,
  hasCommand: (command: string) => boolean,
): void {
  if (engine) {
    if (!hasCommand(engine)) {
      throw new Error(
        `Building a custom rootfs requires the "${engine}" container engine ` +
          "(rootfs.image.engine), but it was not found on PATH.",
      );
    }
  } else if (!hasCommand("docker") && !hasCommand("podman")) {
    throw new Error(
      "Building a custom rootfs requires Docker or Podman on PATH to pull and " +
        "export the OCI image. Install one, or set rootfs.image.engine.",
    );
  }

  for (const tool of REQUIRED_BUILD_TOOLS) {
    if (!tool.commands.some(hasCommand)) {
      throw new Error(
        `Building a custom rootfs requires "${tool.commands[0]}", but it was ` +
          `not found on PATH. Install it (e.g. "apt install ${tool.aptPackages}").`,
      );
    }
  }
}

/**
 * Host tools Gondolin's native OCI build path shells out to. `mke2fs` and
 * `mkfs.ext4` are interchangeable (Gondolin's `findMke2fs` accepts either), so
 * they share one entry — requiring both would false-fail hosts that ship only
 * `mkfs.ext4`.
 */
const REQUIRED_BUILD_TOOLS = [
  { commands: ["mke2fs", "mkfs.ext4"], aptPackages: "e2fsprogs" },
  { commands: ["debugfs"], aptPackages: "e2fsprogs" },
  { commands: ["cpio"], aptPackages: "cpio" },
  { commands: ["lz4"], aptPackages: "lz4" },
] as const;

/** Resolve already-built assets for `tuorRef`, or undefined when missing. */
function resolveCached(
  tuorRef: string,
  arch: Architecture,
  deps: ImageDeps,
): string | undefined {
  if (!_hasCachedAssets(tuorRef, arch, deps.listImageRefs())) {
    return undefined;
  }
  return deps.resolveImageSelector(tuorRef, arch).assetDir;
}

async function buildAndStore(
  spec: RootfsImageSpec,
  arch: Architecture,
  tuorRef: string,
  deps: ImageDeps,
): Promise<string> {
  const defaults = getDefaultBuildConfig();
  const buildConfig: BuildConfig = {
    ...defaults,
    arch,
    oci: {
      image: spec.ref,
      pullPolicy: spec.pullPolicy,
      // Only forwarded when the user asked for a specific engine; otherwise
      // Gondolin auto-detects.
      ...(spec.engine ? { runtime: spec.engine } : {}),
    },
    // Merge rather than replace, so Gondolin's default volume label survives.
    // A baked size needs no in-guest resize2fs at boot.
    ...(spec.rootfsSizeMb
      ? { rootfs: { ...defaults.rootfs, sizeMb: spec.rootfsSizeMb } }
      : {}),
  };

  // The build dir is scratch space: everything worth keeping is copied into the
  // image store by the import below.
  const outputDir = mkdtempSync(join(tmpdir(), "tuor-build-"));
  try {
    deps.log(
      `Building custom rootfs from ${spec.ref} (this can take a while)…`,
    );
    await deps.buildAssets(buildConfig, { outputDir });

    deps.log(`Importing assets into Gondolin as '${tuorRef}'...`);
    // importImageFromDirectory validates the assets, copies them into the store
    // under their content-derived build id (temp dir + atomic rename, tolerating
    // a concurrent import of the same content), and hands back both the id and
    // the stored directory — so we never parse manifest.json ourselves.
    const imported = deps.importImageFromDirectory(outputDir);
    deps.setImageRef(tuorRef, imported.buildId, arch);
    deps.log(`Import complete! Assets written to ${imported.assetDir}`);

    return imported.assetDir;
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
}

/**
 * Run `build` while holding a lockfile, so two cold `tuor run`s don't both pay
 * for the same image pull + mke2fs.
 *
 * This is purely an optimization: correctness comes from the image store, which
 * dedups identical content on import. That makes a stale lock (crashed builder)
 * harmless — we wait a while, then build anyway and let the store sort it out.
 * `build` is told whether it had to wait, so it can re-check the cache first.
 */
async function withBuildLock<T>(
  lockPath: string,
  deps: ImageDeps,
  build: (contended: boolean) => Promise<T>,
): Promise<T> {
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let contended = false;

  while (!tryAcquireLock(lockPath)) {
    if (!contended) {
      contended = true;
      deps.log("Another Tuor process is building this rootfs; waiting…");
    }
    if (Date.now() >= deadline) {
      deps.log(
        "Timed out waiting for the rootfs build lock; building anyway. " +
          "(Identical results are deduplicated by the image store.)",
      );
      return await build(true);
    }
    await sleep(LOCK_POLL_INTERVAL_MS);
  }

  try {
    return await build(contended);
  } finally {
    rmSync(lockPath, { recursive: true, force: true });
  }
}

/** `mkdir` is atomic, so a successful create means we hold the lock. */
function tryAcquireLock(lockPath: string): boolean {
  try {
    mkdirSync(lockPath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
    throw error;
  }
}

/** Path of the build lockfile for an image ref, with a filesystem-safe basename. */
export function _lockPath(tuorRef: string): string {
  const name = tuorRef.replace(/[^A-Za-z0-9._-]/g, "-");
  return join(tmpdir(), `tuor-rootfs-${name}.lock`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- Default deps ---

function hasCommandOnPath(command: string): boolean {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Read the *installed* Gondolin's version at runtime (not the one Tuor was built
 * against), since Tuor depends on a version range.
 */
function readGondolinVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("@earendil-works/gondolin/package.json") as {
      version?: string;
    };
    return pkg.version ?? "unknown";
  } catch {
    throw new Error("Could not determine Gondolin version");
  }
}

const defaultImageDeps: ImageDeps = {
  hasCommand: hasCommandOnPath,
  listImageRefs,
  resolveImageSelector,
  importImageFromDirectory,
  setImageRef,
  buildAssets,
  gondolinVersion: readGondolinVersion,
  hostArch: () => _hostArch(process.arch),
  log: (message) => console.log(message),
};
