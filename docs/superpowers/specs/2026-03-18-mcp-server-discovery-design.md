# MCP Server Discovery And Brave Env Design

## Goal

Add the MCP servers `context7`, `grep_app`, and `brave-search` to the OpenCode harness workflow while keeping secrets out of the repo and image. The image should expose `context7` and `grep_app` by default, support `brave-search` when `BRAVE_API_KEY` is provided at runtime, and render `brave-search` as disabled when the key is absent so OpenCode does not surface a broken enabled MCP entry.

Versioning policy for these MCP integrations:

- remote MCPs should track their canonical upstream service URLs without repo-level version pinning
- local npm-installed MCP packages should be pinned to a specific version for reproducible builds; the pinned version should be updated deliberately when an upgrade is needed

For the remote MCPs in this repo, the guaranteed scope is static discovery from the configured canonical URLs. This spec does not promise ongoing compatibility with arbitrary upstream protocol changes beyond successful OpenCode discovery/listing behavior on the pinned harness runtime.

## Current Context

The image already bakes `opencode-oca-auth` and `superpowers` into the runtime through `config/opencode.json`, the `Dockerfile`, and `scripts/verify-runtime.sh`. Current smoke coverage verifies plugin wiring, OCA model visibility, and key README operator flow expectations, but it does not yet configure or assert any MCP servers.

The harness already pins `OPENCODE_CONFIG` to an image-managed path under `/opt/opencode`. The smoke checks should continue to validate that image-managed config, not any project-local `opencode.json` in `/workspace`. A mounted workspace config does not participate unless an operator explicitly overrides `OPENCODE_CONFIG`.

The user also explicitly wants the provided Brave Search API key removed from the repo change itself, added to `~/.zshrc`, and loaded into future terminals from there. The key should live in the host shell environment and be passed into the container only when available.

## Design

### Host Environment Setup

Add `BRAVE_API_KEY` to `~/.zshrc` so new host terminals export it automatically, then validate it in a fresh `zsh` shell. This is a user-machine setup step, not a repo file. The repo documentation should tell operators to obtain their own Brave Search API key and export `BRAVE_API_KEY` before running the container.

The repo must not hardcode the provided key in tracked files, Docker build args, or committed examples.

### Configuration

Keep a checked-in base config file at `config/opencode.json`, and keep it valid JSON. During image build, copy it to a stable image path such as `/opt/opencode/opencode.base.json`. At container startup, render the final runtime config to `/opt/opencode/opencode.json`, which remains the path referenced by `OPENCODE_CONFIG`.

The checked-in base config should keep a top-level `mcp` object with these entries:

- `context7`
  - `type`: `remote`
  - `url`: `https://mcp.context7.com/mcp`
  - `enabled`: `true`
- `grep_app`
  - `type`: `remote`
  - `url`: `https://mcp.grep.app`
  - `enabled`: `true`

These remote MCPs intentionally follow the latest upstream service behavior through their canonical URLs rather than a pinned repo-managed version.

This remains a declarative image change only. No build-time installer or startup fetch step is required because OpenCode supports remote MCP servers directly from config.

Add a `brave-search` MCP definition to the checked-in base config and preserve the same `command` in the rendered config. Its properties should be:

- `type`: `local`
- `command`: `["mcp-server-brave-search"]`, resolved from image-baked install assets
- `enabled`: `false` in the checked-in base config
- no literal Brave key in the file

Because the Brave server should be disabled when the key is missing, `config/opencode.json` acts as the checked-in base input to a startup render step. The checked-in base file should omit `environment.BRAVE_API_KEY` entirely. The rendered runtime config at `/opt/opencode/opencode.json` must:

- enable `brave-search` only when `BRAVE_API_KEY` is non-empty in the container environment
- set `brave-search.enabled` to `false` when `BRAVE_API_KEY` is absent or empty
- add `environment.BRAVE_API_KEY` only in the rendered config when `BRAVE_API_KEY` is present
- preserve the existing baked plugin and model wiring
- preserve the always-enabled `context7` and `grep_app` entries unchanged

The container runtime should receive the key through `docker run -e BRAVE_API_KEY` or equivalent environment pass-through. The image itself must not contain the secret.

To keep Brave discovery from depending on a live npm package download, the Docker image should install `@modelcontextprotocol/server-brave-search` (pinned version) during build with global npm installation so the binary `mcp-server-brave-search` is available in the image `PATH`. Build the image with fresh package metadata, record the actually installed Brave package version into an image-managed metadata file during the same build, and use that recorded installed version as the verification source of truth. The rendered config should invoke that installed binary directly, so `opencode mcp list` cannot trigger a package download.

### Docker And Entrypoint Behavior

Add a dedicated render helper such as `scripts/render-opencode-config.mjs`, and have the entrypoint invoke it before preflight and `opencode web` launch.

The startup logic should:

- read the checked-in config template
- write a runtime config under `/opt/opencode/opencode.json`
- set `brave-search.enabled` based on whether `BRAVE_API_KEY` is present
- pass `BRAVE_API_KEY` through to the Brave MCP environment only when enabled

Because `OPENCODE_CONFIG` points at `/opt/opencode/opencode.json`, both `scripts/verify-runtime.sh` and `opencode web` will read the rendered image-managed config regardless of files mounted under `/workspace`.

If `BRAVE_API_KEY` is missing, container startup should still succeed and the rendered config should leave `brave-search` disabled rather than enabled with an empty key.

Observable no-key contract:

- the rendered `/opt/opencode/opencode.json` contains `brave-search.enabled: false`
- container startup and preflight still succeed

In the no-key case, `scripts/verify-runtime.sh` should treat the rendered config as the source of truth for Brave disablement and should not require `brave-search` to appear in `opencode mcp list`.

### Runtime Verification

Extend `scripts/verify-runtime.sh` preflight with an MCP discovery check:

- verify the baked Brave binary exists with `command -v mcp-server-brave-search`
- run `opencode mcp list`
- fail if the command cannot run successfully
- fail unless the output shows both configured server names as standalone list entries: `context7` and `grep_app`
- read the rendered `/opt/opencode/opencode.json` and use `brave-search.enabled` there as the single source of truth for Brave expectations
- when rendered `brave-search.enabled` is `true`, require `opencode mcp list` to show `brave-search` as a discovered server name
- when rendered `brave-search.enabled` is `false`, require only that `opencode mcp list` exits successfully and includes `context7` and `grep_app`; do not make preflight depend on whether the pinned CLI chooses to omit or display disabled Brave entries

This keeps the runtime contract focused on discovery rather than remote endpoint health. The smoke check should prove that the baked image exposes the intended MCP definitions to OpenCode, while avoiding flaky failures caused by external network conditions or third-party availability.

`opencode mcp list` may include status or connectivity information. The verification must treat those status fields as informational only. Success means the command exits successfully and the list output contains the expected configured names for the current env state; it must not require remote services to be reachable.

Because the Brave package is baked into the image and invoked through its installed binary, this discovery step should not depend on npm or `npx` fetching packages from the network.

The implementation should explicitly confirm these behaviors on the pinned `opencode-ai@1.2.27` runtime:

- `opencode mcp list` still exits successfully while reporting configured MCP servers even when remote MCP endpoints are not contacted successfully
- `opencode mcp list` does not raise an error for a rendered-disabled `brave-search` entry

If the pinned CLI behaves differently in practice, stop and revise the smoke-check strategy before claiming completion.

Also add a compatibility gate for upstream Brave MCP changes: if the latest published release no longer exposes the `mcp-server-brave-search` binary, no longer starts successfully with only `BRAVE_API_KEY` and no extra flags, or no longer works with the pinned `opencode-ai@1.2.27` discovery flow, stop and revise the implementation plan rather than silently shipping a broken integration.

### Test Coverage

Update repo tests to cover these behaviors:

1. the checked-in base config `config/opencode.json` remains valid JSON and includes `context7`, `grep_app`, and `brave-search` with the intended names, types, URLs or command, with `brave-search.enabled: false` and no `environment.BRAVE_API_KEY` field in the base file
2. the dedicated render helper enables or disables `brave-search` based on whether `BRAVE_API_KEY` is non-empty
3. the render path writes `brave-search.enabled: true` plus `environment.BRAVE_API_KEY` only when `BRAVE_API_KEY` is non-empty, and writes `brave-search.enabled: false` with no injected key field when it is absent or empty
4. the render path leaves `context7` and `grep_app` unchanged from the checked-in base config
5. `scripts/opencode-harness-entrypoint` invokes the dedicated render helper before `scripts/verify-runtime.sh`
6. the Docker image preserves the immutable copied base template path such as `/opt/opencode/opencode.base.json` and renders `/opt/opencode/opencode.json` from it at startup
7. `scripts/verify-runtime.sh` checks `command -v mcp-server-brave-search`, runs `opencode mcp list`, and drives Brave expectations from rendered `brave-search.enabled` rather than raw env presence or loose substring checks
8. `scripts/verify-runtime.sh` fails if `context7` or `grep_app` are missing from `opencode mcp list`
9. `scripts/verify-runtime.sh` fails if rendered `brave-search.enabled` is `true` but `brave-search` is missing from `opencode mcp list`
10. Docker/manual validation confirms the built image installed the pinned `@modelcontextprotocol/server-brave-search` version, records the actually installed Brave package version in image-managed metadata, and does not require npm to download it on demand at runtime
11. validation includes a manual external-input repo scan confirming the previously provided Brave key string does not remain in tracked repo files or Docker build inputs

This matches the existing repo pattern of contract tests for static config and preflight behavior without requiring Docker or live network access in `npm test`. The latest-release check belongs to Docker/manual validation, not repo unit tests.

In addition to `npm test`, add a dedicated automated Docker image verification script (`scripts/verify-image.sh`) suitable for CI or repeated local verification. That verification path should build the image from fresh package metadata and fail if the pinned Brave package no longer provides `mcp-server-brave-search`, no longer starts with only `BRAVE_API_KEY`, or no longer works with the pinned `opencode-ai@1.2.27` discovery flow.

Automation contract for that smoke script:

- it must not depend on the operator's interactive shell startup files
- it may use a dummy non-empty `BRAVE_API_KEY` for keyed startup/discovery checks, because the goal is MCP startup/discovery compatibility rather than live Brave API success
- it must run four states: keyed online, no-key online, keyed no-egress, and no-key no-egress
- it must inspect the rendered `/opt/opencode/opencode.json` in each state so Brave enablement is asserted from config, not inferred only from `opencode mcp list`

### Documentation

Update `README.md` in these minimal, user-relevant places:

- run examples should pass `BRAVE_API_KEY` through with `-e BRAVE_API_KEY`
- setup guidance should tell users to obtain a Brave Search API key and export `BRAVE_API_KEY`
- verification should include `docker exec -it opencode-harness opencode mcp list`
- behavior notes should explain that missing `BRAVE_API_KEY` leaves `brave-search` disabled in the rendered config while the container still starts normally

```bash
docker exec -it opencode-harness opencode mcp list
```

No broader README restructuring is needed because this change adds operator-visible runtime capability and an env requirement, but it does not change auth or container lifecycle guidance.

## Out Of Scope

- probing the remote MCP endpoints for live availability
- adding auth headers or API-key management for Context7
- introducing persistent secret files inside the repo or image
- changing baked plugin or model wiring

## Validation

After implementation, validate with:

```bash
npm test
zsh -ic '[[ -n ${BRAVE_API_KEY:-} ]] && printf present\n || printf missing\n'
docker build --pull --no-cache -t opencode-harness .
docker run -d --name opencode-harness-mcp-smoke -e BRAVE_API_KEY -v "$(pwd):/workspace" opencode-harness
docker exec -it opencode-harness-mcp-smoke sh -lc 'command -v mcp-server-brave-search'
docker exec -it opencode-harness-mcp-smoke npm ls -g @modelcontextprotocol/server-brave-search --depth=0
docker exec -it opencode-harness-mcp-smoke cat /opt/opencode/mcp-versions.json
docker exec -it opencode-harness-mcp-smoke sh -lc 'BRAVE_API_KEY="$BRAVE_API_KEY" timeout 3 mcp-server-brave-search >/tmp/brave.out 2>/tmp/brave.err; code=$?; test "$code" = 124'
docker exec -it opencode-harness-mcp-smoke opencode mcp list
docker exec -it opencode-harness-mcp-smoke node -e 'const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync("/opt/opencode/opencode.json","utf8")); const brave=c.mcp["brave-search"]; console.log(JSON.stringify({enabled: brave.enabled, hasKey: Boolean(brave.environment && brave.environment.BRAVE_API_KEY)}))'
docker rm -f opencode-harness-mcp-smoke
```

The expected result is that tests pass, the host shell exposes a non-empty `BRAVE_API_KEY`, the image builds from fresh package metadata, the image-managed MCP version metadata matches the installed global Brave package version, `mcp-server-brave-search` starts successfully with only `BRAVE_API_KEY` until killed by timeout, preflight succeeds, `opencode mcp list` shows `context7`, `grep_app`, and `brave-search` when the key is present, and the rendered config shows `brave-search.enabled: true` with an injected key field while leaving `context7` and `grep_app` unchanged.

Also run a manual local secret-scan check before considering the work complete. Supply the previously provided Brave key string through a transient shell variable or prompt, not a tracked file, and verify that exact string no longer appears anywhere in tracked repo files, generated config templates, Docker build inputs, baked image metadata, or files inside a no-key container.

Also validate the no-key path:

```bash
docker run -d --name opencode-harness-mcp-nokey -v "$(pwd):/workspace" opencode-harness
docker exec -it opencode-harness-mcp-nokey sh -lc 'command -v mcp-server-brave-search'
docker exec -it opencode-harness-mcp-nokey opencode mcp list
docker exec -it opencode-harness-mcp-nokey node -e 'const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync("/opt/opencode/opencode.json","utf8")); const brave=c.mcp["brave-search"]; console.log(JSON.stringify({enabled: brave.enabled, hasKey: Boolean(brave.environment && brave.environment.BRAVE_API_KEY)}))'
docker rm -f opencode-harness-mcp-nokey
```

The expected result is that startup still succeeds, `opencode mcp list` exits successfully and shows `context7` and `grep_app`, and the rendered config shows `brave-search.enabled: false` with no injected key field while leaving `context7` and `grep_app` unchanged. The no-key check should not depend on whether the CLI chooses to print disabled Brave entries.

Also validate the remote-latest assumption under a reproducible no-egress condition:

```bash
docker run -d --name opencode-harness-mcp-offline --network none -v "$(pwd):/workspace" opencode-harness
docker exec -it opencode-harness-mcp-offline opencode mcp list
docker rm -f opencode-harness-mcp-offline

docker run -d --name opencode-harness-mcp-offline-keyed --network none -e BRAVE_API_KEY=dummy-brave-key -v "$(pwd):/workspace" opencode-harness
docker exec -it opencode-harness-mcp-offline-keyed sh -lc 'command -v mcp-server-brave-search'
docker exec -it opencode-harness-mcp-offline-keyed opencode mcp list
docker rm -f opencode-harness-mcp-offline-keyed
```

The expected result is that `opencode mcp list` still exits successfully even with no network access. In the keyed no-egress run, the container should still expose the baked Brave binary and render `brave-search` enabled without requiring npm/network fetches. If the pinned CLI instead fails hard when `context7` or `grep_app` are unreachable, stop and revise the smoke-check strategy before implementation.

In both offline states, also inspect the rendered `/opt/opencode/opencode.json`:

- keyed no-egress must show `brave-search.enabled: true` with an injected key field
- no-key no-egress must show `brave-search.enabled: false` with no injected key field
