# CLI
Available commands:

```shell
# Create default config in ./.tuor/, which is also where VM state (overlays, volumes) will be stored
tuor init

# Spawn VM with interactive shell, based on config in nearest .tuor directory
tuor run

# Spawn VM and run custom command
tuor run -- echo "hi"
```

See [Configuration](./Configuration.md) for how to configure Tuor.
