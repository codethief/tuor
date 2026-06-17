# Tuor – strong sandboxing for AI agents
Tuor is a command line tool to spawn microVM-based sandboxes that you can run
your coding agent or other workloads in. Under the hood, Tuor uses the excellent
[Gondolin](https://github.com/earendil-works/gondolin) for the actual sandbox
and largely provides a convenience wrapper (config schema & lookup) and a few
other niceties (overlayfs, hide specific files within mounts, Nix mode, etc.).


## Features
- **Isolation**: Strong[^1], microVM-based isolation between workload and host
  system using QEMU as hypervisor.
- **Persistence**: VM disk images are treated as disposable and will be deleted
  upon VM shutdown. To persist data, create a volume or mount host directories
  into the guest – either as read-only, read/write, or using an overlay file system
  (guest may write but host files stay unchanged).
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
  in `~/.config/tuor/config.json`.
- **Rootfs**: (Soon) Configure the VM's rootfs by providing an OCI container
  image. Currently, the VM's base image & kernel are based on
  `alpine-base:latest`.
- **Convenience mode for NixOS users**: Have Tuor mount Nix store & related
  dirs into the VM, set up PATH & other env vars, etc.
- **Platform support**: Should run on both Linux and MacOS. ("should" because I
  can only test on Linux. Feel free to report bugs!)
- **VM nesting**: Run inside existing VMs, even when KVM is not available.
  (Thanks, QEMU!)

Again, most of these features are already provided by
[Gondolin](https://github.com/earendil-works/gondolin) – I am merely listing
them here for completeness.


## Getting started & usage
### Requirements:
- QEMU (`qemu-system-arm` on Debian/Ubuntu, `qemu` on MacOS (Brew))
- Node.js (as this is what Gondolin provides the API in)


### Installation:
```shell
npm install -g tuor-sandbox
```

### Commands:
```shell
tuor init  # Create default config in ./.tuor/, which is also where VM state (overlays, volumes) will be stored
tuor run  # Spawn VM with interactive shell, based on config in nearest .tuor directory
tuor run -- echo "hi"  # Spawn VM and run custom command
```


## Documentation
- [Configuration](./docs/Configuration.md)


## Security & threat model
- [How to report vulnerabilities](./SECURITY.md).
- Since Tuor is a relatively thin wrapper around Gondolin, it follows the same
  [architecture](https://earendil-works.github.io/gondolin/architecture/) and
  [threat model](https://github.com/earendil-works/gondolin/security).


## Development
We use [mise](https://mise.jdx.dev) for the bootstrap. Once mise is installed, do:

```
mise install
npm install
```

Available commands (compare `package.json`):

```shell
npm run start  # Fire up Tuor right from the source code (without building)
npm run build  # Build for release
npm run lint
npm run test
npm run typecheck
```


## Project status
Tuor is **experimental** and config schema and feature set might change at any
time, while I'm still trying to figure out what works best for my own workflow.


## Yet another sandbox?
There are relatively few agent sandboxing solutions out there that provide
strong[^1] virtualization-based isolation (see "similar projects" below). Among
those, I have really liked Gondolin but since it's mostly just an SDK, to me the
final step – a good UI – was still missing. Tuor is trying to fill this gap.

None of the features Tuor provides on top of Gondolin are particularly difficult
to build. But they're still cumbersome if you (or everyone in your organization)
need to build them every single time.


## Similar projects
Other sandboxes I am aware of that provide comparable features & security
guarantees[^1]:
- [Alibaba OpenSandbox](https://github.com/alibaba/OpenSandbox/)
- [Docker Sandbox](https://docs.docker.com/ai/sandboxes/)
- [Matchlock](https://github.com/jingkaihe/matchlock)

[^1]: Host kernel-based mechanisms for workload isolation such as landlock and
    Linux namespaces (e.g. Docker containers) are just not enough. Agents are
    getting too good at writing kernel exploits.


## Acknowledgements
Tuor wouldn't be possible without
[Gondolin](https://github.com/earendil-works/gondolin) and
[QEMU](https://www.qemu.org/), which do all the heavy lifting. Huge thanks to
their maintainers!
