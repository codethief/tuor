import { createHttpHooks, VM } from "@earendil-works/gondolin";
import {
  ensureImageAssets,
  parseSizeToMb,
  type RootfsImageSpec,
} from "./image.ts";
import {
  buildVfsMounts,
  buildVfsVolumes,
  type MountSpec,
  type VolumeSpec,
} from "./mounts.ts";

// --- Types ---

export type SecretSpec = {
  hosts: string[];
  value: string;
};

export type NetworkSpec =
  | { mode: "open" }
  | {
      mode: "restricted";
      allowedHosts: string[];
      allowedInternalHosts: string[];
    };

/**
 * Resolved QEMU tuning for the single acceleration mode selected at config
 * resolution time (see resolve.ts). Fields map verbatim to Gondolin's
 * `sandbox.{accel,cpu,machineType}`.
 */
export type QemuSpec = {
  accel?: string;
  cpu?: string;
  machineType?: string;
};

/**
 * Resolved VM resource sizing. `memory`/`cpus` map verbatim to Gondolin's
 * top-level options. An unset field falls back to Gondolin's default.
 */
export type ResourcesSpec = {
  memory?: string;
  cpus?: number;
};

/**
 * Resolved root filesystem sizing & source. `size` is QEMU syntax; how it is
 * applied depends on whether an `image` is built — see {@link runSession}.
 */
export type RootfsSpec = {
  image?: RootfsImageSpec;
  size?: string;
};

/** Core's top-level input contract — everything the session needs to run. */
export type SessionSpec = {
  workdir: string;
  network: NetworkSpec;
  mounts: MountSpec[];
  volumes?: VolumeSpec[];
  resources?: ResourcesSpec;
  rootfs?: RootfsSpec;
  env?: Record<string, string>;
  secrets?: Record<string, SecretSpec>;
  qemu?: QemuSpec;
  /**
   * Shell command lines run once, as root, after boot and before the shell.
   * See TuorConfig.bootCommands.
   */
  bootCommands?: string[];
};

// --- Public API ---

export async function runSession(
  spec: SessionSpec,
  command?: string[],
): Promise<void> {
  const mountProviders =
    spec.mounts.length > 0 ? buildVfsMounts(spec.mounts) : {};
  const volumeProviders =
    spec.volumes && spec.volumes.length > 0
      ? buildVfsVolumes(spec.volumes)
      : {};
  const vfsMounts = { ...mountProviders, ...volumeProviders };
  const hasVfsMounts = Object.keys(vfsMounts).length > 0;

  const { env: placeholderSecretsEnv, ...networkOptions } = buildNetworkOptions(
    spec.network,
    spec.secrets,
  );

  // Placeholder env wins over user env so secrets can't be leaked via env config
  const mergedEnv = { ...spec.env, ...placeholderSecretsEnv };
  const hasEnv = Object.keys(mergedEnv).length > 0;

  // A custom rootfs image has to be *built* (Gondolin's OCI support is
  // build-time, not runtime): build once, cache globally, then boot from the
  // resulting asset dir. We pass the already-resolved local directory rather
  // than the cache's image ref on purpose — Gondolin's ref resolution can fall
  // back to downloading from its builtin registry, which would turn a cache
  // miss into a confusing remote lookup for a `tuor/<hash>` name that exists
  // nowhere upstream.
  const imagePath = spec.rootfs?.image
    ? await ensureImageAssets({
        ...spec.rootfs.image,
        ...(spec.rootfs.size
          ? { rootfsSizeMb: parseSizeToMb(spec.rootfs.size) }
          : {}),
      })
    : undefined;

  // Size dispatch: for a built image the size is baked in above (no in-guest
  // resize2fs needed, which minimal images often lack), so only the default
  // image gets grown at runtime.
  const growSize =
    spec.rootfs?.size && !spec.rootfs?.image ? spec.rootfs.size : undefined;

  const sandbox = { ...spec.qemu, ...(imagePath ? { imagePath } : {}) };
  const hasSandbox = Object.keys(sandbox).length > 0;

  console.log("Starting VM…");
  const vm = await VM.create({
    ...networkOptions,
    ...(growSize ? { rootfs: { size: growSize } } : {}),
    ...(spec.resources?.memory ? { memory: spec.resources.memory } : {}),
    ...(spec.resources?.cpus ? { cpus: spec.resources.cpus } : {}),
    ...(hasEnv ? { env: mergedEnv } : {}),
    ...(hasVfsMounts ? { vfs: { mounts: vfsMounts } } : {}),
    ...(hasSandbox ? { sandbox } : {}),
  });

  if (spec.bootCommands && spec.bootCommands.length > 0) {
    await runBootCommands(vm, spec.bootCommands, spec.workdir);
  }

  if (command) {
    console.log("Executing user command…");
  } else {
    console.log("Spawning shell…");
  }
  // Run directly as root — Gondolin's default exec user — with the guest init
  // environment (HOME=/root, PATH, …). Only root is supported for now, so
  // there's no user to `su` into; $USER/$LOGNAME are left unset (`id`/`whoami`
  // still report root). cwd is set explicitly below. We use bash, matching
  // Gondolin's own default command (["/bin/bash", "-i"]).
  const shellCommand = command
    ? ["/bin/bash", "-c", command.join(" ")]
    : ["/bin/bash", "-i"];
  await vm.shell({
    attach: true,
    command: shellCommand,
    cwd: spec.workdir,
  });
  await vm.close();
}

// --- Internals ---

/**
 * Run each configured boot command in order, as root (the VM's default exec
 * user). Each command's output is captured (buffered) and echoed under an
 * explicit header so it's clearly attributable to the command that produced it.
 * Fails fast: the first non-zero exit aborts by throwing, so the caller shuts
 * the VM down before the workload runs in a half-provisioned guest.
 */
async function runBootCommands(
  vm: VM,
  bootCommands: string[],
  cwd: string,
): Promise<void> {
  for (const bootCommand of bootCommands) {
    console.log(`Running boot command: ${bootCommand}`);
    const result = await vm.exec(["/bin/sh", "-c", bootCommand], {
      cwd,
      stdout: "buffer",
      stderr: "buffer",
    });
    // Echo stdout & stderr unconditionally for now. In the future we might add
    // verbosity levels (-v/-vv) and gate output behind them.
    const output = _formatCommandOutput(result.stdout, result.stderr);
    if (output) {
      console.log(output);
    }
    if (result.exitCode !== 0) {
      await vm.close();
      throw new Error(
        `Boot command failed (exit ${result.exitCode}): ${bootCommand}`,
      );
    }
  }
}

/**
 * Merge a boot command's captured stdout and stderr into a single block for
 * logging, prefixing each line with a gutter so command output is visually
 * distinct from Tuor's own log lines. Returns "" when there is nothing to show.
 *
 * stdout and stderr are concatenated (stdout first). Buffer mode keeps them in
 * separate buffers, so their original interleaving is not preserved — for now
 * we accept this trade-off.
 */
export function _formatCommandOutput(stdout: string, stderr: string): string {
  const combined = [stdout, stderr]
    .map((stream) => stream.trimEnd())
    .filter((stream) => stream.length > 0)
    .join("\n");
  if (combined.length === 0) {
    return "";
  }
  return combined
    .split("\n")
    .map((line) => `  │ ${line}`)
    .join("\n");
}

function buildNetworkOptions(
  network: NetworkSpec,
  secrets?: Record<string, SecretSpec>,
) {
  switch (network.mode) {
    case "open": {
      if (!secrets) {
        return { dns: { mode: "open" as const }, env: {} };
      }
      const result = createHttpHooks({ secrets });
      return {
        dns: { mode: "open" as const },
        httpHooks: result.httpHooks,
        env: result.env,
      };
    }
    case "restricted": {
      const result = createHttpHooks({
        allowedHosts: network.allowedHosts,
        allowedInternalHosts: network.allowedInternalHosts,
        ...(secrets ? { secrets } : {}),
      });
      return {
        dns: { mode: "synthetic" as const },
        httpHooks: result.httpHooks,
        env: result.env,
      };
    }
  }
}
