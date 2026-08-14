# Differences to bare Gondolin (Why Tuor?)

## File-based configuration
This is arguably the most notable difference between Tuor and Gondolin. Gondolin
is mostly an SDK (with a limited CLI) and requires you to write JavaScript code
for doing anything really. In contrast, Tuor provides a config file-based
interface. Config files can be defined on a global (homedir), project-by-project
and/or folder-by-folder basis – settings get merged, so you can set global
defaults and fine-tune your config for each project. See
[Configuration](./Configuration.md) for details.


## Other features
- **Volumes**: Instead of mounting an existing host directory like your
  workspace, mount a "volume" – similarly to a Docker volume, this is a
  host-backed guest directory managed by Tuor. Useful for persisting guest
  directories across VM restarts. (E.g. persist the home dir and thereby shell
  history, agent conversations, …)

- **Overlay mounts (experimental)**: Define overlay mounts, whose (read-only)
  lower layer is a host directory and whose (writable) upper layer is persisted
  across VM restarts. In other words: The guest may write to the mount but host
  files stay unchanged.

- **Hide host files**: Within a mounted directory, hide select files (e.g.
  `.envrc` files with credentials) from the VM guest. You can hard-code the
  filenames in your Tuor config or use a `.tuorignore` file on a
  folder-by-folder basis, similarly to a `.gitignore` file. (The latter part is
  still experimental. Also, no glob support yet.)

- **Convenience mode for NixOS users (experimental)**: Have Tuor mount Nix store
  & related dirs into the VM, set up PATH & other env vars, etc.


## Fixes for paper cuts in Gondolin
- **Customize file ownership**: Gondolin's `RealFSProvider` passes file
  ownership data (UID/GID) verbatim from the host to the guest. Tuor allows
  controlling the UID/GID of a mount or volume that the guest sees, independent
  of the files' real on-host ownership.
