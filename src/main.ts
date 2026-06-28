#!/usr/bin/env -S node --disable-warning=ExperimentalWarning
import { buildApplication, buildRouteMap, run } from "@stricli/core";
import packagejson from "../package.json" with { type: "json" };
import { command as init } from "./cli/init.ts";
import { command as run_ } from "./cli/run.ts";

const root = buildRouteMap({
  routes: { init, run: run_ },
  docs: { brief: "CLI for sandboxing coding agents and other dev tools" },
});

const app = buildApplication(root, {
  name: "tuor",
  versionInfo: { currentVersion: packagejson.version },
  scanner: {
    caseStyle: "allow-kebab-for-camel",
    allowArgumentEscapeSequence: true,
  },
  documentation: {
    caseStyle: "convert-camel-to-kebab",
  },
});

await run(app, process.argv.slice(2), { process });
