# Simplify Python Installation: COPY from Official Docker Image

## Decision

Replace the source-build Python installation (2 build stages, 3 scripts, 20+ build deps, cosign) with `COPY --from=python:X-slim-bookworm` multi-stage pattern.

## Motivation

The current Dockerfile compiles CPython from source: a `python-version-resolver` stage scrapes python.org for the latest stable version, then a `python-builder` stage downloads, GPG/Sigstore-verifies, and compiles the tarball with `build-essential` and 10+ `-dev` packages. This is slow, complex, and unnecessary — the official `python:X-slim-bookworm` Docker image provides the same runtime, built on the same `debian:bookworm-slim` base as `node:22-slim`.

## Design

### Dockerfile

Replace 3 stages with 2:

```dockerfile
ARG PYTHON_VERSION=3
FROM python:${PYTHON_VERSION}-slim-bookworm AS python-source

FROM node:22-slim

COPY --from=python-source /usr/local/bin/ /usr/local/bin/
COPY --from=python-source /usr/local/lib/ /usr/local/lib/
RUN ldconfig \
  && node --version \
  && npm --version \
  && node -e "require('fs'); require('net'); require('child_process'); console.log('node-core-ok')" \
  && python3 --version \
  && python3 -c "import ssl, sqlite3, ctypes, venv; print('python-stdlib-ok')" \
  && pip3 --version
```

- `python-source` is a reference stage — no commands, just provides files to copy.
- `node:22-slim` remains the final base because `opencode-ai` and `mcp-server-brave-search` are npm packages requiring Node at runtime.
- Python is copied *after* the Node base so Python files layer on top. No filename collisions (Node uses `node`/`npm`/`npx`, Python uses `python3`/`pip3`).
- `ldconfig` refreshes the shared library cache so Python's `.so` files are discoverable.
- **Build-time smoke gate:** Immediately after `ldconfig`, verify both runtimes still work. `node --version` and `npm --version` catch Node breakage from the COPY. `python3 --version`, `pip3 --version`, and `python3 -c "import ssl, sqlite3, ctypes, venv"` catch missing shared libs (`libssl`, `libsqlite3`, `libffi`, `libexpat1`, etc.). If anything fails, the Docker build fails fast at this layer — before installing npm globals or copying application files.
- The `apt-get install` in the final stage drops all Python-specific runtime libs (`libbz2-1.0 libffi8 libgdbm6 liblzma5 libncursesw6 libreadline8 libsqlite3-0 libssl3 libuuid1 zlib1g`). These are system packages in `/usr/lib` — both `node:22-slim` and `python:3.x-slim-bookworm` share `debian:bookworm-slim` as the base, so most are already present. The build-time smoke gate catches any that are missing.
- The symlink block (`ln -sf /opt/python/bin/python3 /usr/local/bin/python3`, etc.) is removed — Python is directly in `/usr/local/bin`.

### Version Selection

Version selection moves from a custom scraper to Docker Hub tag resolution:

| Build arg | Docker tag | Result |
|---|---|---|
| `PYTHON_VERSION=3` (default) | `python:3-slim-bookworm` | Latest stable 3.x |
| `PYTHON_VERSION=3.14` | `python:3.14-slim-bookworm` | Latest 3.14.x patch |
| `PYTHON_VERSION=3.14.3` | `python:3.14.3-slim-bookworm` | Exact version |

### Gotcha: libexpat1

Python needs `libexpat1` (XML parsing) which may not be in `node:22-slim`. Verify with `ldd /usr/local/bin/python3` after the copy. If missing, add to `apt-get install`.

## Files Deleted

| File | Purpose (now unnecessary) |
|---|---|
| `scripts/resolve-python-version.mjs` | Scraped python.org for latest stable version |
| `scripts/install-python-runtime.sh` | Downloaded, verified, compiled CPython from source |
| `scripts/verify-python-archive.sh` | GPG/Sigstore signature verification of tarball |
| `tests/resolve-python-version.test.mjs` | Tests for the version resolver |
| `tests/verify-python-archive.test.mjs` | Tests for the archive verifier |

## Files Modified

### `verify-runtime.sh`

- Remove `PYTHON_VERSION_FILE` variable and the version-file existence check (`if [[ -e "$PYTHON_VERSION_FILE" ]]...`).
- `check_python_runtime` function otherwise unchanged — it still validates `python3`, `pip3`, `venv` on PATH.

### `tests/docker-contract.test.mjs`

- Rewrite test `'Dockerfile builds Python in dedicated resolver and builder stages...'` to assert the new `COPY --from=python-source` pattern and `ARG PYTHON_VERSION=3`.
- Delete test `'Python runtime installer script builds CPython into /opt/python...'` — the installer script no longer exists.
- Update test `'smoke-mcp-runtime verifies the packaged Python runtime commands and resolved version marker'` — remove assertions for `python-version.txt`, `resolved_python_version`, and `sys.version.startswith(resolved_version)` to match the updated smoke script.

### `tests/verify-runtime.test.mjs`

- Remove `pythonVersion` option and `python-version.txt` file creation from `makeRuntimeFixture`.

### `scripts/smoke-mcp-runtime.sh`

- Remove `test -f /opt/opencode/python-version.txt` and `resolved_python_version` lines.
- Remove `sys.version.startswith(resolved_version)` assertions from the Python heredoc blocks.
- Keep all other Python runtime checks: `python3 --version`, `pip3 --version`, `python3 -m venv`, `sys.executable`.

## Files Unchanged

- `scripts/render-opencode-config.mjs` — no Python involvement
- `scripts/check-mcp-discovery.mjs` — no Python involvement
- `scripts/validate-sources-lock.mjs` — no Python involvement
- `scripts/opencode-harness-entrypoint` — no Python involvement
- `scripts/install-superpowers.sh` — no Python involvement
- `config/opencode.json` — no Python involvement
- All other tests — no Python-build assertions

## What This Eliminates

- `python-builder` Dockerfile stage (build-essential, 10+ -dev packages, cosign download)
- `python-version-resolver` Dockerfile stage
- 3 scripts, 2 test files
- ~20 build-only apt packages
- Build time: minutes → seconds
- `python-version.txt` marker file

## What This Preserves

- User-controlled Python version via `--build-arg PYTHON_VERSION=...`
- Default to latest stable when unspecified
- Runtime preflight checks for `python3`, `pip3`, `venv`
- All existing Node scripts, tests, and runtime behavior
