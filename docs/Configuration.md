# Configuration
Tuor can be configured by placing an appropriate `config.json` either in
`~/.config/tuor` or in a `.tuor` directory in the current working directory or
any of its parents.


## Config inheritance
Configs in child directories inherit from configs in parent directories (and so
on), which in turn inherit from the global `~/.config/tuor/config.json`. In
general, child settings override parent settings, except in the following cases:

- Env vars, mounts, volumes get merged (shallow merge).
- Boot commands are concatenated (parent commands run first).
- Network: Child network mode overrides parent mode; allowed hosts are merged.


## Config options
A detailed documentation of all config options is still work in progress. In the
meantime, please refer to [`/src/config/schema.ts`](../src/config/schema.ts).


## Variables
Any string value in the config (but not keys) may reference host environment
variables, resolved on the host right after the config is loaded (and before it
is validated):

```javascript
{
  "mounts": [
    // $PWD lets you mount wherever you launched Tuor from:
    { "hostPath": "$PWD", "guestPath": "/workspace", "mode": "readwrite" }
  ],
  "resources": { "rootfsSize": "${ROOTFS_SIZE}" },
  // Use $$ for a literal dollar sign:
  "env": { "PROMPT": "$$ " }
}
```

Both `$VAR` and `${VAR}` are supported (use the braced form when the variable is
followed by other word characters, e.g. `${VAR}_suffix`). Referencing a variable
that is not set on the host is an error.


## Example `config.json`
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
      "ignoreFileRefs": ["host:./tuorignore", "mount:.tuorignore"]
    }
  ],
  // VM resource sizing. Any field left unset falls back to Gondolin's default
  // (1G memory, 2 cpus). Note that `cpus` (the vCPU count) is distinct from
  // `qemu.cpu` (the emulated CPU model).
  "resources": {
    "cpus": 4,          // vCPU count (positive integer)
    "memory": "2G",     // RAM, QEMU syntax (e.g. "512M", "2G")
    // Minimum virtual disk size (COW overlay, so actual host usage stays
    // sparse). Note that the virtual disk will be discarded on VM shutdown,
    // so it is not meant for persisting data across VM boots. (Use mounts &
    // volumes, instead!)
    "rootfsSize": "2G"
  },
  // Guest user (numeric uid/gid) the shell runs under and that mounted
  // directories are presented as owned by. `homedir` (optional, default /root)
  // is the guest home directory used for `~` expansion in guest paths.
  // Constraint: uid/gid must currently be root ({ uid: 0, gid: 0 }).
  "guestUser": { "uid": 0, "gid": 0, "homedir": "/root" },
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
