# Tuor, a CLI for sandboxing your coding agents
Tuor is a convenience wrapper around
[Gondolin](https://github.com/earendil-works/gondolin), a tool that allows
spawning micro VMs (using QEMU or libkrun) for the purpose of sandboxing coding
agents.

While Gondolin focuses on the low-level virtualization plumbing and on providing
a great and flexible API, Tuor's goal is to provide an easy-to-use CLI for
common use cases.

I'm building Tuor mainly to scratch my own itch. Maybe it will make sense to
upstream some of its features to Gondolin eventually. However, right now I just
want convenient sandboxing because I'm tired of reviewing every single shell
command my agent wants to execute. Then again, I'm not even sure yet what
"convenient" would look like exactly. So Tuor is also somewhat of an experiment.


# Usage
TODO


# Development
For the bootstrap you need to have [mise](https://mise.jdx.dev) installed. Then
do:

```
mise install
npm install
```

```
npm start
npm test
npm run typecheck
```
