# OpenCode Harness Server Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a root-level Dockerized OpenCode harness that bakes pinned upstream `opencode-oca-auth` and `superpowers` sources into the image and serves one shared runtime for coding and code review.

**Architecture:** Keep the project small and root-level. Use vendored upstream source snapshots under `vendor/`, a small patcher to make upstream code container-safe, and a thin shell entrypoint that runs preflight checks before `exec`ing `opencode web`. Test build-time scripts and preflight behavior with Node's built-in test runner before relying on Docker smoke checks, and make the image itself carry the full runtime env contract plus pinned `opencode-ai@1.2.27`.

**Tech Stack:** Node 22, Bash, Docker, OpenCode `1.2.27`, built-in Node test runner

---

## Chunk 1: Testable Build Inputs

### Task 1: Add local test harness and fixture-driven script tests

**Files:**
- Create: `package.json`
- Create: `tests/fixtures/upstream/opencode-oca-auth/src/oauth.ts`
- Create: `tests/fixtures/upstream/superpowers/.opencode/plugins/superpowers.js`
- Create: `tests/fixtures/upstream/superpowers/skills/using-superpowers/SKILL.md`
- Create: `tests/fixtures/upstream/superpowers/skills/brainstorming/SKILL.md`
- Create: `tests/patch-upstream-sources.test.mjs`
- Create: `tests/install-superpowers.test.mjs`
- Create: `tests/verify-runtime.test.mjs`
- Create: `tests/docker-contract.test.mjs`

- [ ] **Step 1: Write the failing tests**

```js
import test from 'node:test'
import assert from 'node:assert/strict'

test('patcher updates upstream plugin bind host and skills path', async () => {
  assert.equal(true, false)
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL because the scripts and fixtures do not exist yet

- [ ] **Step 3: Add the minimal test harness files**

```json
{
  "name": "opencode-harness",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs"
  }
}
```

- [ ] **Step 4: Run tests again**

Run: `npm test`
Expected: FAIL with meaningful missing-script or missing-file assertions

## Chunk 2: Build-Time Scripts And Config

### Task 2: Implement config, patching, install, and preflight scripts

**Files:**
- Create: `config/opencode.json`
- Create: `scripts/patch-upstream-sources.mjs`
- Create: `scripts/install-superpowers.sh`
- Create: `scripts/verify-runtime.sh`
- Create: `scripts/opencode-harness-entrypoint`
- Modify: `tests/patch-upstream-sources.test.mjs`
- Modify: `tests/install-superpowers.test.mjs`
- Modify: `tests/verify-runtime.test.mjs`
- Modify: `tests/docker-contract.test.mjs`

- [ ] **Step 1: Write one failing test per script behavior**

```js
test('verify-runtime preflight fails when workspace is missing', async () => {
  // spawn the script with a temp config tree and assert non-zero exit code
})

test('verify-runtime preflight fails when workspace is read-only', async () => {
  // create a temp workspace without write permission and assert non-zero exit code
})

test('verify-runtime preflight fails when a required port is unavailable', async () => {
  // bind a temporary local server before invoking preflight and assert non-zero exit code
})

test('verify-runtime preflight fails when bundled plugin assets are missing', async () => {
  // omit the expected plugin or skills files and assert non-zero exit code
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `node --test tests/patch-upstream-sources.test.mjs tests/install-superpowers.test.mjs tests/verify-runtime.test.mjs`
Expected: FAIL because the scripts are not implemented yet

- [ ] **Step 3: Write the minimal implementation**

```json
{
  "model": "oca/gpt-5.4",
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0"
  },
  "plugin": [
    "file:///opt/opencode/plugins/opencode-oca-auth",
    "file:///opt/opencode/plugins/superpowers.js"
  ],
  "provider": {
    "oca": {
      "models": {
        "gpt-5.4": {}
      }
    }
  }
}
```

```bash
#!/usr/bin/env bash
export OPENCODE_CONFIG=/opt/opencode/opencode.json
export OPENCODE_CONFIG_DIR=/opt/opencode
export OPENCODE_SERVER_PORT=4096
export OPENCODE_SERVER_HOST=0.0.0.0
export OCA_OAUTH_BIND_HOST=0.0.0.0
export OCA_OAUTH_CALLBACK_PORT=48801
export SUPERPOWERS_SKILLS_DIR=/opt/opencode/skills
export WORKSPACE_DIR=/workspace
export BROWSER=/bin/true
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `node --test tests/patch-upstream-sources.test.mjs tests/install-superpowers.test.mjs tests/verify-runtime.test.mjs`
Expected: PASS

## Chunk 3: Vendored Upstream Sources And Docker Wiring

### Task 3: Vendor pinned upstream trees and wire the Docker image

**Files:**
- Create: `vendor/sources.lock.json`
- Create: `vendor/opencode-oca-auth/`
- Create: `vendor/superpowers/`
- Create: `Dockerfile`
- Create: `README.md`

- [ ] **Step 1: Write failing tests for vendored metadata and Docker inputs**

```js
test('sources.lock.json records both upstream repos and pinned revisions', async () => {
  // assert both repo URLs and non-empty pinned revision fields
})

test('Dockerfile installs opencode-ai 1.2.27 and declares the required env contract', async () => {
  // assert the Dockerfile contains npm install -g opencode-ai@1.2.27 and each required ENV key
})

test('Dockerfile exposes both required ports and sets the harness entrypoint', async () => {
  // assert EXPOSE 4096 48801 and the /usr/local/bin/opencode-harness-entrypoint entrypoint
})
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `npm test`
Expected: FAIL because vendored metadata and Docker inputs are incomplete

- [ ] **Step 3: Write the minimal implementation**

```dockerfile
FROM node:22-slim
ENV OPENCODE_CONFIG=/opt/opencode/opencode.json
ENV OPENCODE_CONFIG_DIR=/opt/opencode
ENV OPENCODE_SERVER_PORT=4096
ENV OPENCODE_SERVER_HOST=0.0.0.0
ENV OCA_OAUTH_BIND_HOST=0.0.0.0
ENV OCA_OAUTH_CALLBACK_PORT=48801
ENV SUPERPOWERS_SKILLS_DIR=/opt/opencode/skills
ENV WORKSPACE_DIR=/workspace
ENV BROWSER=/bin/true
RUN npm install -g opencode-ai@1.2.27
EXPOSE 4096 48801
ENTRYPOINT ["/usr/local/bin/opencode-harness-entrypoint"]
```

- [ ] **Step 4: Run tests and Docker smoke checks**

Run: `npm test && docker build -f Dockerfile -t opencode-harness .`
Expected: tests PASS and Docker build exits 0

## Chunk 4: End-To-End Verification

### Task 4: Verify the packaged operator flow

**Files:**
- Modify: `README.md`
- Modify: `tests/docker-contract.test.mjs`

- [ ] **Step 1: Start the built image with a writable temp workspace**

Run: `docker run --rm -d --name opencode-harness-smoke -p 127.0.0.1:4096:4096 -p 127.0.0.1:48801:48801 -v "$(pwd):/workspace" opencode-harness`
Expected: container starts successfully

- [ ] **Step 2: Verify runtime health and config**

Run: `curl http://127.0.0.1:4096/global/health && docker exec opencode-harness-smoke opencode debug config && docker exec opencode-harness-smoke opencode models oca`
Expected: health endpoint responds, config shows the baked plugin paths, and OCA models are visible

- [ ] **Step 3: Verify operator access flow is documented and runnable**

Run: `docker exec -it opencode-harness-smoke opencode auth login`
Expected: login flow starts, shows the `oca` provider, and documents the public redirect target `http://127.0.0.1:48801/auth/oca`

- [ ] **Step 4: Verify TUI attach, Web UI access, and default model smoke command are documented**

Run: `opencode attach http://127.0.0.1:4096 && opencode -m oca/gpt-5.4 run "what skills do you have? what mcp do you have"`
Expected: the README and PDD document the TUI attach command, the Web UI URL `http://127.0.0.1:4096`, and the smoke command should reply that Superpowers skills are available and no MCP servers are configured yet

- [ ] **Step 5: Stop the smoke container**

Run: `docker stop opencode-harness-smoke`
Expected: container exits cleanly
