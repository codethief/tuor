import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VM } from "@earendil-works/gondolin";
import { findConfigDir, parseConfig } from "./config.ts";
import { resolveImage } from "./image.ts";
import { prepareMounts } from "./mounts.ts";

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
const vfsMounts = config.mounts
  ? prepareMounts(config.mounts, configDir)
  : undefined;

const vm = await VM.create({
  sandbox: { imagePath: imageTag },
  dns: { mode: "open" },
  ...(vfsMounts ? { vfs: { mounts: vfsMounts } } : {}),
});
await vm.shell({
  attach: true,
  // This will typically fail for users which are not root or UID 1000, see
  // https://github.com/earendil-works/gondolin/issues/74
  ...(config.user ? { command: ["su", "-", config.user] } : {}),
});
await vm.close();
