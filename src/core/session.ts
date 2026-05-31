import { VM, createHttpHooks } from "@earendil-works/gondolin";
import { buildVfsMounts, type MountSpec } from "./mounts.ts";

// --- Types ---

export type NetworkSpec =
  | { mode: "open" }
  | { mode: "restricted"; allowedHosts: string[]; allowedInternalHosts: string[] };

/** Core's top-level input contract — everything the session needs to run. */
export type SessionSpec = {
  user: string;
  workdir: string;
  network: NetworkSpec;
  mounts: MountSpec[];
  rootfsSize?: string;
  env?: Record<string, string>;
};

// --- Public API ---

export async function runSession(spec: SessionSpec): Promise<void> {
  const vfsMounts =
    spec.mounts.length > 0 ? buildVfsMounts(spec.mounts) : undefined;

  const networkOptions = buildNetworkOptions(spec.network);

  const vm = await VM.create({
    ...networkOptions,
    ...(spec.rootfsSize ? { rootfs: { size: spec.rootfsSize } } : {}),
    ...(spec.env ? { env: spec.env } : {}),
    ...(vfsMounts ? { vfs: { mounts: vfsMounts } } : {}),
  });

  // `su myuser` gives us an interactive non-login shell (`su - myuser` would
  // give us a login shell but would also cd into the user's home dir, messing
  // with the cwd we configure below.)
  await vm.shell({
    attach: true,
    command: ["su", spec.user],
    cwd: spec.workdir,
  });
  await vm.close();
}

// --- Internals ---

function buildNetworkOptions(network: NetworkSpec) {
  switch (network.mode) {
    case "open":
      return { dns: { mode: "open" as const } };
    case "restricted": {
      const { httpHooks } = createHttpHooks({
        allowedHosts: network.allowedHosts,
        allowedInternalHosts: network.allowedInternalHosts,
      });
      return {
        dns: { mode: "synthetic" as const },
        httpHooks,
      };
    }
  }
}


