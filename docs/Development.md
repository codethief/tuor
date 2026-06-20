# Development
## Setup
We use [mise](https://mise.jdx.dev) for the bootstrap. Once mise is installed,
do:

```
mise install
npm install
```

Available commands (compare `package.json`):

```shell
npm run start  # Fire up Tuor right from the source code (without building)
npm run build  # Build for release
npm run lint
npm run test
npm run typecheck
```


## Architecture
Currently there are three layers:

### CLI
- Parse & validate command line arguments, execute command.
- May call into / depend on config and/or core layer.


### Config
- Load & validate relevant config files, while doing $VAR interpolation,
  applying defaults, resolving relative paths. Merge them into one config,
  then convert resulting config into a core layer data structure.
- This layer is largely a "UI" layer – it attempts to make configuring the
  different features convenient for the user, so config data structures are
  largely designed around that, whereas core data structures are more
  canonical and designed around the "domain".
- May call into / depend on core but not on CLI layer.


### Core
- Thin wrapper around Gondolin + features we added.
- Must be standalone and not depend on CLI or config layer.
