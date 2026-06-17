import type { NetworkSpec } from "../core/session.ts";
import { inferGuestHomeDir } from "./homedir.ts";
import type { TuorConfig } from "./schema.ts";

// --- Types ---

/**
 * A {@link TuorConfig} with all *config-level* defaults materialized. This is
 * the "effective config" a user reasons about: same shape as `config.json`
 * (after inheritance/merge), with the defaults that would otherwise be filled in
 * silently made explicit — but *before* the structural conversion into a
 * `SessionSpec` (see {@link createSessionSpecFromConfig}).
 *
 * `network` uses `NetworkSpec` (allow-lists always present) so the type itself
 * guarantees the default was applied; its JSON shape is identical to a
 * fully-populated `NetworkConfig`.
 */
export type DefaultedConfig = Omit<TuorConfig, "network" | "guestHomeDir"> & {
  network: NetworkSpec;
  guestHomeDir: string;
};

// --- Public API ---

/**
 * Fill the config-level defaults that don't come from the arktype schema:
 * `network` (block-all when omitted) and `guestHomeDir` (inferred from `user`).
 *
 * Pure and dependency-free. Schema defaults (`user`, `workdir`, mount `mode`,
 * `nixLd`) are already applied by `parseConfig`; computed conversions (path
 * expansion, env/secret split, nix→mounts, overlay state dirs, …) are *not*
 * defaults and stay in {@link createSessionSpecFromConfig}.
 */
export function applyConfigDefaults(config: TuorConfig): DefaultedConfig {
  return {
    ...config,
    network: defaultNetwork(config.network),
    guestHomeDir: config.guestHomeDir ?? inferGuestHomeDir(config.user),
  };
}

// --- Internals ---

function defaultNetwork(network: TuorConfig["network"]): NetworkSpec {
  if (!network) {
    return { mode: "restricted", allowedHosts: [], allowedInternalHosts: [] };
  }
  if (network.mode === "open") {
    return network;
  }
  return {
    mode: "restricted",
    allowedHosts: network.allowedHosts ?? [],
    allowedInternalHosts: network.allowedInternalHosts ?? [],
  };
}
