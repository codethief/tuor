# Add `tuor show-config` command

## Context
Tuor builds the spec it spawns a VM with by discovering `.tuor/config.json` files
(home + ancestors), interpolating env vars, validating, **merging** layers
(child overrides parent), and **resolving** the merged config into a concrete
`SessionSpec` (absolute paths, expanded `~`, computed overlay state dirs, network
defaults, env/secret split). All of this happens inside `loadConfig()`
(`src/config/load.ts`), and the result is only ever consumed by `tuor run`.

There's currently no way to inspect the *effective* config without actually
booting a VM. This makes it hard to debug inheritance/merge behavior or verify
what will be mounted, which env vars/secrets pass through, and what network
policy applies. `show-config` exposes the fully-resolved `SessionSpec` that `run`
would use.

## Approach
Add a `show-config` CLI command that calls the existing `loadConfig()` and prints
the resolved `SessionSpec` as pretty JSON to stdout. Reuse the existing pipeline
verbatim — no new resolution logic.

### What the output reflects (by design)
The `SessionSpec` is the *end* of `loadConfig()`'s pipeline, so:
- **`$VAR`/`${VAR}` appear interpolated**, not as literals — `interpolateVars`
  runs per layer before parsing (`load.ts:36-43`). Caveat: a host value
  interpolated into a *non-secret* `env` var shows in cleartext (redaction only
  covers `secret: true` entries, which become `spec.secrets`). This matches `run`.
- **Defaults appear materialized** — both arktype schema defaults (`user='root'`,
  `workdir='/'`, mount `mode='readonly'`, `nixLd=false` in `schema.ts`) and
  `resolveConfig` defaults (network → restricted with empty allowlists, inferred
  `guestHomeDir`, computed overlay state dirs). They show even when omitted from
  `config.json`.

This is intentional: the command answers "what will the VM actually run with",
not "what's in my files".

### 1. Route informational logs to stderr — `src/config/load.ts`
`loadConfig()` prints `Loading config: <path>` via `console.log` (stdout). For
`show-config`, that would corrupt JSON piped to e.g. `jq`. Change those lines
(load.ts:29) to `console.error` so stdout carries only data. This also slightly
improves `run` (diagnostics → stderr). The `No .tuor/config.json found` message
is already on stderr.

### 2. New command — `src/cli/show-config.ts`
Mirror the style of `src/cli/init.ts` (uses `buildCommand` with
`func(this: CommandContext, flags)` and writes via `this.process.stdout`).

- Call `loadConfig()` → `{ spec }` (type `SessionSpec` from `src/core/session.ts`).
- **Redact secrets by default.** `spec.secrets` is `Record<string, SecretSpec>`
  where `SecretSpec = { hosts, value }` and `value` is the real token. A helper
  `redactSecrets(spec)` returns a copy with each secret's `value` replaced by
  `"<redacted>"` (host list preserved). Export the helper so it can be unit-tested.
- Flag `--show-secrets` (boolean, optional): when set, print the spec unredacted.
- Output: `this.process.stdout.write(JSON.stringify(output, null, 2) + "\n")`.
- `docs.brief`: "Print the effective config (after inheritance & resolution) that `run` would use".

Note: env vars passed through `config.env` (non-secret) are shown as-is — only
fields explicitly marked `secret: true` land in `spec.secrets` and get redacted.

### 3. Register the route — `src/main.ts`
Import `command as showConfig` and add `showConfig` to the `routes` map. Verified
in `@stricli/core`: with the app's `allow-kebab-for-camel` scanner, the key
`showConfig` is invoked as `show-config` and rendered kebab-case in help.

### 4. Test — `src/cli/show-config.test.ts`
Vitest (matches existing `*.test.ts` convention). Unit-test `redactSecrets`:
- a spec with secrets → values become `"<redacted>"`, `hosts` preserved, other
  fields (env, mounts, network) untouched, original spec not mutated.
- a spec without `secrets` → returned unchanged.

### 5. Docs — `docs/CLI.md`
Add a `show-config` entry alongside `init`/`run`, noting secrets are redacted
unless `--show-secrets` is passed.

## Verification
From `/workspace/tuor`:
- `npm run typecheck`
- `npm run lint`
- `npm run test` (new redaction test passes)
- Manual: in a dir with `.tuor/config.json`, run
  `npm run start -- show-config` → clean JSON on stdout; `Loading config:` lines
  on stderr. Confirm `npm run start -- show-config | jq .` parses. With a config
  defining a `secret: true` env var, confirm its value shows `<redacted>` and
  that `--show-secrets` reveals it.
