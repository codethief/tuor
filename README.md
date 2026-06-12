# Tuor – strong sandboxing for AI agents
Tuor is a command line tool to spawn microVM-based sandboxes that you
can run your coding agent or other workloads in. Under the hood, Tuor uses
[Gondolin](https://github.com/earendil-works/gondolin) for the actual sandbox
and largely provides a convenience wrapper.

Tuor is still experimental and what "convenience" looks like exactly is still to
be seen – part of building Tuor is figuring that out. For now I'm just trying to
scratch my own itch and get something halfway decent working that integrates
nicely with my personal workflow.


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
- **Convenience mode for NixOS users**: Mount Nix store & related dirs into the
  VM, set up PATH & other env vars, etc.
- **Platform support**: Should run on both Linux and MacOS. ("should" because I
  can only test on Linux. Feel free to report bugs!)
- **VM nesting**: Run inside existing VMs, even when KVM is not available.
  (Thanks, QEMU!)


## Getting started & usage
### Requirements:
- QEMU (`qemu-system-arm` on Debian/Ubuntu, `qemu` on MacOS (Brew))
- Node.js (as this is what Gondolin provides the API in)


### Installation:
```shell
npm install -g tuor
```

### Commands:
```shell
tuor init  # Create default config in ./.tuor/, which is also where VM state (overlays, volumes) will be stored
tuor run  # Spawn VM with interactive shell, based on config in nearest .tuor directory
tuor run -- echo "hi"  # Spawn VM and run custom command
```


## Example `config.json`
Place this in a `.tuor/` folder in your project directory or in
`~/.config/tuor/`. (The local `config.json` in your project inherits from the
global one in the homedir.) 

```javascript
{
  "network": {
    // "open" for unrestricted access, "restricted" for allowlist
    "mode": "restricted",
    // Allow HTTPS traffic to these hosts
    "allowedHosts": ["*.github.com", "api.anthropic.com"],
    // Like allowedHosts but for hosts pointing at private IPs (which are 
    // otherwise blocked to prevent DNS rebinding attacks)
    "allowedInternalHosts": ["local-llm.my.corp"]
  },
  "env": {
    "SOME_VAR": "fixed_value",  // Literal value
    "MY_VAR": { "fromHost": "MY_VARIABLE" }  // Read from host env (different name)
    "EDITOR": { "fromHost": true },  // Read from host env (same var name)
    "AUTH_TOKEN": { 
      "fromHost": true,
      "hosts": ["my-api.hostname.com"]
    }
  },
  "mounts": [
    {
      // Absolute or relative to config.json
      "hostPath": "/path/on/the/host",
      // Can be omitted, in which case guestPath will be set to the resolved 
      // (absolute) hostPath.
      "guestPath": "/path/on/the/guest",
      // Will do copy-on-write and persist changes to .tuor/.state/overlays/
      "mode": "overlay",
      // Optional: Explicit paths to hide from the guest
      "ignore": [".env", "secret.key", ".tuor"],
      // Files to read list of ignored files from (think .gitignore). Paths are 
      // either host paths or mount-relative paths.
      "ignoreFileRefs": ["host:./tuorignore", "mount:.tuorignore"]
    }
  ],
  // Minimum virtual disk size (COW overlay, so actual host usage stays 
  // sparse). Note that the virtual disk will be discarded on VM shutdown,
  // so it is not meant for persisting data across VM boots. (Use mounts & 
  // volumes, instead!)
  "rootfsSize": "2G",
  // Constraint: Guest user must currently be root
  "user": "root",
  // Persistent guest directories without a host backing directory (
  // similar to Docker volumes)
  "volumes": [
    { "guestPath": "~/.claude" }  // Persist Claude Code state
  ],
  // Instead of a string (guest path) you can also provide a mount config here
  // for convenience, e.g. 
  // { hostPath: "..", guestPath: "/workspace", mode: "readwrite" }
  "workdir": "/workspace"
}
```

For a detailed description of all config options, please see
[`src/config/schema.ts`](./src/config/schema.ts).


## Security & threat model
- [How to report vulnerabilities](./SECURITY.md).
- Since Tuor is a relatively thin wrapper around Gondolin, it follows the same
  [architecture](https://earendil-works.github.io/gondolin/architecture/) and
  [threat model](https://github.com/earendil-works/gondolin/security).


## Development
We use [mise](https://mise.jdx.dev) for the bootstrap. Then do:

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


## Similar projects
Other sandboxes I am aware of that provide comparable features & security
guarantees[^1]:
- [Alibaba OpenSandbox](https://github.com/alibaba/OpenSandbox/)
- [Docker Sandbox](https://docs.docker.com/ai/sandboxes/)
- [Matchlock](https://github.com/jingkaihe/matchlock)

[^1]: Kernel-based mechanisms for workload isolation such as
    user/mount/network/… namespaces (e.g. Docker containers) & landlock are just
    not enough!


## Acknowledgements
Tuor is standing on the shoulders of giants and wouldn't be possible without
[Gondolin](https://github.com/earendil-works/gondolin) and
[QEMU](https://www.qemu.org/), which do all the heavy lifting. Huge thanks to
their maintainers!
