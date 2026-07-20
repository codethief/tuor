# Unreleased

## Breaking changes
- Config: the guest user is now configured as `guestUser: { uid, gid }` (numeric)
  instead of the `user: "<name>"` string. It must currently be
  `{ uid: 0, gid: 0 }` (root). Update configs that set `user`.


# 0.4.0 (2026-07-19)

## Breaking changes
- Config: `rootfsSize` moved from the config top level into the new `resources`
  block (i.e. `{ "resources": { "rootfsSize": "2G" } }`). Update configs that
  set it at the top level.

## Features
- Config: Add `resources`, a block to size the VM's RAM (`memory`, QEMU syntax
  e.g. "2G"), vCPU count (`cpus`), and rootfs disk size (`rootfsSize`, moved
  here from the top level).
- Config: Add `bootCommands`, a list of shell commands run once (as root, in the
  configured `workdir`) right after the VM boots and before the interactive
  shell / user command. Commands run in order and boot aborts on the first
  non-zero exit. Across config layers the lists are concatenated (parent first).


# 0.3.1 (2026-07-08)

## Bug fixes
- Config: a child config layer (e.g. a project `.tuor/config.json`) that didn't
  set `workdir` or `user` silently reset the value inherited from an upper layer
  (e.g. `~/.config/tuor/config.json`) to the built-in default values (workdir:
  `/`, user: `root`). These fields now fall through to the parent layer when
  omitted; their defaults are applied only after all layers are merged.


# 0.3.0 (2026-07-08)

## Features
- Add new `--version` CLI flag
- Add new `show-config` CLI command


# 0.2.1 (2026-06-23)

## Bug fixes
- `package.json`: Add missing `repository.url` to meet NPM's provenance
  requirements.


# 0.2.0 (2026-06-22)

## Features
- Config: Interpolate host environment variables (`$VAR` / `${VAR}`, `$$` for a
  literal `$`) into any config string value. Enables e.g. mounting `$PWD`.
- Config: Simplified the `env` schema. Removed `fromHost`; an env var is now a
  literal string (`$VAR`-interpolated) or an object
  `{ value?, secret?, injectForHosts? }`, where an omitted `value` reads the
  host var named like the key. Secrets use `injectForHosts` (was `hosts`).
- Config: Expose QEMU settings as config options.
- Add `/docs` folder with preliminary documentation.


## Bug fixes
- Ignore files: a dangling symlink anywhere under a mounted directory caused
  the recursive scan for ignore files to throw `ENOENT` and abort config
  loading, so Tuor would fail to start. Such symlinks are now skipped.
- Ignore files: the recursive scan descended into Tuor's own state directory
  (`.tuor/.state`), which holds internal overlay data rather than user content.
  Persisted overlays can contain dangling symlinks there, so this is also what
  triggered the crash above on subsequent starts. The state dir is now skipped.
- Bump undici version to fix upstream CVE.


## Internal
- Release automation: Add `prepare-release.ts` and set up GitHub Actions
  workflow to release & publish.


# 0.1.0 (2026-06-15)
Initial release.

- Config discovery & merging
- Volumes & mounts, including support for overlays & hiding files
- Network configuration
- Env var & secret injection
- Nix convenience features
