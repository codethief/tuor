# Unreleased
- Config: interpolate host environment variables (`$VAR` / `${VAR}`, `$$` for a
  literal `$`) into any config string value. Enables e.g. mounting `$PWD`.

# 0.1.0 (2026-06-15)
Initial release.

- Config discovery & merging
- Volumes & mounts, including support for overlays & hiding files
- Network configuration
- Env var & secret injection
- Nix convenience features
