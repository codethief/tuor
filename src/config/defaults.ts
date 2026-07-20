import type { NetworkSpec } from "../core/session.ts";
import type { GuestUserConfig, TuorConfig, WorkdirConfig } from "./schema.ts";

// --- Types ---

/** Guest user assumed when no config layer sets one (root). */
export const DEFAULT_GUEST_USER: GuestUserConfig = { uid: 0, gid: 0 };
/**
 * Guest home directory assumed when no config layer sets `guestUser.homedir`.
 * Since the guest user is enforced to be root (i.e. root is not just the
 * default), we can hard-code /root here.
 */
export const DEFAULT_GUEST_HOME_DIR = "/root";
/** Guest working directory assumed when no config layer sets one. */
export const DEFAULT_WORKDIR: WorkdirConfig = "/";

/** A {@link GuestUserConfig} with its `homedir` default materialized. */
export type DefaultedGuestUser = GuestUserConfig & { homedir: string };

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
export type DefaultedConfig = Omit<
  TuorConfig,
  "network" | "guestUser" | "workdir"
> & {
  network: NetworkSpec;
  guestUser: DefaultedGuestUser;
  workdir: WorkdirConfig;
};

// --- Public API ---

/**
 * Fill the config-level defaults that don't come from the arktype schema:
 * `guestUser`, `workdir`, and `network` (block-all when omitted).
 *
 * `guestUser`/`workdir` are defaulted *here* rather than in the schema so that a
 * child config layer that omits them doesn't clobber a value inherited from a
 * parent layer during merge (their "omitted" would otherwise be indistinguish-
 * able from an explicit default). This must run after `mergeConfigs`.
 *
 * Pure and dependency-free. The remaining schema defaults (mount `mode`,
 * `nixLd`) are already applied by `parseConfig`; computed conversions (path
 * expansion, env/secret split, nix→mounts, overlay state dirs, …) are *not*
 * defaults and stay in {@link createSessionSpecFromConfig}.
 */
export function applyConfigDefaults(config: TuorConfig): DefaultedConfig {
  const guestUser = config.guestUser ?? DEFAULT_GUEST_USER;
  return {
    ...config,
    guestUser: {
      ...guestUser,
      homedir: guestUser.homedir ?? DEFAULT_GUEST_HOME_DIR,
    },
    workdir: config.workdir ?? DEFAULT_WORKDIR,
    network: defaultNetwork(config.network),
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
