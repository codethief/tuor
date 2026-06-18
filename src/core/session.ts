import { createHttpHooks, VM, type VMOptions } from "@earendil-works/gondolin";
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

/** Core's top-level input contract — everything the session needs to run. */
export type SessionSpec = {
  user: string;
  workdir: string;
  network: NetworkSpec;
  mounts: MountSpec[];
  volumes?: VolumeSpec[];
  rootfsSize?: string;
  env?: Record<string, string>;
  secrets?: Record<string, SecretSpec>;
  qemu?: QemuSpec;
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

  console.log("Starting VM…");
  const vm = await VM.create({
    ...networkOptions,
    ...(spec.rootfsSize ? { rootfs: { size: spec.rootfsSize } } : {}),
    ...(hasEnv ? { env: mergedEnv } : {}),
    ...(hasVfsMounts ? { vfs: { mounts: vfsMounts } } : {}),
    sandbox: spec.qemu,
  });

  if (command) {
    console.log("Executing user command…");
  } else {
    console.log("Spawning shell…");
  }
  // `su myuser` gives us an interactive non-login shell (`su - myuser` would
  // give us a login shell but would also cd into the user's home dir, messing
  // with the cwd we configure below.)
  const shellCommand = command
    ? ["su", spec.user, "-c", command.join(" ")]
    : ["su", spec.user];
  await vm.shell({
    attach: true,
    command: shellCommand,
    cwd: spec.workdir,
  });
  await vm.close();
}

// --- Internals ---

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
