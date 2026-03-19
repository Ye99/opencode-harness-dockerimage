# Python COPY from Official Image Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the source-build Python installation with `COPY --from=python:X-slim-bookworm`, delete the build machinery, and update all affected tests.

**Architecture:** Multi-stage Docker build with `python:X-slim-bookworm` as a source stage and `node:22-slim` as the final base. Python binaries are copied into `/usr/local/bin` and `/usr/local/lib`, verified with a build-time smoke gate, then used alongside Node at runtime.

**Tech Stack:** Docker multi-stage builds, Node.js test runner (`node --test`), bash

---

## File Structure

| File | Action | Responsibility |
|---|---|---|
| `Dockerfile` | Modify | Replace 3 stages with 2, add smoke gate |
| `scripts/verify-runtime.sh` | Modify | Remove python-version.txt references |
| `scripts/smoke-mcp-runtime.sh` | Modify | Remove version-marker assertions |
| `tests/docker-contract.test.mjs` | Modify | Update Dockerfile assertions, delete installer test |
| `tests/verify-runtime.test.mjs` | Modify | Remove pythonVersion/version-file from fixture |
| `scripts/resolve-python-version.mjs` | Delete | No longer needed |
| `scripts/install-python-runtime.sh` | Delete | No longer needed |
| `scripts/verify-python-archive.sh` | Delete | No longer needed |
| `tests/resolve-python-version.test.mjs` | Delete | No longer needed |
| `tests/verify-python-archive.test.mjs` | Delete | No longer needed |

---

### Task 1: Rewrite Dockerfile

**Files:**
- Modify: `Dockerfile`

- [ ] **Step 1: Rewrite the Dockerfile**

Replace the entire Dockerfile with the new 2-stage structure. The full new Dockerfile:

```dockerfile
ARG PYTHON_VERSION=3
FROM python:${PYTHON_VERSION}-slim-bookworm AS python-source

FROM node:22-slim

ENV OPENCODE_CONFIG=/opt/opencode/opencode.json \
    OPENCODE_PERMISSION_JSON= \
    OPENCODE_CONFIG_DIR=/opt/opencode \
    OPENCODE_SERVER_PORT=4096 \
    OPENCODE_SERVER_HOST=0.0.0.0 \
    OCA_OAUTH_BIND_HOST=0.0.0.0 \
    OCA_OAUTH_CALLBACK_PORT=48801 \
    WORKSPACE_DIR=/workspace \
    BROWSER=/bin/true

COPY --from=python-source /usr/local/bin/ /usr/local/bin/
COPY --from=python-source /usr/local/lib/ /usr/local/lib/
RUN ldconfig \
  && node --version \
  && npm --version \
  && node -e "require('fs'); require('net'); require('child_process'); console.log('node-core-ok')" \
  && python3 --version \
  && python3 -c "import ssl, sqlite3, ctypes, venv; print('python-stdlib-ok')" \
  && pip3 --version

RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /opt/opencode \
  && npm install -g opencode-ai@1.2.27 @modelcontextprotocol/server-brave-search@latest \
  && npm ls -g @modelcontextprotocol/server-brave-search --json --depth=0 > /opt/opencode/mcp-versions.json

WORKDIR /opt/opencode

COPY config/opencode.json /opt/opencode/opencode.base.json
COPY scripts/opencode-harness-entrypoint /usr/local/bin/opencode-harness-entrypoint
COPY scripts/install-superpowers.sh /opt/opencode/scripts/install-superpowers.sh
COPY scripts/check-mcp-discovery.mjs /opt/opencode/scripts/check-mcp-discovery.mjs
COPY scripts/render-opencode-config.mjs /opt/opencode/scripts/render-opencode-config.mjs
COPY scripts/validate-sources-lock.mjs /opt/opencode/scripts/validate-sources-lock.mjs
COPY scripts/verify-runtime.sh /opt/opencode/scripts/verify-runtime.sh
COPY vendor/sources.lock.json /opt/opencode/vendor/sources.lock.json
COPY vendor/opencode-oca-auth /opt/opencode/vendor/opencode-oca-auth
COPY vendor/superpowers /opt/opencode/vendor/superpowers

RUN chmod +x /usr/local/bin/opencode-harness-entrypoint /opt/opencode/scripts/install-superpowers.sh /opt/opencode/scripts/verify-runtime.sh \
  && ln -sf /usr/local/bin/python3 /usr/local/bin/python \
  && ln -sf /usr/local/bin/pip3 /usr/local/bin/pip \
  && node /opt/opencode/scripts/validate-sources-lock.mjs /opt/opencode/vendor/sources.lock.json /opt/opencode/vendor/opencode-oca-auth /opt/opencode/vendor/superpowers \
  && mkdir -p /opt/opencode/plugins \
  && cp -R /opt/opencode/vendor/opencode-oca-auth /opt/opencode/plugins/opencode-oca-auth \
  && /opt/opencode/scripts/install-superpowers.sh /opt/opencode/vendor/superpowers /opt/opencode

WORKDIR /workspace

EXPOSE 4096 48801

ENTRYPOINT ["/usr/local/bin/opencode-harness-entrypoint"]
```

Key differences from current:
- Removed: `python-version-resolver` stage, `python-builder` stage
- Removed: `COPY --from=python-builder /opt/python /opt/python`
- Removed: `COPY --from=python-version-resolver /opt/opencode/python-version.txt`
- Removed: `libbz2-1.0 libffi8 libgdbm6 liblzma5 libncursesw6 libreadline8 libsqlite3-0 libssl3 libuuid1 zlib1g` from apt-get
- Added: `COPY --from=python-source` for `/usr/local/bin/` and `/usr/local/lib/`
- Added: `ldconfig` + build-time smoke gate
- Changed: symlinks now point from `/usr/local/bin/python` → `/usr/local/bin/python3` (instead of from `/opt/python/bin/...`)
- Removed: `COPY scripts/resolve-python-version.mjs`, `COPY scripts/install-python-runtime.sh`, `COPY scripts/verify-python-archive.sh` (these files won't exist)

Note: If the smoke gate's `python3 -c "import ssl, sqlite3, ctypes, venv"` fails due to missing `libexpat1`, add `libexpat1` to the `apt-get install` line and move it before the `COPY --from=python-source` block.

- [ ] **Step 2: Run existing tests to verify nothing else broke**

Run: `node --test tests/docker-contract.test.mjs`

Expected: Some tests FAIL (the ones asserting old Dockerfile patterns). That's expected — we fix those in Task 4. Other tests in the file should still pass.

- [ ] **Step 3: Commit**

```bash
git add Dockerfile
git commit -m "Replace Python source build with COPY from python:X-slim-bookworm

Eliminates python-version-resolver and python-builder stages, cosign,
build-essential, and 10+ -dev packages. Adds build-time smoke gate
to verify both Node and Python runtimes after COPY."
```

---

### Task 2: Delete dead build scripts and their tests

**Files:**
- Delete: `scripts/resolve-python-version.mjs`
- Delete: `scripts/install-python-runtime.sh`
- Delete: `scripts/verify-python-archive.sh`
- Delete: `tests/resolve-python-version.test.mjs`
- Delete: `tests/verify-python-archive.test.mjs`

- [ ] **Step 1: Delete the files**

```bash
git rm scripts/resolve-python-version.mjs \
      scripts/install-python-runtime.sh \
      scripts/verify-python-archive.sh \
      tests/resolve-python-version.test.mjs \
      tests/verify-python-archive.test.mjs
```

- [ ] **Step 2: Run remaining tests to confirm no imports break**

Run: `node --test tests/*.test.mjs`

Expected: The deleted test files are gone, so they won't run. Remaining tests may have failures from Tasks 3-5 (not yet done), but there should be no "module not found" errors.

- [ ] **Step 3: Commit**

```bash
git commit -m "Remove Python source-build scripts and tests

These are replaced by COPY --from=python:X-slim-bookworm in the Dockerfile."
```

---

### Task 3: Update verify-runtime.sh

**Files:**
- Modify: `scripts/verify-runtime.sh:11` (remove PYTHON_VERSION_FILE variable)
- Modify: `scripts/verify-runtime.sh:74-76` (remove version-file check block)

- [ ] **Step 1: Remove the PYTHON_VERSION_FILE variable**

In `scripts/verify-runtime.sh`, delete this line:

```bash
PYTHON_VERSION_FILE="${PYTHON_VERSION_FILE:-$OPENCODE_CONFIG_DIR/python-version.txt}"
```

- [ ] **Step 2: Remove the version-file check block**

In the `check_python_runtime` function, delete these lines:

```bash
  if [[ -e "$PYTHON_VERSION_FILE" ]]; then
    [[ -s "$PYTHON_VERSION_FILE" ]] || fail "Python version file is empty: $PYTHON_VERSION_FILE"
  fi
```

- [ ] **Step 3: Verify the script is syntactically valid**

Run: `bash -n scripts/verify-runtime.sh`

Expected: Exit 0, no output.

- [ ] **Step 4: Commit**

```bash
git add scripts/verify-runtime.sh
git commit -m "Remove python-version.txt references from verify-runtime

The version marker file no longer exists; version is controlled by the
Docker tag at build time."
```

---

### Task 4: Update tests/docker-contract.test.mjs

**Files:**
- Modify: `tests/docker-contract.test.mjs:367-400` (rewrite Python Dockerfile test, delete installer test)
- Modify: `tests/docker-contract.test.mjs:321-343` (update smoke-mcp-runtime Python assertions test)

- [ ] **Step 1: Rewrite the Dockerfile Python stage test**

Replace the test `'Dockerfile builds Python in dedicated resolver and builder stages, then ships only the runtime contract'` (lines 367-382) with:

```javascript
test('Dockerfile copies Python from official image with build-time smoke gate', async () => {
  const dockerfile = await readText('../Dockerfile');

  assert.match(dockerfile, /^ARG PYTHON_VERSION=3$/m);
  assert.match(dockerfile, /^FROM python:\$\{PYTHON_VERSION\}-slim-bookworm AS python-source$/m);
  assert.match(dockerfile, /^FROM node:22-slim$/m);
  assert.match(dockerfile, /COPY --from=python-source \/usr\/local\/bin\/ \/usr\/local\/bin\//);
  assert.match(dockerfile, /COPY --from=python-source \/usr\/local\/lib\/ \/usr\/local\/lib\//);
  assert.match(dockerfile, /ldconfig/);
  assert.match(dockerfile, /node --version/);
  assert.match(dockerfile, /npm --version/);
  assert.match(dockerfile, /node-core-ok/);
  assert.match(dockerfile, /python3 --version/);
  assert.match(dockerfile, /python-stdlib-ok/);
  assert.match(dockerfile, /pip3 --version/);
  assert.match(dockerfile, /\/usr\/local\/bin\/python\b/);
  assert.match(dockerfile, /\/usr\/local\/bin\/pip\b/);
  assert.doesNotMatch(dockerfile, /python-version-resolver/);
  assert.doesNotMatch(dockerfile, /python-builder/);
  assert.doesNotMatch(dockerfile, /install-python-runtime/);
  assert.doesNotMatch(dockerfile, /verify-python-archive/);
  assert.doesNotMatch(dockerfile, /resolve-python-version/);
  assert.doesNotMatch(dockerfile, /cosign/);
  assert.doesNotMatch(dockerfile, /\/opt\/python/);
  assert.doesNotMatch(dockerfile, /python-version\.txt/);
});
```

- [ ] **Step 2: Delete the installer test**

Delete the test `'Python runtime installer script builds CPython into /opt/python for the final image handoff'` (lines 384-400) entirely.

- [ ] **Step 3: Update the smoke-mcp-runtime Python assertions test**

In the test `'smoke-mcp-runtime verifies the packaged Python runtime commands and resolved version marker'` (lines 321-343):

Remove these assertions:
```javascript
  assert.match(smokeScript, /test -f \/opt\/opencode\/python-version\.txt/);
  assert.match(smokeScript, /resolved_python_version="\$\(tr -d '\\n' <\/opt\/opencode\/python-version\.txt\)"/);
  assert.match(smokeScript, /sys\.version\.startswith\(resolved_version\)/);
```

Rename the test to `'smoke-mcp-runtime verifies the packaged Python runtime commands'` (drop "and resolved version marker").

Keep all remaining assertions in the test unchanged.

- [ ] **Step 4: Run tests to verify**

Run: `node --test tests/docker-contract.test.mjs`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/docker-contract.test.mjs
git commit -m "Update contract tests for Python COPY-from-official-image pattern

Assert new Dockerfile structure and smoke gate. Remove assertions for
deleted source-build scripts and python-version.txt marker."
```

---

### Task 5: Update tests/verify-runtime.test.mjs

**Files:**
- Modify: `tests/verify-runtime.test.mjs:110-174` (remove pythonVersion and version-file from fixture)

- [ ] **Step 1: Remove pythonVersion from makeRuntimeFixture**

In the `makeRuntimeFixture` function:

Remove `pythonVersion = '3.12.9'` from the destructured options (line 118).

Delete this line (line 174):
```javascript
  await writeFile(path.join(configDir, 'python-version.txt'), `${pythonVersion}\n`, 'utf8');
```

- [ ] **Step 2: Run tests to verify**

Run: `node --test tests/verify-runtime.test.mjs`

Expected: All tests PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/verify-runtime.test.mjs
git commit -m "Remove python-version.txt from verify-runtime test fixture

The version marker file no longer exists in the image."
```

---

### Task 6: Update scripts/smoke-mcp-runtime.sh

**Files:**
- Modify: `scripts/smoke-mcp-runtime.sh` (inside the `exec_checks` heredoc)

- [ ] **Step 1: Remove version-marker lines from exec_checks**

Inside the `exec_checks` function's heredoc (`docker exec -i "$container_name" bash -s <<'EOF'`), remove these lines:

```bash
test -f /opt/opencode/python-version.txt
resolved_python_version="$(tr -d '\n' </opt/opencode/python-version.txt)"
```

- [ ] **Step 2: Remove version assertion from Python heredoc blocks**

In the two Python heredoc blocks (`python3 - <<'PY'` and `python - <<'PY'`), remove the `resolved_version` argument and assertion. Change each block from:

```bash
python3 - <<'PY' "$resolved_python_version"
import sys

resolved_version = sys.argv[1]
assert sys.version.startswith(resolved_version), (resolved_version, sys.version)
assert sys.executable
PY
```

To:

```bash
python3 - <<'PY'
import sys

assert sys.executable
PY
```

Do the same for the `python - <<'PY'` block.

- [ ] **Step 3: Verify the script is syntactically valid**

Run: `bash -n scripts/smoke-mcp-runtime.sh`

Expected: Exit 0, no output.

- [ ] **Step 4: Run the contract test that asserts smoke script content**

Run: `node --test tests/docker-contract.test.mjs`

Expected: All tests PASS (including the updated smoke-mcp-runtime assertion test from Task 4).

- [ ] **Step 5: Commit**

```bash
git add scripts/smoke-mcp-runtime.sh
git commit -m "Remove python-version.txt assertions from smoke test

Version is controlled by Docker tag, not a marker file. Keep all other
Python runtime checks (version, pip, venv, sys.executable)."
```

---

### Task 7: Run full test suite and verify

- [ ] **Step 1: Run all tests**

Run: `node --test tests/*.test.mjs`

Expected: All tests PASS. No test file references deleted scripts or missing files.

- [ ] **Step 2: Verify no dangling references to deleted files**

Run: `grep -r 'resolve-python-version\|install-python-runtime\|verify-python-archive\|python-version\.txt' --include='*.mjs' --include='*.sh' --include='Dockerfile' .`

Expected: No matches (or only matches in `docs/` which are documentation, not code).

- [ ] **Step 3: Verify the Dockerfile builds successfully**

Run: `docker build -t opencode-harness:test .`

Expected: Build succeeds. The smoke gate layer prints:
```
node-core-ok
python-stdlib-ok
```

If `python3 -c "import ssl, sqlite3, ctypes, venv"` fails, add the missing library (likely `libexpat1`) to the `apt-get install` line, move `apt-get` before the `COPY --from=python-source`, and rebuild.
