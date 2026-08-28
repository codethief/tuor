# Tuor – strong sandboxing for AI agents
Tuor is a convenience wrapper around
[Gondolin](https://github.com/earendil-works/gondolin) to spawn microVM-based
sandboxes that you can run your coding agent or other workloads in. It exposes
many of Gondolin's features through a JSON-based config schema and makes them
configurable on a global, project-by-project, or even folder-by-folder basis.

I am primarily building Tuor for myself – I wanted a VM-based solution and
Gondolin looked the most promising (and also the most
[secure](https://earendil-works.github.io/gondolin/security/)) to me but since
it's mostly an SDK, it lacked the convenience I desired.


## Features at a glance
Most of the features below are provided verbatim by Gondolin. For users familiar
with Gondolin, please see [Differences to bare Gondolin](./docs/Differences.md).

- **Isolation**: [Strong](./docs/FAQ.md), virtualization-based isolation between
  workload and host system using QEMU as hypervisor with heavily restricted
  guest ↔ host communication.

- **Ephemeral**: VM disk images are copy-on-write and treated as disposable
  (will be deleted upon VM shutdown).

- **Full control over the guest file system & environment**: Customize the
  rootfs by providing an OCI container image (WIP) and/or by mounting host
  directories (read-only or read/write) and volumes while hiding select files
  from the guest. Choose which environment variables should be available inside
  the guest.

- **Network control & secret injection**: Restrict network egress to HTTP and
  specific hosts, and prevent the guest from seeing your auth tokens & secrets
  by injecting them into HTTP requests when the latter leave the sandbox.

- **File-based configuration**: Configure your VM on a global,
  project-by-project, or even folder-by-folder basis. (Configs are merged, so
  you can define global defaults and fine-tune your config for each project.)

- **Convenience mode for NixOS users** (experimental): Have Tuor mount Nix store
  & related dirs into the VM, set up PATH & other env vars, etc.

- **Platforms**: Linux (since I daily-drive it), MacOS should™ mostly work but I
  am unable to test it (feedback is welcome!)


## Quick start
Using [Mise](https://mise.jdx.dev/):

```shell
mise use github:codethief/tuor
tuor run  # Spawns VM and starts interactive shell
tuor --help  # Explore the CLI
```

Using NPM's npx:

```shell
npx tuor-sandbox run  # Spawns VM and starts interactive shell
npx tuor-sandbox --help  # Explore the CLI
```


## Further reading & documentation
- [Installation](./docs/Installation.md)
- [CLI](./docs/CLI.md)
- [Configuration](./docs/Configuration.md)
- [Differences to bare Gondolin](./docs/Differences.md)
- [Limitations & known issues](./docs/Limitations%20&%20known%20issues.md)
- [FAQ](./docs/FAQ.md)
- [Development](./docs/Development.md)


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
Other sandboxes I am aware of that provide comparable features *and* security
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
