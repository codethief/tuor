# Tuor – strong sandboxing for AI agents
Tuor is a command line tool to spawn microVM-based sandboxes that you can run
your coding agent or other workloads in. Under the hood, Tuor uses the excellent
[Gondolin](https://github.com/earendil-works/gondolin) for the actual sandbox
and largely provides a convenience wrapper (config schema & lookup) and a few
other niceties (overlayfs, hide specific files within mounts, Nix mode, etc.).


## Features
- **Isolation**: [Strong](./docs/FAQ.md), virtualization-based isolation between
  workload and host system using QEMU as hypervisor with heavily constrained
  guest ↔ host communication [thanks to
  Gondolin](https://earendil-works.github.io/gondolin/architecture/).
- **Ephemeral**: VM disk images are copy-on-write and treated as disposable
  (will be deleted upon VM shutdown).
- **Virtual file system mounts**: To persist data, create a volume or mount host
  directories into the guest – either as read-only, read/write, or using an
  (experimental) overlay file system (guest may write but host files stay
  unchanged).
- **Hide host files**: Within a mounted directory, hide select files (e.g.
  `.envrc` files with credentials) from the VM guest.
- **Network control**: Restrict network access to HTTP and specific hosts. DNS
  is provided by the sandbox, so as to prevent data exfiltration through UDP 53.
- **Secret injection**: Prevent the guest from seeing your auth tokens &
  secrets, by having Tuor inject them into HTTP requests as the latter leave the
  sandbox.
- **Env vars**: Control which environment variables get passed through to the
  VM.
- **File-based configuration**: Easily fine-tune your VM configuration on a
  project-by-project or folder-by-folder basis, while defining global defaults
  in `~/.config/tuor/config.json` or local defaults in a parent folder.
- **Rootfs**: (Soon) Configure the VM's rootfs by providing an OCI container
  image. Currently, the VM's base image & kernel are based on
  `alpine-base:latest`.
- **Convenience mode for NixOS users**: Have Tuor mount Nix store & related
  dirs into the VM, set up PATH & other env vars, etc.
- **Platform support**: Should run on Linux/WSL/MacOS. ("should" because I can
  only test on Linux. Feel free to report bugs!)

Again, most of these features are provided by
[Gondolin](https://github.com/earendil-works/gondolin) and I don't want to take
credit for them – just listing them here for completeness.


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
Tuor is **experimental** and config schema and feature set might change at any
time, while I'm still trying to figure out what works best for my own workflow.


## Similar projects
Other sandboxes I am aware of that provide comparable features & security
guarantees:
- [Alibaba OpenSandbox](https://github.com/alibaba/OpenSandbox/)
- [Docker Sandbox](https://docs.docker.com/ai/sandboxes/)
- [Matchlock](https://github.com/jingkaihe/matchlock)


## Acknowledgements
Tuor wouldn't be possible without
[Gondolin](https://github.com/earendil-works/gondolin) and
[QEMU](https://www.qemu.org/), which do all the heavy lifting. Huge thanks to
their maintainers!
