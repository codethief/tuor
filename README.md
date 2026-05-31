# Tuor, a CLI for sandboxing coding agents and other dev tools
Tuor is a convenience wrapper around
[Gondolin](https://github.com/earendil-works/gondolin), a tool for configuring &
spawning Linux micro VMs through a TypeScript API (mainly for the purpose of
sandboxing coding agents).

While Gondolin focuses on the low-level virtualization plumbing and on providing
a great and flexible API, Tuor's goal is to provide an easy-to-use CLI for
common use cases and make using micro VMs for development – whether agentic
coding or otherwise¹ – as convenient as possible. (¹ I have always been
terrified of blindly `npm install`ing hundreds of packages…)

However, I don't know yet what "convenience" will look like – part of
building Tuor is figuring that out. For now I'm just trying to scratch my own
itch and to get something halfway decent working, which integrates nicely with
my personal workflow.


# General dependencies
- Gondolin runtime dependencies (QEMU)


# Usage
I haven't gotten around packaging Tuor yet; please see the development
instructions below for installation instructions.

Tuor looks for a `.tuor/config.json` file in the current working directory to
configure the VM. It uses Gondolin's default Alpine-based image and layers
host-side mounts on top. Example config:

```javascript
{
  "user": "root",  // User must currently be root or the user with UID 1000 (or whatever UID you use on the host), see https://github.com/earendil-works/gondolin/issues/74
  "workdir": {
      "hostPath": "..",  // relative to config.json
      "guestPath": "/workspace"  // Can be omitted, in which case guestPath will be set to the resolved (absolute) hostPath
  },
  "rootfsSize": "2G",  // Optional: minimum virtual disk size (COW overlay, so actual host usage stays sparse). When increased, the VM's file system will be expanded during VM boot-up.
  "env": {  // Optional: environment variables to set in the guest
    "MY_VAR": "fixed_value",  // Literal value
    "EDITOR": { "fromHost": true },  // Read from host env (same var name)
    "DB_URL": { "fromHost": "DATABASE_URL" }  // Read from host env (different var name)
  },
  "mounts": [
    {
      "hostPath": "/path/on/the/host",
      "guestPath": "/path/on/the/guest",
      "readonly": true,
      "ignore": [".env", "secrets"],  // Optional: explicit paths to hide from the guest
      "ignoreFileRefs": ["host:./tuorignore", "mount:.tuorignore"]  // Optional, shown here with default value
    }
  ]
}
```

## Ignore files

Tuor can hide host files from mounted directories using ignore files (one path
per line, `#` for comments). Each mount has an `ignoreFileRefs` list that
defaults to `["host:./tuorignore", "mount:.tuorignore"]`, meaning:

- **`host:./tuorignore`** — a shared ignore file in the `.tuor/` config directory
- **`mount:.tuorignore`** — per-directory `.tuorignore` files inside the mounted
  host directory (recursive lookup, like `.gitignore`)

The `host:` prefix resolves paths relative to the `.tuor/` config dir (or
absolute). The `mount:` prefix resolves within the mounted host directory —
relative paths trigger recursive lookup, absolute paths match a single file.

Patterns from `ignoreFileRefs` are merged with any explicit `ignore` list on the
mount. Missing ignore files are silently skipped.

### Pattern matching rules

- **Bare name** (no `/`): matches at any depth. E.g. `.envrc` hides `/.envrc`,
  `/sub/.envrc`, `/a/b/.envrc`, etc.
- **Path containing `/`**: anchored to the mount root. E.g. `sub/.envrc` only
  hides `/sub/.envrc`.
- A trailing `/` is stripped before matching (it does *not* restrict matching to
  directories only). Exception: a bare `/` is not stripped.
- A match on a path also hides everything below it (e.g. `.git` hides
  `.git/config`).
- Globs (`**/foo/bar*`) are not supported yet.

### Caveats

Ignore files are loaded once at boot. Changes require a VM restart.


# Development
For the bootstrap you need to have [mise](https://mise.jdx.dev) installed. Then
do:

```
mise install
npm install
```

```
npm start  # Fire up Tuor (will look for a .tuor/config.json in the current directory)
npm test
npm run typecheck
```


# Security and threat model
Since Tuor is a wrapper around Gondolin, [Gondolin's security
guarantees](https://earendil-works.github.io/gondolin/security/) apply.


# Acknowledgments
Given that Tuor is mainly a thin wrapper around Gondolin, the actual & difficult
work is done by Gondolin's maintainer @mitsuhiko. Huge thanks to him!
