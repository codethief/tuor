# Limitations & known issues

## Guest workloads must currently run as `root` in many cases
Gondolin currently mounts host directories with root-only permissions. For this
reason, the user (and his home dir) are currently hard-coded at the Tuor config
level, though you could of course `su` to a non-root user inside the VM.


## Running out of disk space; `resources.rootfsSize` currently does not work
This is due to an [upstream
bug](https://github.com/earendil-works/gondolin/issues/132) in Gondolin.

Unfortunately, this means that writing significant data to the rootfs is not
possible for now (outside directories like `/tmp` that are mounted as tmpfs).

As a workaround you could assign more RAM (`resources.memory`) and increase the
available space in `/tmp` (add `mount -o remount,size=2G /tmp` to your config's
`bootCommands`).


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
