# Tuor – strong sandboxing for AI agents
Tuor is a convenience wrapper around
[Gondolin](https://github.com/earendil-works/gondolin) to spawn microVM-based
sandboxes that you can run your coding agent or other workloads in. It exposes
most of Gondolin's features through a JSON config schema and makes them
configurable on a folder-by-folder, project-by-project basis.


## Features
Tuor exposes a wide number of Gondolin's features:

- **Isolation**: [Strong](./docs/FAQ.md), virtualization-based isolation between
  workload and host system using QEMU as hypervisor with heavily constrained
  guest ↔ host communication.
- **Ephemeral**: VM disk images are copy-on-write and treated as disposable
  (will be deleted upon VM shutdown).
- **Virtual file system mounts**: To persist data, mount host directories into
  the guest (read-only or read/write).
- **Hide host files**: Within a mounted directory, hide select files (e.g.
  `.envrc` files with credentials) from the VM guest.
- **Custom file ownership**: Control the uid/gid a mount or volume is presented
  as owned by in the guest (defaults to the guest user), independent of the
  files' real on-host ownership.
- **Network control**: Restrict network egress to HTTP and specific hosts. DNS
  is provided by the sandbox, so as to prevent data exfiltration through UDP 53.
- **Secret injection**: Prevent the guest from seeing your auth tokens &
  secrets, by injecting them into HTTP requests as the latter leave the sandbox.
- **Env vars**: Control which environment variables get passed through to the
  VM.
- **Rootfs**: (Soon) Configure the VM's rootfs by providing an OCI container
  image. Currently, the VM's base image & kernel are based on
  `alpine-base:latest` (Gondolin's default).
- **Platform independent**: Runs on Linux/MacOS/WSL.

…and adds the following convenience features:

- **File-based configuration**: Easily fine-tune your VM configuration on a
  project-by-project or folder-by-folder basis, while defining local defaults
  further up the directory tree and/or defining global defaults in
  `~/.config/tuor/config.json`.
- **Volumes**: Instead of mounting an existing host directory like your
  workspace, mount a "volume" – similarly to a Docker volume. Useful for
  persisting guest directories across VM restarts. (E.g. persist the home dir
  and thereby shell history, agent conversations, …)
- **Overlay mounts (experimental)**: Define overlay mounts, whose (read-only)
  lower layer is a host directory and whose (writable) upper layer is persisted
  across VM restarts. In other words: The guest may write to the mount but host
  files stay unchanged.
- **Ignore files (experimental)**: Similarly to a `.gitignore` file, use a
  `.tuorignore` file to hide files within a mount from the guest. (No glob
  support yet, though.)
- **Convenience mode for NixOS users**: Have Tuor mount Nix store & related
  dirs into the VM, set up PATH & other env vars, etc.


## Quick start
Using NPM's `npx`:

```shell
npx tuor-sandbox run  # Spawns VM and starts interactive shell
```

Run `npx tuor-sandbox --help` to explore the CLI.


## Further reading & documentation
- [Installation](./docs/Installation.md)
- [CLI](./docs/CLI.md)
- [Configuration](./docs/Configuration.md)
- [Development](./docs/Development.md)
- [FAQ](./docs/FAQ.md)


## Security & threat model
- [How to report vulnerabilities](./SECURITY.md).
- Since Tuor is a relatively thin wrapper around Gondolin, it follows the same
  [architecture](https://earendil-works.github.io/gondolin/architecture/) and
  [threat model](https://github.com/earendil-works/gondolin/security).


## Project status
Tuor is in its **early alpha** stages and should be considered (very)
experimental. Config schema and feature set might change at any time while I'm
still trying to figure out what works best for my own workflow.


## Similar projects
Other sandboxes I am aware of that provide comparable features & security
guarantees:
- [Alibaba OpenSandbox](https://github.com/alibaba/OpenSandbox/)
- [Docker Sandbox](https://docs.docker.com/ai/sandboxes/)
- [Matchlock](https://github.com/jingkaihe/matchlock)
- [SlicerVM](https://slicervm.com)


## Acknowledgements
Tuor wouldn't be possible without
[Gondolin](https://github.com/earendil-works/gondolin) and
[QEMU](https://www.qemu.org/), which do all the heavy lifting. Huge thanks to
their maintainers!
