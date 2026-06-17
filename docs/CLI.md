# CLI
Available commands:

```shell
# Create default config in ./.tuor/, which is also where VM state (overlays, volumes) will be stored
tuor init

# Spawn VM with interactive shell, based on config in nearest .tuor directory
tuor run

# Spawn VM and run custom command
tuor run -- echo "hi"

# Print the effective config (after inheritance & resolution) that `run` would
# use, as JSON. Secret values are redacted unless --show-secrets is given.
tuor show-config
tuor show-config --show-secrets  # Include real secret values
tuor show-config | jq .          # Diagnostics go to stderr, so stdout is clean
```

See [Configuration](./Configuration.md) for how to configure Tuor.
