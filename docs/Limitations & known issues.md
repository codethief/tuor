# Limitations & known issues

## Guest workloads must currently run as `root` in many cases
Gondolin currently mounts host directories with root-only permissions. For this
reason, the user (and his home dir) are currently hard-coded at the Tuor config
level, though you could of course `su` to a non-root user inside the VM.


## VM might hang during boot when using custom images and memory is set to exactly 2 GiB
This is an [upstream issue in
QEMU](https://gitlab.com/qemu-project/qemu/-/work_items/3454). Whether or not
you will actually run into this bug depends on the size of the VM's initramfs
(mod 4096) that Gondolin produces, which [is a bit of a
gamble](https://github.com/earendil-works/gondolin/issues/166). If you do, as a
workaround set your VM's memory to a value slightly different from 2 GiB.


## The initramfs of custom images is unusually big (~ 50 MiB) and much bigger than the default image's one
See the note at the end of the aforementioned
https://github.com/earendil-works/gondolin/issues/166 .


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


## VM hangs during bootup on arm64 Linux hosts that are themselves VMs under Apple Virtualization on Apple Silicon
This occurs, e.g., when running Tuor in a Linux VM inside UTM on an Apple
Silicon Mac, using UTM's Apple Virtualization option (instead of QEMU).

Add this to your config to work around the issue:

```jsonc
{
  "qemu": { "machineType": "virt,its=off" }
}
```

Why: QEMU's `virt` machine enables the GICv3 ITS by default but ITS is not
available under the Apple Virtualization framework (neither in the nested
Tuor/Gondolin/QEMU VM nor in the parent Linux VM).
