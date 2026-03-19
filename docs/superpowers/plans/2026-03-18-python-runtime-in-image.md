# Python Runtime In Image Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a built-in Python runtime to the `opencode-harness` Docker image, with `ARG PYTHON_VERSION` support and a `latest-stable` default that resolves to the newest stable CPython release.

**Architecture:** Keep `node:22-slim` as the final runtime image, but switch the Docker build to a multi-stage flow. A resolver script determines the concrete Python version, a builder stage installs that exact CPython runtime into an isolated prefix, and the final stage copies only the runtime plus required shared libraries into the released image. Extend repo tests and runtime verification so both default and explicit-version builds are covered.

**Tech Stack:** Docker multi-stage builds, Node 22, Bash, CPython source build, built-in Node test runner

---

## File Map

- Create: `scripts/resolve-python-version.mjs`
  - Resolve `latest-stable` to the newest stable CPython version from `python.org`
  - Validate explicit `X.Y.Z` inputs
  - Expose pure parsing helpers for unit tests
- Create: `scripts/install-python-runtime.sh`
  - Download, build, and install CPython into an isolated prefix in the builder stage
- Create: `tests/resolve-python-version.test.mjs`
  - Unit tests for resolver parsing and CLI behavior
- Modify: `Dockerfile`
  - Add `ARG PYTHON_VERSION=latest-stable`
  - Add multi-stage resolver and Python builder flow
  - Copy runtime into final `node:22-slim` image
- Modify: `scripts/verify-runtime.sh`
  - Add Python runtime and `venv` checks
- Modify: `scripts/verify-image.sh`
  - Verify packaged Python runtime in real containers
- Modify: `tests/docker-contract.test.mjs`
  - Assert Dockerfile/python contract and script wiring
- Modify: `tests/verify-runtime.test.mjs`
  - Add fixture-based Python preflight checks
- Modify: `README.md`
  - Document built-in Python support and `PYTHON_VERSION` override

## Chunk 1: Python Version Resolution

### Task 1: Add and test the Python version resolver

**Files:**
- Create: `scripts/resolve-python-version.mjs`
- Create: `tests/resolve-python-version.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  parseLatestStableVersion,
  normalizeRequestedVersion,
} from '../scripts/resolve-python-version.mjs';

test('parseLatestStableVersion picks newest stable release', () => {
  const html = `
    <a>Download Python 3.15.0b1</a>
    <a>Download Python 3.14.3</a>
    <a>Download Python 3.13.12</a>
  `;
  assert.equal(parseLatestStableVersion(html), '3.14.3');
});

test('normalizeRequestedVersion accepts latest-stable sentinel', () => {
  assert.equal(normalizeRequestedVersion('latest-stable'), 'latest-stable');
});

test('normalizeRequestedVersion accepts exact X.Y.Z versions', () => {
  assert.equal(normalizeRequestedVersion('3.14.3'), '3.14.3');
});

test('normalizeRequestedVersion rejects non-exact versions', () => {
  assert.throws(() => normalizeRequestedVersion('3.14'));
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `node --test tests/resolve-python-version.test.mjs`  
Expected: FAIL because the resolver file does not exist yet

- [ ] **Step 3: Write the minimal implementation**

```js
export function normalizeRequestedVersion(value) {
  const input = String(value || '').trim();
  if (input === 'latest-stable') return input;
  if (!/^\d+\.\d+\.\d+$/.test(input)) {
    throw new Error(`Invalid PYTHON_VERSION: ${input}`);
  }
  return input;
}

export function parseLatestStableVersion(html) {
  const matches = [...html.matchAll(/Download Python (\d+\.\d+\.\d+)/g)]
    .map((match) => match[1]);
  if (matches.length === 0) throw new Error('Could not resolve latest stable Python release');
  return matches.sort(compareVersions).at(-1);
}
```

- [ ] **Step 4: Add CLI behavior**
  - `latest-stable` fetches `https://www.python.org/downloads/`
  - explicit versions print directly
  - CLI prints only the resolved version to stdout
  - build errors go to stderr with clear messages

- [ ] **Step 5: Run the focused tests again**

Run: `node --test tests/resolve-python-version.test.mjs`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/resolve-python-version.mjs tests/resolve-python-version.test.mjs
git commit -m "test: add Python version resolver coverage"
```

## Chunk 2: Multi-Stage Python Build

### Task 2: Add Python build helper and wire it into the Dockerfile

**Files:**
- Create: `scripts/install-python-runtime.sh`
- Modify: `Dockerfile`
- Modify: `tests/docker-contract.test.mjs`

- [ ] **Step 1: Write failing Docker contract tests**

```js
test('Dockerfile defines PYTHON_VERSION build arg and multi-stage Python wiring', async () => {
  const dockerfile = await readText('../Dockerfile');
  assert.match(dockerfile, /ARG PYTHON_VERSION=latest-stable/);
  assert.match(dockerfile, /COPY scripts\/resolve-python-version\.mjs/);
  assert.match(dockerfile, /COPY scripts\/install-python-runtime\.sh/);
  assert.match(dockerfile, /python-version\.txt/);
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `node --test tests/docker-contract.test.mjs`  
Expected: FAIL because the Python Docker contract is not present yet

- [ ] **Step 3: Write the Python build helper**

```bash
#!/usr/bin/env bash
set -euo pipefail

PYTHON_VERSION="$1"
PREFIX="$2"

curl -fsSLO "https://www.python.org/ftp/python/${PYTHON_VERSION}/Python-${PYTHON_VERSION}.tar.xz"
tar -xf "Python-${PYTHON_VERSION}.tar.xz"
cd "Python-${PYTHON_VERSION}"
./configure --prefix="$PREFIX" --with-ensurepip=install
make -j"$(nproc)"
make install
```

- [ ] **Step 4: Convert the Dockerfile to a multi-stage build**
  - add `ARG PYTHON_VERSION=latest-stable`
  - add resolver stage on `node:22-slim`
  - copy `scripts/resolve-python-version.mjs` into resolver stage
  - run resolver and write `/tmp/python-version.txt`
  - add Python builder stage with build deps and `scripts/install-python-runtime.sh`
  - install to `/opt/python`
  - in final `node:22-slim` stage:
    - keep existing OpenCode/Brave/vendor behavior intact
    - install only runtime libraries Python needs
    - copy `/opt/python`
    - copy resolved version to `/opt/opencode/python-version.txt`
    - symlink:
      - `/usr/local/bin/python3 -> /opt/python/bin/python3`
      - `/usr/local/bin/python -> /opt/python/bin/python3`
      - `/usr/local/bin/pip3 -> /opt/python/bin/pip3`
      - `/usr/local/bin/pip -> /opt/python/bin/pip3`

- [ ] **Step 5: Keep the final image small**
  - do not leave compiler packages in the final stage
  - do not fetch Python at container startup
  - keep build-only tooling inside resolver/builder stages only

- [ ] **Step 6: Run the focused tests again**

Run: `node --test tests/docker-contract.test.mjs`  
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add Dockerfile scripts/install-python-runtime.sh tests/docker-contract.test.mjs
git commit -m "feat: add multi-stage Python runtime build"
```

## Chunk 3: Runtime Verification

### Task 3: Extend preflight and smoke checks for Python

**Files:**
- Modify: `scripts/verify-runtime.sh`
- Modify: `tests/verify-runtime.test.mjs`
- Modify: `scripts/verify-image.sh`

- [ ] **Step 1: Write failing fixture-based tests for Python checks**

```js
test('verify-runtime preflight fails when python3 is missing', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    PATH: fixture.binDir,
  });
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /python3/i);
});

test('verify-runtime preflight fails when pip3 is missing', async () => {
  // same fixture pattern
});

test('verify-runtime preflight fails when venv creation fails', async () => {
  // stub python3 -m venv to exit non-zero
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `node --test tests/verify-runtime.test.mjs`  
Expected: FAIL because Python checks are not implemented yet

- [ ] **Step 3: Implement the runtime checks in `scripts/verify-runtime.sh`**
  - add `command -v python3`
  - add `command -v pip3`
  - optionally assert `python` and `pip` also exist
  - run:
    - `python3 --version`
    - `pip3 --version`
    - `tmpdir="$(mktemp -d)" && python3 -m venv "$tmpdir/venv" && rm -rf "$tmpdir"`
  - if `/opt/opencode/python-version.txt` exists, verify it is non-empty

- [ ] **Step 4: Update smoke coverage**
  - in `scripts/verify-image.sh`, add container checks for:
    - `python3 --version`
    - `python --version`
    - `pip3 --version`
    - `python3 -c "import ssl, sqlite3, venv"`
    - `python3 -m venv /tmp/opencode-venv-test`
  - keep current MCP/Brave checks intact

- [ ] **Step 5: Run the focused tests again**

Run: `node --test tests/verify-runtime.test.mjs`  
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/verify-runtime.sh scripts/verify-image.sh tests/verify-runtime.test.mjs
git commit -m "test: verify packaged Python runtime"
```

## Chunk 4: Docs And Final Validation

### Task 4: Document the new build/runtime contract and verify both build paths

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Update README build docs**
  - keep default build command:
    - `docker build -f Dockerfile -t opencode-harness .`
  - add explicit override example:
    - `docker build -f Dockerfile --build-arg PYTHON_VERSION=3.14.3 -t opencode-harness .`
  - document that the default `PYTHON_VERSION` is `latest-stable`
  - document that the image includes:
    - `python`
    - `python3`
    - `pip`
    - `pip3`
    - `venv`

- [ ] **Step 2: Add one short operational note**
  - default builds depend on reaching `python.org` at build time
  - explicit versions still fetch the matching CPython release tarball from `python.org`

- [ ] **Step 3: Run the full repo tests**

Run: `npm test`  
Expected: PASS

- [ ] **Step 4: Run the default-image build verification**

Run: `docker build --pull --no-cache -f Dockerfile -t opencode-harness .`  
Expected: PASS

- [ ] **Step 5: Run the packaged smoke script**

Run: `IMAGE_TAG=opencode-harness scripts/verify-image.sh`  
Expected: PASS with current MCP/Brave checks plus Python runtime checks

- [ ] **Step 6: Verify explicit version override once**

Run: `docker build --pull --no-cache -f Dockerfile --build-arg PYTHON_VERSION=3.14.3 -t opencode-harness:py-3.14.3 .`  
Expected: PASS

- [ ] **Step 7: Verify the explicit image reports the requested Python**

Run: `docker run --rm opencode-harness:py-3.14.3 python3 --version`  
Expected: output contains `Python 3.14.3`

- [ ] **Step 8: Commit**

```bash
git add README.md
git commit -m "docs: describe Python runtime image support"
```

## Final Verification Checklist

- [ ] Default build resolves `latest-stable` successfully
- [ ] Explicit `PYTHON_VERSION=X.Y.Z` build succeeds
- [ ] Final image still starts `opencode web` normally
- [ ] Existing MCP discovery and Brave behavior still pass smoke checks
- [ ] Final image exposes `python`, `python3`, `pip`, and `pip3`
- [ ] `python3 -m venv` works in the released image
- [ ] README reflects the new public contract
