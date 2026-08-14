import { existsSync, mkdirSync, rmSync } from "node:fs";
import type {
  Architecture,
  BuildConfig,
  BuildOptions,
  BuildResult,
  LocalImageRef,
} from "@earendil-works/gondolin";
import { getDefaultBuildConfig } from "@earendil-works/gondolin";
import { describe, expect, test, vi } from "vitest";
import {
  _hasCachedAssets,
  _hostArch,
  _lockPath,
  _preflightBuildTools,
  _tuorImageRef,
  ensureImageAssets,
  type ImageDeps,
  parseSizeToMb,
  type RootfsImageSpec,
} from "./image.ts";

function spec(overrides: Partial<RootfsImageSpec> = {}): RootfsImageSpec {
  return {
    ref: "docker.io/library/debian:bookworm-slim",
    pullPolicy: "if-not-present",
    buildPolicy: "if-not-present",
    ...overrides,
  };
}

function ref(
  reference: string,
  targets: LocalImageRef["targets"],
): LocalImageRef {
  return { reference, targets, updatedAt: "2026-01-01T00:00:00.000Z" };
}

/** Tool probe over an explicit allowlist of "installed" commands. */
function probe(installed: string[]): (command: string) => boolean {
  return (command) => installed.includes(command);
}

const ALL_TOOLS = [
  "docker",
  "podman",
  "mke2fs",
  "mkfs.ext4",
  "debugfs",
  "cpio",
  "lz4",
];

describe("_hostArch", () => {
  test.each([
    ["arm64", "aarch64"],
    ["x64", "x86_64"],
  ])("maps %s to %s", (nodeArch, expected) => {
    expect(_hostArch(nodeArch)).toBe(expected);
  });

  test.each(["ia32", "riscv64", "s390x"])("rejects %s", (nodeArch) => {
    expect(() => _hostArch(nodeArch)).toThrow(/Unsupported host architecture/);
  });
});

describe("parseSizeToMb", () => {
  test.each([
    ["8G", 8192],
    ["512M", 512],
    ["1T", 1024 * 1024],
    ["1048576K", 1024],
  ])("converts %s to %i MB", (size, expected) => {
    expect(parseSizeToMb(size)).toBe(expected);
  });

  test("rounds partial megabytes up", () => {
    expect(parseSizeToMb("1500K")).toBe(2);
  });

  test("never returns less than 1 MB", () => {
    expect(parseSizeToMb("1K")).toBe(1);
  });

  test("accepts lowercase unit suffixes", () => {
    expect(parseSizeToMb("4g")).toBe(4096);
  });

  test.each([
    "8GB",
    "8 G",
    "",
    "eight",
    "-8G",
    "8.5G",
    "2097152", // Unit suffix is mandatory
  ])("rejects %o", (size) => {
    expect(() => parseSizeToMb(size)).toThrow(/Invalid rootfs size/);
  });
});

describe("_tuorImageRef", () => {
  test("is stable for identical inputs", () => {
    expect(_tuorImageRef(spec(), "x86_64", "0.12.0")).toBe(
      _tuorImageRef(spec(), "x86_64", "0.12.0"),
    );
  });

  test("produces a ref name Gondolin accepts", () => {
    // Gondolin allows [A-Za-z0-9._/-] in names and requires each segment to
    // start alphanumeric — hence hashing the OCI ref instead of embedding it.
    expect(_tuorImageRef(spec(), "aarch64", "0.12.0")).toMatch(
      /^tuor\/[0-9a-f]{32}:latest$/,
    );
  });

  test.each([
    [
      "the OCI ref",
      spec({ ref: "docker.io/library/alpine:3.23" }),
      "x86_64",
      "0.12.0",
    ],
    ["the arch", spec(), "aarch64", "0.12.0"],
    ["the baked size", spec({ rootfsSizeMb: 8192 }), "x86_64", "0.12.0"],
    ["the gondolin version", spec(), "x86_64", "0.13.0"],
  ] as const)("changes when %s changes", (_what, s, arch, version) => {
    expect(_tuorImageRef(s, arch, version)).not.toBe(
      _tuorImageRef(spec(), "x86_64", "0.12.0"),
    );
  });

  /** engine only affects *how* identical assets are produced. */
  test("ignores the container engine", () => {
    expect(_tuorImageRef(spec({ engine: "podman" }), "x86_64", "0.12.0")).toBe(
      _tuorImageRef(spec({ engine: "docker" }), "x86_64", "0.12.0"),
    );
  });

  /** Both policies pick *when* to (re)fetch and (re)build, not what comes out. */
  test("ignores the pull policy", () => {
    expect(
      _tuorImageRef(spec({ pullPolicy: "always" }), "x86_64", "0.12.0"),
    ).toBe(_tuorImageRef(spec({ pullPolicy: "never" }), "x86_64", "0.12.0"));
  });

  test("ignores the build policy", () => {
    expect(
      _tuorImageRef(spec({ buildPolicy: "always" }), "x86_64", "0.12.0"),
    ).toBe(
      _tuorImageRef(
        spec({ buildPolicy: "if-not-present" }),
        "x86_64",
        "0.12.0",
      ),
    );
  });
});

describe("_hasCachedAssets", () => {
  const TUOR_REF = "tuor/abc:latest";

  test("finds a ref present for our arch", () => {
    const refs = [ref(TUOR_REF, { x86_64: "build-1" })];
    expect(_hasCachedAssets(TUOR_REF, "x86_64", refs)).toBe(true);
  });

  test("reports a miss when the ref is absent", () => {
    expect(_hasCachedAssets(TUOR_REF, "x86_64", [])).toBe(false);
  });

  test("reports a miss when the ref exists only for another arch", () => {
    const refs = [ref(TUOR_REF, { aarch64: "build-1" })];
    expect(_hasCachedAssets(TUOR_REF, "x86_64", refs)).toBe(false);
  });

  test("ignores refs belonging to other images", () => {
    const refs = [ref("tuor/other:latest", { x86_64: "build-1" })];
    expect(_hasCachedAssets(TUOR_REF, "x86_64", refs)).toBe(false);
  });
});

describe("_preflightBuildTools", () => {
  test("passes when every tool is present", () => {
    expect(() =>
      _preflightBuildTools(undefined, probe(ALL_TOOLS)),
    ).not.toThrow();
  });

  /**
   * Gondolin's findMke2fs accepts either binary, so requiring `mke2fs`
   * specifically would false-fail hosts that ship only `mkfs.ext4`.
   */
  test("accepts mkfs.ext4 in place of mke2fs", () => {
    const installed = ALL_TOOLS.filter((t) => t !== "mke2fs");
    expect(() =>
      _preflightBuildTools(undefined, probe(installed)),
    ).not.toThrow();
  });

  test("accepts mke2fs in place of mkfs.ext4", () => {
    const installed = ALL_TOOLS.filter((t) => t !== "mkfs.ext4");
    expect(() =>
      _preflightBuildTools(undefined, probe(installed)),
    ).not.toThrow();
  });

  test("fails when neither mke2fs nor mkfs.ext4 is present", () => {
    const installed = ALL_TOOLS.filter(
      (t) => t !== "mke2fs" && t !== "mkfs.ext4",
    );
    expect(() => _preflightBuildTools(undefined, probe(installed))).toThrow(
      /mke2fs/,
    );
  });

  test.each(["debugfs", "cpio", "lz4"])("fails naming a missing %s", (tool) => {
    const installed = ALL_TOOLS.filter((t) => t !== tool);
    expect(() => _preflightBuildTools(undefined, probe(installed))).toThrow(
      new RegExp(tool),
    );
  });

  /**
   * Either engine alone suffices, and we assert nothing about which one is
   * picked: Tuor selects no engine, it only checks that one exists (Gondolin's
   * own detectOciRuntime owns the docker→podman preference).
   */
  test.each(["docker", "podman"])("passes with only %s installed", (engine) => {
    const installed = ALL_TOOLS.filter(
      (t) => t === engine || (t !== "docker" && t !== "podman"),
    );
    expect(() =>
      _preflightBuildTools(undefined, probe(installed)),
    ).not.toThrow();
  });

  test("fails when neither docker nor podman is installed", () => {
    const installed = ALL_TOOLS.filter((t) => t !== "docker" && t !== "podman");
    expect(() => _preflightBuildTools(undefined, probe(installed))).toThrow(
      /Docker or Podman/,
    );
  });

  test("fails naming an explicitly configured engine that is missing", () => {
    const installed = ALL_TOOLS.filter((t) => t !== "docker");
    expect(() => _preflightBuildTools("docker", probe(installed))).toThrow(
      /"docker"/,
    );
  });

  test("does not accept the other engine when one was configured explicitly", () => {
    const installed = ALL_TOOLS.filter((t) => t !== "podman");
    expect(() => _preflightBuildTools("podman", probe(installed))).toThrow(
      /"podman"/,
    );
  });
});

// --- ensureImageAssets ---

const FAKE_GONDOLIN_VERSION = "0.12.0";

type ImageCalls = {
  resolveImageSelector: Array<{ selector: string; arch?: Architecture }>;
  buildAssets: Array<{ config: BuildConfig; options: BuildOptions }>;
  importImageFromDirectory: string[];
  setImageRef: Array<{
    reference: string;
    buildId: string;
    arch: Architecture;
  }>;
  logs: string[];
};

type HarnessOptions = {
  /** Refs in the image store. Mutated in place to model a concurrent builder. */
  refs?: LocalImageRef[];
  installed?: string[];
  arch?: Architecture;
  gondolinVersion?: string;
  /** Runs inside the fake `buildAssets` — throw here to model a failed build. */
  onBuild?: (options: BuildOptions) => void;
};

/**
 * Fake {@link ImageDeps} that records every call, so `ensureImageAssets` can be
 * driven without Docker, a real build, or the host's own architecture.
 */
function harness(options: HarnessOptions = {}): {
  deps: ImageDeps;
  calls: ImageCalls;
} {
  const {
    refs = [],
    installed = ALL_TOOLS,
    arch = "x86_64",
    gondolinVersion = FAKE_GONDOLIN_VERSION,
    onBuild,
  } = options;

  const calls: ImageCalls = {
    resolveImageSelector: [],
    buildAssets: [],
    importImageFromDirectory: [],
    setImageRef: [],
    logs: [],
  };

  const deps: ImageDeps = {
    hasCommand: probe(installed),
    listImageRefs: () => refs,
    resolveImageSelector: (selector, selectorArch) => {
      calls.resolveImageSelector.push({ selector, arch: selectorArch });
      return { source: "ref", selector, assetDir: "/store/cached" };
    },
    importImageFromDirectory: (assetDir) => {
      calls.importImageFromDirectory.push(assetDir);
      return {
        buildId: "build-1",
        arch,
        assetDir: "/store/built",
        created: true,
      };
    },
    setImageRef: (reference, buildId, refArch) => {
      calls.setImageRef.push({ reference, buildId, arch: refArch });
      return undefined;
    },
    buildAssets: async (config, buildOptions) => {
      calls.buildAssets.push({ config, options: buildOptions });
      onBuild?.(buildOptions);
      return {
        outputDir: buildOptions.outputDir,
        manifestPath: `${buildOptions.outputDir}/manifest.json`,
        manifest: {},
      } as BuildResult;
    },
    gondolinVersion: () => gondolinVersion,
    hostArch: () => arch,
    log: (message) => calls.logs.push(message),
  };

  return { deps, calls };
}

function cachedRef(s: RootfsImageSpec, arch: Architecture): LocalImageRef {
  return ref(_tuorImageRef(s, arch, FAKE_GONDOLIN_VERSION), {
    [arch]: "build-0",
  });
}

/** The single `BuildConfig` handed to Gondolin by a run that built. */
function builtConfig(calls: ImageCalls): BuildConfig {
  expect(calls.buildAssets).toHaveLength(1);
  return calls.buildAssets[0]!.config;
}

describe("ensureImageAssets", () => {
  describe("caching", () => {
    test("returns cached assets without building", async () => {
      const { deps, calls } = harness({ refs: [cachedRef(spec(), "x86_64")] });

      await expect(ensureImageAssets(spec(), deps)).resolves.toBe(
        "/store/cached",
      );
      expect(calls.buildAssets).toHaveLength(0);
      expect(calls.resolveImageSelector).toEqual([
        {
          selector: _tuorImageRef(spec(), "x86_64", FAKE_GONDOLIN_VERSION),
          arch: "x86_64",
        },
      ]);
    });

    /**
     * A cache hit must not need a container engine or e2fsprogs: only *building*
     * requires them, and demanding them to reuse assets would break hosts that
     * built the image once and then uninstalled the toolchain.
     */
    test("reuses cached assets on a host with no build tools", async () => {
      const { deps } = harness({
        refs: [cachedRef(spec(), "x86_64")],
        installed: [],
      });

      await expect(ensureImageAssets(spec(), deps)).resolves.toBe(
        "/store/cached",
      );
    });

    test("builds, imports and tags when nothing is cached", async () => {
      const { deps, calls } = harness();

      await expect(ensureImageAssets(spec(), deps)).resolves.toBe(
        "/store/built",
      );
      // The built assets are imported from the scratch dir Gondolin built into.
      expect(calls.importImageFromDirectory).toEqual([
        calls.buildAssets[0]!.options.outputDir,
      ]);
      expect(calls.setImageRef).toEqual([
        {
          reference: _tuorImageRef(spec(), "x86_64", FAKE_GONDOLIN_VERSION),
          buildId: "build-1",
          arch: "x86_64",
        },
      ]);
    });

    test("rebuilds under buildPolicy always, despite a cache hit", async () => {
      const s = spec({ buildPolicy: "always" });
      const { deps, calls } = harness({ refs: [cachedRef(s, "x86_64")] });

      await expect(ensureImageAssets(s, deps)).resolves.toBe("/store/built");
      expect(calls.buildAssets).toHaveLength(1);
    });

    /**
     * The two policies are independent axes: `pullPolicy` says where the OCI
     * image comes from, `buildPolicy` whether assets are rebuilt from it. On a
     * cache hit there is no build, so no image is needed and nothing is pulled
     * — asking for a fresh pull cannot by itself invalidate the assets.
     */
    test("reuses cached assets under pullPolicy always", async () => {
      const s = spec({ pullPolicy: "always" });
      const { deps, calls } = harness({ refs: [cachedRef(s, "x86_64")] });

      await expect(ensureImageAssets(s, deps)).resolves.toBe("/store/cached");
      expect(calls.buildAssets).toHaveLength(0);
    });

    /** Rebuild the assets, but off the local image rather than the registry. */
    test("rebuilds without pulling under buildPolicy always, pullPolicy never", async () => {
      const s = spec({ buildPolicy: "always", pullPolicy: "never" });
      const { deps, calls } = harness({ refs: [cachedRef(s, "x86_64")] });

      await expect(ensureImageAssets(s, deps)).resolves.toBe("/store/built");
      expect(calls.buildAssets).toHaveLength(1);
      expect(builtConfig(calls).oci).toEqual({
        image: s.ref,
        pullPolicy: "never",
      });
    });

    /** A Gondolin upgrade changes the ref, so old assets are not reused. */
    test("rebuilds after the Gondolin version changes", async () => {
      const { deps, calls } = harness({
        refs: [cachedRef(spec(), "x86_64")],
        gondolinVersion: "0.13.0",
      });

      await expect(ensureImageAssets(spec(), deps)).resolves.toBe(
        "/store/built",
      );
      expect(calls.buildAssets).toHaveLength(1);
    });
  });

  /**
   * Both directions are exercised so these stay meaningful on an aarch64 host
   * too: a run that read `process.arch` instead of the injected value would
   * pass whichever case happens to match the machine running the suite.
   */
  describe("architecture", () => {
    test.each([
      "x86_64",
      "aarch64",
    ] as const)("builds and tags for the injected %s", async (arch) => {
      const { deps, calls } = harness({ arch });

      await ensureImageAssets(spec(), deps);
      expect(builtConfig(calls).arch).toBe(arch);
      expect(calls.setImageRef[0]!.arch).toBe(arch);
    });

    test.each([
      ["x86_64", "aarch64"],
      ["aarch64", "x86_64"],
    ] as const)("on %s, ignores assets cached for %s", async (arch, otherArch) => {
      const { deps, calls } = harness({
        refs: [cachedRef(spec(), otherArch)],
        arch,
      });

      await expect(ensureImageAssets(spec(), deps)).resolves.toBe(
        "/store/built",
      );
      expect(calls.buildAssets).toHaveLength(1);
    });
  });

  describe("build config", () => {
    test("forwards the OCI ref and pull policy", async () => {
      const s = spec({ pullPolicy: "never" });
      const { deps, calls } = harness();

      await ensureImageAssets(s, deps);
      expect(builtConfig(calls).oci).toEqual({
        image: s.ref,
        pullPolicy: "never",
      });
    });

    /** Omitted rather than defaulted, so Gondolin's own detection stays in charge. */
    test("omits the runtime when no engine is configured", async () => {
      const { deps, calls } = harness();

      await ensureImageAssets(spec(), deps);
      expect(builtConfig(calls).oci).not.toHaveProperty("runtime");
    });

    test("forwards an explicitly configured engine as the runtime", async () => {
      const { deps, calls } = harness();

      await ensureImageAssets(spec({ engine: "podman" }), deps);
      expect(builtConfig(calls).oci?.runtime).toBe("podman");
    });

    /** Merged, not replaced: dropping Gondolin's default label breaks boot. */
    test("bakes in the rootfs size while keeping the default label", async () => {
      const { deps, calls } = harness();

      await ensureImageAssets(spec({ rootfsSizeMb: 8192 }), deps);
      expect(builtConfig(calls).rootfs).toEqual({
        ...getDefaultBuildConfig().rootfs,
        sizeMb: 8192,
      });
    });

    test("leaves rootfs untouched when no size is configured", async () => {
      const { deps, calls } = harness();

      await ensureImageAssets(spec(), deps);
      expect(builtConfig(calls).rootfs).toEqual(getDefaultBuildConfig().rootfs);
    });
  });

  describe("preflight", () => {
    /**
     * The point of preflighting is to fail *before* Gondolin downloads sandbox
     * helper binaries, so a missing tool must abort the build, not surface from
     * inside it.
     */
    test("fails without building when a required tool is missing", async () => {
      const { deps, calls } = harness({
        installed: ALL_TOOLS.filter((t) => t !== "lz4"),
      });

      await expect(ensureImageAssets(spec(), deps)).rejects.toThrow(/lz4/);
      expect(calls.buildAssets).toHaveLength(0);
    });

    test("fails without building when no container engine is present", async () => {
      const { deps, calls } = harness({
        installed: ALL_TOOLS.filter((t) => t !== "docker" && t !== "podman"),
      });

      await expect(ensureImageAssets(spec(), deps)).rejects.toThrow(
        /Docker or Podman/,
      );
      expect(calls.buildAssets).toHaveLength(0);
    });
  });

  describe("scratch dir", () => {
    test("removes the build dir after a successful build", async () => {
      const { deps, calls } = harness();

      await ensureImageAssets(spec(), deps);
      expect(existsSync(calls.buildAssets[0]!.options.outputDir)).toBe(false);
    });

    test("removes the build dir when the build fails", async () => {
      let outputDir = "";
      const { deps } = harness({
        onBuild: (options) => {
          outputDir = options.outputDir;
          throw new Error("mke2fs exploded");
        },
      });

      await expect(ensureImageAssets(spec(), deps)).rejects.toThrow(
        "mke2fs exploded",
      );
      expect(existsSync(outputDir)).toBe(false);
    });
  });

  describe("build lock", () => {
    const lockPath = _lockPath(
      _tuorImageRef(spec(), "x86_64", FAKE_GONDOLIN_VERSION),
    );

    /** Runs `body` with the lock guaranteed cleaned up afterwards. */
    async function withLockCleanup(body: () => Promise<void>): Promise<void> {
      try {
        await body();
      } finally {
        rmSync(lockPath, { recursive: true, force: true });
      }
    }

    test("releases the lock after a successful build", async () => {
      const { deps } = harness();

      await withLockCleanup(async () => {
        await ensureImageAssets(spec(), deps);
        expect(existsSync(lockPath)).toBe(false);
      });
    });

    test("releases the lock when the build fails", async () => {
      const { deps } = harness({
        onBuild: () => {
          throw new Error("mke2fs exploded");
        },
      });

      await withLockCleanup(async () => {
        await expect(ensureImageAssets(spec(), deps)).rejects.toThrow();
        expect(existsSync(lockPath)).toBe(false);
      });
    });

    /**
     * The whole point of the lock: the loser of the race must pick up the
     * winner's assets instead of paying for the same pull + mke2fs again.
     */
    test("waits for a concurrent builder and reuses its result", async () => {
      const refs: LocalImageRef[] = [];
      const { deps, calls } = harness({ refs });

      vi.useFakeTimers();
      await withLockCleanup(async () => {
        try {
          mkdirSync(lockPath);
          const pending = ensureImageAssets(spec(), deps);
          await vi.advanceTimersByTimeAsync(2000);

          // The other builder finishes: it stores its assets and drops the lock.
          refs.push(cachedRef(spec(), "x86_64"));
          rmSync(lockPath, { recursive: true });
          await vi.advanceTimersByTimeAsync(2000);

          await expect(pending).resolves.toBe("/store/cached");
          expect(calls.buildAssets).toHaveLength(0);
          expect(calls.logs).toContain(
            "Another Tuor process is building this rootfs; waiting…",
          );
        } finally {
          vi.useRealTimers();
        }
      });
    });

    /**
     * A crashed builder leaves its lock behind forever, so waiting must not be
     * unbounded — the image store dedups whatever we build in the meantime.
     */
    test("builds anyway when a stale lock outlives the timeout", async () => {
      const { deps, calls } = harness();

      vi.useFakeTimers();
      await withLockCleanup(async () => {
        try {
          mkdirSync(lockPath);
          const pending = ensureImageAssets(spec(), deps);
          await vi.advanceTimersByTimeAsync(11 * 60 * 1000);

          await expect(pending).resolves.toBe("/store/built");
          expect(calls.buildAssets).toHaveLength(1);
          expect(calls.logs.join("\n")).toMatch(/Timed out/);
          // The lock belongs to the other process — ensureImageAssets() never
          // acquired it, so removing it isn't that function's job, either.
          expect(existsSync(lockPath)).toBe(true);
        } finally {
          vi.useRealTimers();
        }
      });
    });
  });
});
