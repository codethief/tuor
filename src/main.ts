import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VM } from "@earendil-works/gondolin";
import { findConfigDir, parseConfig } from "./config.ts";
import { resolveImage } from "./image.ts";
import { prepareMounts } from "./mounts.ts";
import { resolveWorkdir } from "./workdir.ts";

const configDir = findConfigDir(process.cwd());
if (!configDir) {
  console.error(
    "No .tuor/config.json found in current directory or any parent.",
  );
  process.exit(1);
}

const raw = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
const config = parseConfig(raw);
const imageTag = await resolveImage(config.rootfs, configDir);

const workdir = resolveWorkdir(config.workdir, configDir);

const allMounts = [
  ...(config.mounts ?? []),
  ...(workdir.mount ? [workdir.mount] : []),
];
const vfsMounts =
  allMounts.length > 0 ? prepareMounts(allMounts, configDir) : undefined;

const vm = await VM.create({
  sandbox: { imagePath: imageTag },
  dns: { mode: "open" },
  ...(vfsMounts ? { vfs: { mounts: vfsMounts } } : {}),
});
await vm.shell({
  attach: true,
  // `su myuser` gives us an interactive non-login shell (`su - myuser` would
  // give us a login shell but would also cd into the user's home dir, messing
  // with the cwd we configure below.)
  command: ["su", config.user],
  cwd: workdir.guestPath,
});
await vm.close();
