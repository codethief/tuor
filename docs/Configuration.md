# Configuration
Tuor can be configured by placing an appropriate `config.json` either in
`~/.config/tuor` or in a `.tuor` directory in the current working directory or
any of its parents.

Config files are read as [JSONC](https://en.wikipedia.org/wiki/JSON#JSONC) (=
regular JSON + `// line` and `/* block */` comments + trailing commas), using
the [same parser](https://github.com/microsoft/node-jsonc-parser) (by Microsoft)
that VSCode uses, too. An informal specification (not by Microsoft) can be found
at https://jsonc.org/.


## Config options
A detailed documentation of all config options is still work in progress. In the
meantime, please refer to [`/src/config/schema.ts`](../src/config/schema.ts).


## Config inheritance & merging
Configs in child directories inherit from configs in parent directories (and so
on), which in turn inherit from the global `~/.config/tuor/config.json`. The
individual config files don't need to provide all settings that are required by
the schema (see above); only the end result after merging them gets validated.

Relative host path references in a given config file (e.g. `workdir: "../foo"`)
are always evaluated relative to *that* config file's location, before it
potentially gets merged with other configs.


**How inheritance works:** In general, top-level settings in the child config
override top-level settings in the parent config. However, in some cases
settings are deep-merged and the config inheritance algorithm descends down the
config schema tree, or values are concatenated with the parent config (e.g. in
case of lists), as indicated below:

```jsonc
{
  "bootCommands": [],  // concatenate with parent list (parent commands run first)
  "env": {},  // concatenate/shallow-merge with parent dictionary
  "guestUser?": {},  // override parent
  "mounts": [],  // concatenate with parent list
  "network": {
    "mode": "",  // override parent
    "allowedHosts": [],  // concatenate with parent list
    "allowedInternalHosts": [], // concatenate with parent list
  },
  "qemu": {
    "accel": "",  // override parent
    "cpu": "",  // override parent
    "machineType": "",  // override parent
  },  // ?
  "resources": {
    "cpus": "",  // override parent
    "memory": "",  // override parent
  },  // ?
  "rootfs": {
    "image": {},  // override parent
    "size": "",  // override parent
  },
  "volumes": [],  // concatenate with parent list
  "workdir": {} /* or string value */,  // override parent
}
```


## Variables
Any string value in the config (but not keys) may reference host environment
variables, resolved on the host right after the config is loaded (and before it
is validated):

```jsonc
{
  "mounts": [
    // $PWD lets you mount wherever you launched Tuor from:
    { "hostPath": "$PWD", "guestPath": "/workspace", "mode": "readwrite" }
  ],
  "rootfs": { "size": "${ROOTFS_SIZE}" },
  // Use $$ for a literal dollar sign:
  "env": { "PROMPT": "$$ " }
}
```

Both `$VAR` and `${VAR}` are supported (use the braced form when the variable is
followed by other word characters, e.g. `${VAR}_suffix`). Referencing a variable
that is not set on the host is an error.


## Example `config.json`
```jsonc
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
    "MY_VAR": "${MY_VARIABLE}_and_a_suffix",  // ${MY_VARIABLE} is interpolated from the host env
    "EDITOR": {},  // Read host var named like the key (i.e. $EDITOR)
    "AUTH_TOKEN": {
      // Injected as a secret: the guest sees a placeholder; the real value
      // (host's $AUTH_TOKEN here, since `value` field is omitted) is substituted only
      // in HTTPS requests to these hosts.
      "secret": true,
      "injectForHosts": ["my-api.hostname.com"]
    },
    "GH_TOKEN": {
      // A secret whose value comes from a differently-named host var:
      "secret": true,
      "value": "$GITHUB_TOKEN",
      "injectForHosts": ["*.github.com"]
    }
  },
  // Shell commands run once, as root, right after boot and before the shell /
  // user command, in the configured workdir. Run in order; a non-zero exit
  // aborts boot (fail fast). Handy for provisioning the guest.
  "bootCommands": [
    "apk add --no-cache ripgrep",
    "mkdir -p /workspace/.cache"
  ],
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
      "ignoreFileRefs": ["host:./tuorignore", "mount:.tuorignore"],
      // Optional: uid/gid presented to the guest for this mount's entries
      // (defaults to guestUser). Display-only: does not change host-side
      // ownership. Either field may be omitted to inherit from guestUser.
      "owner": { "uid": 0, "gid": 0 }
    }
  ],
  // VM resource sizing. Any field left unset falls back to Gondolin's default
  // (1G memory, 2 cpus). Note that `cpus` (the vCPU count) is distinct from
  // `qemu.cpu` (the emulated CPU model).
  "resources": {
    "cpus": 4,          // vCPU count (positive integer)
    "memory": "2G"      // RAM, QEMU syntax (e.g. "512M", "2G")
  },
  "rootfs": {
    "image": {
      // Whole OCI image ref (`:tag` or `@sha256:…`). Omit the whole `image`
      // block to boot Gondolin's default alpine-base image.
      "ref": "docker.io/library/debian:bookworm-slim",
      // Optional: container engine used to pull & export the image. Omit to let
      // Gondolin auto-detect (docker, else podman).
      "engine": "docker",
      // Optional (default "if-not-present"): where the image comes from on the
      // runs that build. "always" to re-pull every time, "never" to use the
      // engine's local image store only (and fail if the image isn't in it).
      "pullPolicy": "if-not-present",
      // Optional (default "if-not-present"): whether to reuse the guest assets
      // Tuor cached for this `ref`. "always" rebuilds them every run. Note that
      // `ref`, not the image contents, is the cache identity, so a moving tag
      // needs *this* set to "always" — `pullPolicy` alone won't refresh
      // anything, because a cache hit skips the build that would pull.
      "buildPolicy": "if-not-present"
    },
    // Optional: total rootfs size — a positive integer plus a *mandatory*
    // K/M/G/T suffix. Grow-only (never shrinks).
    // Note that the virtual disk is discarded on VM shutdown, so it is not
    // meant for persisting data across VM boots. (Use mounts & volumes,
    // instead!)
    "size": "8G"
  },
  // Guest user (numeric uid/gid) the shell runs under and that mounted
  // directories are presented as owned by. `homedir` (optional, default /root)
  // is the guest home directory used for `~` expansion in guest paths.
  // Constraint: uid/gid must currently be root ({ uid: 0, gid: 0 }).
  "guestUser": { "uid": 0, "gid": 0, "homedir": "/root" },
  // Persistent guest directories without a host backing directory (
  // similar to Docker volumes). Like mounts, they accept an optional `owner`, 
  // defaults to guestUser).
  "volumes": [
    { "guestPath": "~/.claude" }  // Persist Claude Code state
  ],
  // Instead of a string (guest path) you can also provide a mount config here
  // for convenience, e.g.
  // { hostPath: "..", guestPath: "/workspace", mode: "readwrite" }
  "workdir": "/workspace"
}
```
