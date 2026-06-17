# FAQ
## Yet another sandbox?
There are relatively few agent sandboxing solutions out there that provide
strong (virtualization-based) isolation – see "Similar projects" in the
[README](../README.md). Among those, I have really liked Gondolin but since it's
mostly just an SDK, to me the final step – a good
[agent-agnostic](https://github.com/earendil-works/gondolin/blob/main/host/examples/pi-gondolin.ts)
UI – was still missing. Tuor is trying to fill this gap.

None of the features Tuor provides on top of Gondolin are particularly difficult
to build. But they're still cumbersome if you (or everyone in your organization)
need to build them every single time.


## You keep mentioning strong isolation. What's so strong about virtualization?
Many sandboxing solutions out there rely on host kernel mechanisms such [Linux
namespaces](https://en.wikipedia.org/wiki/Linux_namespaces),
[Landlock](https://docs.kernel.org/userspace-api/landlock.html),
[AppArmor](https://apparmor.net/), and
[seccomp](https://docs.kernel.org/userspace-api/seccomp_filter.html) for
isolating the process-to-be-sandboxed (e.g. the agent) from the rest of the
system. You might have heard of these under different names: Docker/Podman
containers, Bubblewrap, Firejail, etc. While these represent huge security
improvements over no sandboxing at all, in many cases they still present a
significantly larger attack surface to the process than virtualization-based
solutions: In a virtualization-based sandbox, the process runs inside an
entirely separate operating system (guest OS) and process & guest OS cannot talk
to the host kernel – or at least only indirectly, through some limited, clearly
defined pathways (virtual devices / hypervisor). In contrast, if the process
runs directly on the host, the process still communicates directly with the host
kernel through syscalls: By default, this is a set of hundreds of syscalls.
Host-level isolation techniques mitigate this somewhat, by restricting what
syscalls are allowed or what certain syscalls can do but ultimately, the list of
syscalls is still considerable and a kernel vulnerability in any of them might
expose the entire host system to a malicious process.


## Why is Tuor written in TypeScript?
The host SDK that Gondolin provides is written in TypeScript, so it was not much
of a choice.


## What's performance like? Isn't proxying file system & network I/O through JavaScript/Node.js slow?
The VM itself shouldn't be much slower than your host OS, provided QEMU can use
hardware virtualization (i.e. KVM on Linux). Without hardware virtualization, it
will definitely be noticeably slower, though specifics will depend on your
setup.

As for file system I/O within mounted directories/volumes and network I/O
from/to the outside, I suppose heavy I/O could be a problem. Then again, agentic
coding workflows shouldn't involve much of that and are largely LLM-bound –
unless of course the agent spawns your application for, e.g., testing purposes
and that application does some heavy file system I/O or downloads gigabytes of
files from the internet. In this case, it might be best to not mount the
relevant directory tree and use an in-memory file system, and/or download files
out of band, if possible.

Ultimately, I have yet to gain in-depth experience with how Tuor performs,
though. If you notice any performance issues, I'd be very interested in
[hearing](https://github.com/codethief/tuor/issues) about those!
