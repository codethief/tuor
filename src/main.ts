import { readFileSync } from "node:fs";
import { join } from "node:path";
import { VM } from "@earendil-works/gondolin";
import { findConfigDir, parseConfig } from "./config.ts";
import { resolveImage } from "./image.ts";

const configDir = findConfigDir(process.cwd());
if (!configDir) {
  console.error(
    "No .tuor/config.json found in current directory or any parent.",
  );
  process.exit(1);
}

const raw = JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8"));
const config = parseConfig(raw);
const imageTag = await resolveImage(config.image, configDir, config);

const vm = await VM.create({
  sandbox: { imagePath: imageTag },
  dns: { mode: "open" },
});
await vm.shell({ attach: true });
await vm.close();
