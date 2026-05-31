import { VM } from "@earendil-works/gondolin";
import { buildVfsMounts, type MountSpec } from "./mounts.ts";

// --- Types ---

/** Core's top-level input contract — everything the session needs to run. */
export type SessionSpec = {
  user: string;
  workdir: string;
  mounts: MountSpec[];
  rootfsSize?: string;
  env?: Record<string, string>;
  bootCommands?: string[];
};

// --- Public API ---

export async function runSession(spec: SessionSpec): Promise<void> {
  const vfsMounts =
    spec.mounts.length > 0 ? buildVfsMounts(spec.mounts) : undefined;

  const vm = await VM.create({
    dns: { mode: "open" },
    ...(spec.rootfsSize ? { rootfs: { size: spec.rootfsSize } } : {}),
    ...(spec.env ? { env: spec.env } : {}),
    ...(vfsMounts ? { vfs: { mounts: vfsMounts } } : {}),
  });

  for (const cmd of spec.bootCommands ?? []) {
    await vm.exec(cmd);
  }

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


