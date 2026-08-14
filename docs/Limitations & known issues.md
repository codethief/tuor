# Limitations & known issues

## Guest workloads must currently run as `root` in many cases
Gondolin currently mounts host directories with root-only permissions. For this
reason, the user (and his home dir) are currently hard-coded at the Tuor config
level, though you could of course `su` to a non-root user inside the VM.


## Running out of disk space; `rootfs.size` currently does not work on the default image
This is due to an [upstream
bug](https://github.com/earendil-works/gondolin/issues/132) in Gondolin.

Unfortunately, this means that writing significant data to the rootfs is not
possible for now (outside directories like `/tmp` that are mounted as tmpfs).

As a workaround you could assign more RAM (`resources.memory`) and increase the
available space in `/tmp` (add `mount -o remount,size=2G /tmp` to your config's
`bootCommands`).

This affects only the *runtime-grow* path, i.e. `rootfs.size` **without** a
`rootfs.image`. When you do configure a `rootfs.image`, the size is baked into the
image at build time instead and works today.


## Custom rootfs images (`rootfs.image`) are effectively Linux-only
Gondolin always builds OCI-based rootfs images *natively* on the host — there is
no containerized-build escape hatch for them (Gondolin's `container.force` is
rejected in combination with an OCI source). Using custom OCI-based rootfs
images therefore requires a container engine plus `cpio`, `lz4` and `e2fsprogs`
natively on the host, which in practice restricts `rootfs.image` to Linux hosts.

Booting Gondolin's default image (i.e. any config without `rootfs.image`) is
unaffected and should not require any of the above dependencies.


## Mounts & volumes don't support creating Unix file sockets
This is a limitation in Gondolin's `sandboxfs` FUSE, which does not support the
`MKNOD` syscall. 

This can, e.g., cause issues when mounting a directory as guest home dir and
using GPG in the sandbox since GPG uses Unix sockets for IPC and, when using
Gondolin's default image, will attempt to create them in `~/.gpg`. As a
workaround, add

```
mkdir -p /run/user/0 && chmod 700 /run/user/0
```

to your Tuor config's `bootCommands`. (GPG prefers `/run/user/$UID` over
`~/.gnupg` as storage location for Unix sockets if it exists). Alternatively,
use

```
mkdir -p /tmp/gnupg && chmod 700 /tmp/gnupg
```

as `bootCommand` and set `GNUPGHOME=/tmp/gnupg` as env var to store the entire
`.gnupg` directory outside the mounted home dir.
