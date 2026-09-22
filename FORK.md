# Fork maintenance

`origin` is `a-homelab/opencode-gpt-imagegen`; `upstream` is
`yuji-hatakeyama/opencode-gpt-imagegen`. Keep the upstream package name, version,
release scripts, and generation helpers so upstream changes remain easy to rebase.
Do not publish this fork under the upstream npm package name or push upstream
release tags to trigger its publishing workflow.

The v2 adapter builds on [upstream PR #97](https://github.com/yuji-hatakeyama/opencode-gpt-imagegen/pull/97),
reviewed at `bdafce913056df32adf9a218e44d0b2c2f2b5077`. The default export retains
v1's `server()` and adds v2's `setup()`. Shared generation and tool descriptions
live in `src/generate.ts` and `src/tool-spec.ts`; API-specific wiring stays in
`src/index.ts` and `src/v2.ts`.

The additions beyond that PR are host-managed v2 credentials, official v2 type
checking, session-relative paths, and cancellation checks before requests and
output writes. `@opencode/plugin` is an exact development dependency with only
type imports, so it adds no v2 runtime dependency to v1 installations. Legacy
auth behavior remains confined to the v1 entrypoint.

## Install from source

The public npm package still belongs to upstream. To use this fork locally:

```sh
bun install --frozen-lockfile
bun run build
```

Configure the absolute path to this checkout's `dist` directory in OpenCode v2's
`plugins` array. OpenCode 2.0.11 and 2.0.14 require a directory for configured
local plugins. The checkout's `node_modules` must remain available for this
normal package build.

`opencode-container` instead downloads an exact fork commit during its image
build and bundles all runtime dependencies into one local plugin. It needs no
runtime package installation. Publish a fork commit before updating the
container's `IMAGEGEN_REVISION`; do not point that pin at a moving branch.

## Rebase and validate

```sh
git fetch upstream
git rebase upstream/main
bun install --frozen-lockfile
bun run typecheck
bunx biome ci .
bun run test
bun run build
```

Review upstream's changes to PR #97 when it lands and drop equivalent local
changes. Keep the credential resolver until upstream uses the v2 integration
API. Do not replace it with SQLite queries or an `auth.json` fallback.

The API was checked against OpenCode 2.0.11, 2.0.14, and the v2 development
revision `10aa949f435e1af326cad4e3577a3b1bfb1318d7`. The official types are pinned
to 2.0.14. Older v2 hosts may omit the tool abort signal. Check the
[migration guide](https://opencode.ai/v2/docs/build/plugins/migrate-v1) and
[plugin API](https://opencode.ai/v2/docs/build/plugins) when changing the pin.
The generation tests mock the backend and require no real credentials.
