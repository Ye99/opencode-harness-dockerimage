# MCP Server Discovery And Brave Env Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `context7`, `grep_app`, and env-gated `brave-search` MCP support to the Dockerized OpenCode harness, while keeping the Brave API key out of tracked files and proving discovery through runtime and smoke checks.

**Architecture:** Keep `config/opencode.json` as the checked-in base template, copy it into the image as `/opt/opencode/opencode.base.json`, and render `/opt/opencode/opencode.json` at container startup with `scripts/render-opencode-config.mjs`. Extend preflight to use the rendered config as the source of truth for Brave enablement, install `@modelcontextprotocol/server-brave-search@latest` into the image, and add a host-side smoke script that verifies keyed/no-key and online/offline discovery behavior.

**Tech Stack:** Node 22, Bash, Docker, OpenCode `1.2.27`, npm global installs, built-in Node test runner

---

## File Structure

- `config/opencode.json` — checked-in base OpenCode config with plugin wiring, remote MCP entries, and a disabled `brave-search` template entry that contains no secret.
- `scripts/render-opencode-config.mjs` — startup-only renderer that reads the base config, toggles `brave-search.enabled`, injects `environment.BRAVE_API_KEY` only when the env var is non-empty, and writes `/opt/opencode/opencode.json`.
- `scripts/opencode-harness-entrypoint` — runs the render helper before `scripts/verify-runtime.sh` and `opencode web`.
- `scripts/verify-runtime.sh` — validates packaged assets, Brave binary presence, rendered config state, and `opencode mcp list` discovery behavior.
- `scripts/smoke-mcp-runtime.sh` — host-side automated smoke runner for keyed/no-key and online/no-egress Docker scenarios.
- `Dockerfile` — copies the base config to `/opt/opencode/opencode.base.json`, installs `@modelcontextprotocol/server-brave-search@latest`, writes MCP version metadata, and packages the new render helper.
- `README.md` — documents `BRAVE_API_KEY` setup, `docker run -e BRAVE_API_KEY`, `opencode mcp list`, and the disabled-without-key behavior.
- `tests/render-opencode-config.test.mjs` — unit tests for keyed/no-key render behavior and preservation of `context7` / `grep_app`.
- `tests/verify-runtime.test.mjs` — fixture-driven preflight tests for MCP discovery success/failure states.
- `tests/docker-contract.test.mjs` — contract tests for config shape, Dockerfile wiring, entrypoint ordering, README guidance, and smoke script coverage.
- `~/.zshrc` — host shell export for `BRAVE_API_KEY` after repo changes are finished.

## Chunk 1: Base Config And Render Helper

### Task 1: Add MCP entries to the base config and render the runtime config from env

**Files:**
- Modify: `config/opencode.json`
- Create: `scripts/render-opencode-config.mjs`
- Create: `tests/render-opencode-config.test.mjs`
- Modify: `tests/docker-contract.test.mjs`

- [ ] **Step 1: Write the failing render-helper tests**

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

test('config/opencode.json defines the MCP base template without a Brave secret', async () => {
  const config = JSON.parse(await readFile(new URL('../config/opencode.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.mcp.context7, {
    type: 'remote',
    url: 'https://mcp.context7.com/mcp',
    enabled: true,
  });
  assert.deepEqual(config.mcp.grep_app, {
    type: 'remote',
    url: 'https://mcp.grep.app',
    enabled: true,
  });
  assert.deepEqual(config.mcp['brave-search'], {
    type: 'local',
    command: ['mcp-server-brave-search'],
    enabled: false,
  });
  assert.equal(config.mcp['brave-search'].environment, undefined);
});

// Add this assertion block to tests/docker-contract.test.mjs as part of the same step.
test('config/opencode.json wires the MCP base template', async () => {
  const configText = await readFile(new URL('../config/opencode.json', import.meta.url), 'utf8');
  const config = JSON.parse(configText);
  assert.deepEqual(config.mcp.context7, {
    type: 'remote',
    url: 'https://mcp.context7.com/mcp',
    enabled: true,
  });
  assert.deepEqual(config.mcp.grep_app, {
    type: 'remote',
    url: 'https://mcp.grep.app',
    enabled: true,
  });
  assert.deepEqual(config.mcp['brave-search'], {
    type: 'local',
    command: ['mcp-server-brave-search'],
    enabled: false,
  });
});

function runNode(script, args, env) {
  return new Promise((resolve) => {
    const child = spawn('node', [script, ...args], { env: { ...process.env, ...env } });
    let stderr = '';
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stderr }));
  });
}

test('render-opencode-config keeps remote MCPs and leaves brave disabled without key', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'render-opencode-'));
  const basePath = path.join(root, 'opencode.base.json');
  const outputPath = path.join(root, 'opencode.json');

  await writeFile(basePath, JSON.stringify({
    model: 'oca/gpt-5.4',
    plugin: ['file:///opt/opencode/plugins/opencode-oca-auth', 'file:///opt/opencode/plugins/superpowers.js'],
    provider: { oca: { models: { 'gpt-5.4': {} } } },
    server: { port: 4096, hostname: '0.0.0.0' },
    mcp: {
      context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true },
      grep_app: { type: 'remote', url: 'https://mcp.grep.app', enabled: true },
      'brave-search': { type: 'local', command: ['mcp-server-brave-search'], enabled: false },
    },
  }, null, 2));

  const result = await runNode('scripts/render-opencode-config.mjs', [basePath, outputPath], { BRAVE_API_KEY: '' });
  assert.equal(result.code, 0, result.stderr);

  const rendered = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(rendered.model, 'oca/gpt-5.4');
  assert.deepEqual(rendered.plugin, ['file:///opt/opencode/plugins/opencode-oca-auth', 'file:///opt/opencode/plugins/superpowers.js']);
  assert.deepEqual(rendered.provider, { oca: { models: { 'gpt-5.4': {} } } });
  assert.deepEqual(rendered.server, { port: 4096, hostname: '0.0.0.0' });
  assert.deepEqual(rendered.mcp.context7, { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true });
  assert.deepEqual(rendered.mcp.grep_app, { type: 'remote', url: 'https://mcp.grep.app', enabled: true });
  assert.deepEqual(rendered.mcp['brave-search'], { type: 'local', command: ['mcp-server-brave-search'], enabled: false });
  assert.equal(rendered.mcp['brave-search'].environment, undefined);
});

test('render-opencode-config leaves brave disabled when BRAVE_API_KEY is absent', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'render-opencode-'));
  const basePath = path.join(root, 'opencode.base.json');
  const outputPath = path.join(root, 'opencode.json');

  await writeFile(basePath, JSON.stringify({
    model: 'oca/gpt-5.4',
    plugin: ['file:///opt/opencode/plugins/opencode-oca-auth', 'file:///opt/opencode/plugins/superpowers.js'],
    provider: { oca: { models: { 'gpt-5.4': {} } } },
    server: { port: 4096, hostname: '0.0.0.0' },
    mcp: {
      context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true },
      grep_app: { type: 'remote', url: 'https://mcp.grep.app', enabled: true },
      'brave-search': { type: 'local', command: ['mcp-server-brave-search'], enabled: false },
    },
  }, null, 2));

  const result = await runNode('scripts/render-opencode-config.mjs', [basePath, outputPath], {});
  assert.equal(result.code, 0, result.stderr);

  const rendered = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(rendered.model, 'oca/gpt-5.4');
  assert.deepEqual(rendered.plugin, ['file:///opt/opencode/plugins/opencode-oca-auth', 'file:///opt/opencode/plugins/superpowers.js']);
  assert.deepEqual(rendered.mcp['brave-search'], { type: 'local', command: ['mcp-server-brave-search'], enabled: false });
  assert.equal(rendered.mcp['brave-search'].environment, undefined);
});

test('render-opencode-config enables brave and injects BRAVE_API_KEY only when key is non-empty', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'render-opencode-'));
  const basePath = path.join(root, 'opencode.base.json');
  const outputPath = path.join(root, 'opencode.json');

  await writeFile(basePath, JSON.stringify({
    model: 'oca/gpt-5.4',
    plugin: ['file:///opt/opencode/plugins/opencode-oca-auth', 'file:///opt/opencode/plugins/superpowers.js'],
    provider: { oca: { models: { 'gpt-5.4': {} } } },
    server: { port: 4096, hostname: '0.0.0.0' },
    mcp: {
      context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true },
      grep_app: { type: 'remote', url: 'https://mcp.grep.app', enabled: true },
      'brave-search': { type: 'local', command: ['mcp-server-brave-search'], enabled: false },
    },
  }, null, 2));

  const result = await runNode('scripts/render-opencode-config.mjs', [basePath, outputPath], { BRAVE_API_KEY: 'brave-test-key' });
  assert.equal(result.code, 0, result.stderr);

  const rendered = JSON.parse(await readFile(outputPath, 'utf8'));
  assert.equal(rendered.model, 'oca/gpt-5.4');
  assert.deepEqual(rendered.plugin, ['file:///opt/opencode/plugins/opencode-oca-auth', 'file:///opt/opencode/plugins/superpowers.js']);
  assert.deepEqual(rendered.provider, { oca: { models: { 'gpt-5.4': {} } } });
  assert.deepEqual(rendered.server, { port: 4096, hostname: '0.0.0.0' });
  assert.deepEqual(rendered.mcp.context7, { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true });
  assert.deepEqual(rendered.mcp.grep_app, { type: 'remote', url: 'https://mcp.grep.app', enabled: true });
  assert.deepEqual(rendered.mcp['brave-search'], {
    type: 'local',
    command: ['mcp-server-brave-search'],
    enabled: true,
    environment: { BRAVE_API_KEY: 'brave-test-key' },
  });
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `node --test tests/render-opencode-config.test.mjs tests/docker-contract.test.mjs`
Expected: FAIL because `scripts/render-opencode-config.mjs` does not exist yet and the new `tests/docker-contract.test.mjs` assertion does not yet find the checked-in MCP template in `config/opencode.json`

- [ ] **Step 3: Write the minimal base config and render helper**

```json
{
  "$schema": "https://opencode.ai/config.json",
  "model": "oca/gpt-5.4",
  "server": {
    "port": 4096,
    "hostname": "0.0.0.0"
  },
  "plugin": [
    "file:///opt/opencode/plugins/opencode-oca-auth",
    "file:///opt/opencode/plugins/superpowers.js"
  ],
  "mcp": {
    "context7": {
      "type": "remote",
      "url": "https://mcp.context7.com/mcp",
      "enabled": true
    },
    "grep_app": {
      "type": "remote",
      "url": "https://mcp.grep.app",
      "enabled": true
    },
    "brave-search": {
      "type": "local",
      "command": ["mcp-server-brave-search"],
      "enabled": false
    }
  },
  "provider": {
    "oca": {
      "models": {
        "gpt-5.4": {}
      }
    }
  }
}
```

```js
import { readFile, writeFile } from 'node:fs/promises';

const [basePath, outputPath] = process.argv.slice(2);
if (!basePath || !outputPath) {
  throw new Error('usage: node render-opencode-config.mjs <base> <output>');
}

const base = JSON.parse(await readFile(basePath, 'utf8'));
const braveKey = process.env.BRAVE_API_KEY?.trim() ?? '';
const rendered = structuredClone(base);
const brave = rendered.mcp['brave-search'];

if (braveKey) {
  brave.enabled = true;
  brave.environment = { BRAVE_API_KEY: braveKey };
} else {
  brave.enabled = false;
  delete brave.environment;
}

await writeFile(outputPath, `${JSON.stringify(rendered, null, 2)}\n`);
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `node --test tests/render-opencode-config.test.mjs tests/docker-contract.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add config/opencode.json scripts/render-opencode-config.mjs tests/render-opencode-config.test.mjs tests/docker-contract.test.mjs
git commit -m "feat: render brave MCP config from env"
```

## Chunk 2: Docker Wiring, Entrypoint Ordering, And Preflight Checks

### Task 2: Wire the render helper and Brave package into the image

**Files:**
- Modify: `Dockerfile`
- Modify: `scripts/opencode-harness-entrypoint`
- Modify: `tests/docker-contract.test.mjs`

- [ ] **Step 1: Add failing contract tests for Docker and entrypoint wiring**

```js
test('Dockerfile copies the immutable base config, packages the render helper, and installs brave-search latest', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /COPY config\/opencode\.json \/opt\/opencode\/opencode\.base\.json/);
  assert.match(dockerfile, /COPY scripts\/render-opencode-config\.mjs \/opt\/opencode\/scripts\/render-opencode-config\.mjs/);
  assert.match(dockerfile, /npm install -g opencode-ai@1\.2\.27 @modelcontextprotocol\/server-brave-search@latest/);
  assert.match(dockerfile, /mcp-versions\.json/);
  assert.match(dockerfile, /npm ls -g @modelcontextprotocol\/server-brave-search --json --depth=0 > \/opt\/opencode\/mcp-versions\.json/);
});

test('entrypoint renders config before verify-runtime', async () => {
  const entrypoint = await readFile(new URL('../scripts/opencode-harness-entrypoint', import.meta.url), 'utf8');
  assert.match(entrypoint, /render-opencode-config\.mjs/);
  assert.match(entrypoint, /\/opt\/opencode\/opencode\.base\.json/);
  assert.match(entrypoint, /\$OPENCODE_CONFIG/);
  assert.match(entrypoint, /render-opencode-config\.mjs[\s\S]*verify-runtime\.sh/);
  assert.match(entrypoint, /verify-runtime\.sh[\s\S]*opencode web/);
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `node --test tests/docker-contract.test.mjs`
Expected: FAIL because the Dockerfile and entrypoint do not yet package or invoke the render helper / Brave MCP install

- [ ] **Step 3: Write the minimal Docker and entrypoint changes**

```dockerfile
RUN apt-get update \
  && apt-get install -y --no-install-recommends bash ca-certificates curl git \
  && rm -rf /var/lib/apt/lists/* \
  && mkdir -p /opt/opencode/scripts \
  && npm install -g opencode-ai@1.2.27 @modelcontextprotocol/server-brave-search@latest \
  && npm ls -g @modelcontextprotocol/server-brave-search --json --depth=0 > /opt/opencode/mcp-versions.json

COPY config/opencode.json /opt/opencode/opencode.base.json
COPY scripts/render-opencode-config.mjs /opt/opencode/scripts/render-opencode-config.mjs
```

```bash
node "/opt/opencode/scripts/render-opencode-config.mjs" \
  "/opt/opencode/opencode.base.json" \
  "$OPENCODE_CONFIG"
bash "/opt/opencode/scripts/verify-runtime.sh" preflight
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `node --test tests/docker-contract.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add Dockerfile scripts/opencode-harness-entrypoint tests/docker-contract.test.mjs
git commit -m "build: package brave MCP runtime assets"
```

### Task 3: Extend preflight to validate MCP discovery from the rendered config

**Files:**
- Modify: `scripts/verify-runtime.sh`
- Modify: `tests/verify-runtime.test.mjs`
- Modify: `tests/docker-contract.test.mjs`

- [ ] **Step 1: Add failing preflight tests for MCP discovery behavior**

```js
// Extend the existing helpers in tests/verify-runtime.test.mjs first.
async function makeRuntimeFixture({ config, mcpListOutput = 'context7\ngrep_app\n', mcpListFails = false, extraEnv = {}, omitBraveBinary = false, omitBraveMetadata = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'verify-runtime-'));
  const workspace = path.join(root, 'workspace');
  const configDir = path.join(root, 'opt/opencode');
  const pluginDir = path.join(configDir, 'plugins/opencode-oca-auth');
  const skillsRoot = path.join(configDir, 'skills');
  const skillsDir = path.join(skillsRoot, 'superpowers');
  const binDir = path.join(root, 'bin');

  await mkdir(workspace, { recursive: true });
  await mkdir(pluginDir, { recursive: true });
  await mkdir(path.join(configDir, 'plugins'), { recursive: true });
  await mkdir(path.join(skillsDir, 'using-superpowers'), { recursive: true });
  await mkdir(path.join(skillsDir, 'brainstorming'), { recursive: true });
  await mkdir(binDir, { recursive: true });

  await writeFile(path.join(configDir, 'opencode.json'), `${JSON.stringify(config ?? {
    mcp: {
      context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true },
      grep_app: { type: 'remote', url: 'https://mcp.grep.app', enabled: true },
      'brave-search': { type: 'local', command: ['mcp-server-brave-search'], enabled: false },
    },
  }, null, 2)}\n`);

  if (!omitBraveMetadata) {
    await writeFile(path.join(configDir, 'mcp-versions.json'), JSON.stringify({
      dependencies: {
        '@modelcontextprotocol/server-brave-search': { version: 'latest' },
      },
    }, null, 2) + '\n');
  }

  await writeFile(path.join(configDir, 'plugins/superpowers.js'), 'export default {}\n');
  await writeFile(path.join(skillsDir, 'using-superpowers/SKILL.md'), '# using-superpowers\n');
  await writeFile(path.join(skillsDir, 'brainstorming/SKILL.md'), '# brainstorming\n');
  await writeFile(path.join(binDir, 'opencode'), `#!/usr/bin/env bash
if [[ "$1 $2" == "debug config" ]]; then
  cat <<EOF
{
  "plugin": [
    "file:///opt/opencode/plugins/opencode-oca-auth",
    "file:///opt/opencode/plugins/superpowers.js"
  ],
  "skills": {
    "paths": [
      "$SUPERPOWERS_SKILLS_DIR/superpowers"
    ]
  }
}
EOF
  exit 0
fi
if [[ "$1 $2" == "models oca" ]]; then
  printf 'oca/gpt-5.4\n'
  exit 0
fi
if [[ "$1 $2" == "mcp list" ]]; then
  if [[ "${OPENCODE_MCP_LIST_FAIL:-0}" == "1" ]]; then
    exit 1
  fi
  printf '%s\n' "$OPENCODE_MCP_LIST_OUTPUT"
  exit 0
fi
exit 0
`, 'utf8');
  await chmod(path.join(binDir, 'opencode'), 0o755);

  if (!omitBraveBinary) {
    await writeFile(path.join(binDir, 'mcp-server-brave-search'), '#!/usr/bin/env bash\nexec sleep 3600\n', 'utf8');
    await chmod(path.join(binDir, 'mcp-server-brave-search'), 0o755);
  }

  return { root, workspace, configDir, skillsRoot, binDir, mcpListOutput, mcpListFails, extraEnv };
}

async function runPreflight(fixture) {
  return run('bash', ['scripts/verify-runtime.sh', 'preflight'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      ...fixture.extraEnv,
      WORKSPACE_DIR: fixture.workspace,
      OPENCODE_CONFIG: path.join(fixture.configDir, 'opencode.json'),
      OPENCODE_CONFIG_DIR: fixture.configDir,
      SUPERPOWERS_SKILLS_DIR: fixture.skillsRoot,
      OPENCODE_MCP_LIST_OUTPUT: fixture.mcpListOutput,
      OPENCODE_MCP_LIST_FAIL: fixture.mcpListFails ? '1' : '0',
      PATH: `${fixture.binDir}:${process.env.PATH}`,
    },
  });
}

test('verify-runtime preflight succeeds with keyed brave MCP discovery', async () => {
  const fixture = await makeRuntimeFixture({
    config: {
      mcp: {
        context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true },
        grep_app: { type: 'remote', url: 'https://mcp.grep.app', enabled: true },
        'brave-search': { type: 'local', command: ['mcp-server-brave-search'], enabled: true, environment: { BRAVE_API_KEY: 'brave-test-key' } },
      },
    },
    mcpListOutput: 'context7\ngrep_app\nbrave-search\n',
  });
  assert.equal((await runPreflight(fixture)).code, 0);
});

test('verify-runtime preflight succeeds in no-key mode when brave is disabled in rendered config', async () => {
  const fixture = await makeRuntimeFixture({
    config: {
      mcp: {
        context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true },
        grep_app: { type: 'remote', url: 'https://mcp.grep.app', enabled: true },
        'brave-search': { type: 'local', command: ['mcp-server-brave-search'], enabled: false },
      },
    },
    mcpListOutput: 'context7\ngrep_app\n',
  });
  assert.equal((await runPreflight(fixture)).code, 0);
});

test('verify-runtime preflight tolerates status text in mcp list output', async () => {
  const fixture = await makeRuntimeFixture({
    config: {
      mcp: {
        context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true },
        grep_app: { type: 'remote', url: 'https://mcp.grep.app', enabled: true },
        'brave-search': { type: 'local', command: ['mcp-server-brave-search'], enabled: false },
      },
    },
    mcpListOutput: 'context7 remote disconnected\ngrep_app remote connected\n',
  });
  assert.equal((await runPreflight(fixture)).code, 0);
});

test('verify-runtime preflight still succeeds when brave is disabled but opencode still lists it', async () => {
  const fixture = await makeRuntimeFixture({
    config: {
      mcp: {
        context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true },
        grep_app: { type: 'remote', url: 'https://mcp.grep.app', enabled: true },
        'brave-search': { type: 'local', command: ['mcp-server-brave-search'], enabled: false },
      },
    },
    mcpListOutput: 'context7\ngrep_app\nbrave-search (disabled)\n',
  });
  assert.equal((await runPreflight(fixture)).code, 0);
});

test('verify-runtime preflight fails when the brave MCP binary is missing from PATH', async () => {
  const fixture = await makeRuntimeFixture({ omitBraveBinary: true });
  const result = await runPreflight(fixture);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Brave MCP binary not found/);
});

test('verify-runtime preflight fails when Brave metadata is missing', async () => {
  const fixture = await makeRuntimeFixture({ omitBraveMetadata: true });
  const result = await runPreflight(fixture);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Missing Brave MCP version metadata/);
});

test('verify-runtime preflight fails when opencode mcp list fails', async () => {
  const fixture = await makeRuntimeFixture({ mcpListFails: true });
  const result = await runPreflight(fixture);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /does not list MCP servers/);
});

test('verify-runtime preflight fails when context7 is missing from mcp list', async () => {
  const fixture = await makeRuntimeFixture({
    config: {
      mcp: {
        context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true },
        grep_app: { type: 'remote', url: 'https://mcp.grep.app', enabled: true },
        'brave-search': { type: 'local', command: ['mcp-server-brave-search'], enabled: false },
      },
    },
    mcpListOutput: 'grep_app\n',
  });
  const result = await runPreflight(fixture);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /does not discover context7/);
});

test('verify-runtime preflight fails when grep_app is missing from mcp list', async () => {
  const fixture = await makeRuntimeFixture({
    config: {
      mcp: {
        context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true },
        grep_app: { type: 'remote', url: 'https://mcp.grep.app', enabled: true },
        'brave-search': { type: 'local', command: ['mcp-server-brave-search'], enabled: false },
      },
    },
    mcpListOutput: 'context7\n',
  });
  const result = await runPreflight(fixture);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /does not discover grep_app/);
});

test('verify-runtime preflight rejects near-matches instead of loose substring matches', async () => {
  const fixture = await makeRuntimeFixture({
    config: {
      mcp: {
        context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true },
        grep_app: { type: 'remote', url: 'https://mcp.grep.app', enabled: true },
        'brave-search': { type: 'local', command: ['mcp-server-brave-search'], enabled: true, environment: { BRAVE_API_KEY: 'brave-test-key' } },
      },
    },
    mcpListOutput: 'context70\ngrep_application\nxbrave-searchx\n',
  });
  const result = await runPreflight(fixture);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /does not discover context7|does not discover grep_app|does not discover brave-search/);
});

test('verify-runtime preflight uses rendered brave-search.enabled instead of raw env presence', async () => {
  const fixture = await makeRuntimeFixture({
    config: {
      mcp: {
        context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true },
        grep_app: { type: 'remote', url: 'https://mcp.grep.app', enabled: true },
        'brave-search': { type: 'local', command: ['mcp-server-brave-search'], enabled: false },
      },
    },
    mcpListOutput: 'context7\ngrep_app\n',
    extraEnv: { BRAVE_API_KEY: 'still-ignore-me' },
  });
  assert.equal((await runPreflight(fixture)).code, 0);
});

test('verify-runtime preflight fails when brave is enabled in rendered config but not discovered', async () => {
  const fixture = await makeRuntimeFixture({
    config: {
      mcp: {
        context7: { type: 'remote', url: 'https://mcp.context7.com/mcp', enabled: true },
        grep_app: { type: 'remote', url: 'https://mcp.grep.app', enabled: true },
        'brave-search': { type: 'local', command: ['mcp-server-brave-search'], enabled: true, environment: { BRAVE_API_KEY: 'brave-test-key' } },
      },
    },
    mcpListOutput: 'context7\ngrep_app\n',
  });
  const result = await runPreflight(fixture);
  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /does not discover brave-search/);
});
```

Add these failing assertions to `tests/docker-contract.test.mjs` in the same step so the metadata contract is also test-driven:

```js
test('Dockerfile records Brave MCP version metadata from the installed package tree', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /tree\.dependencies\["@modelcontextprotocol\/server-brave-search"\]\.version/);
  assert.match(dockerfile, /fs\.writeFileSync\("\/opt\/opencode\/mcp-versions\.json"/);
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `node --test tests/verify-runtime.test.mjs tests/docker-contract.test.mjs`
Expected: FAIL because `scripts/verify-runtime.sh` does not yet validate the Brave binary, metadata file, exact MCP discovery entries, or rendered Brave enablement

- [ ] **Step 3: Write the minimal preflight implementation and fixture updates**

```bash
check_brave_binary() {
  command -v mcp-server-brave-search >/dev/null 2>&1 || fail 'Brave MCP binary not found in PATH'
}

read_brave_enabled() {
  node -e 'const fs=require("node:fs"); const cfg=JSON.parse(fs.readFileSync(process.argv[1], "utf8")); process.stdout.write(String(Boolean(cfg.mcp?.["brave-search"]?.enabled)));' "$OPENCODE_CONFIG"
}

has_mcp_entry() {
  node -e 'const [output, expected] = process.argv.slice(1); const found = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).some((line) => line === expected || line.startsWith(`${expected} `) || line.startsWith(`${expected}\t`) || line.startsWith(`${expected} (`)); process.exit(found ? 0 : 1);' "$1" "$2"
}

check_mcp_discovery() {
  local output brave_enabled
  output="$(opencode mcp list 2>/dev/null)" || fail 'OpenCode does not list MCP servers from the baked config'
  has_mcp_entry "$output" context7 || fail 'OpenCode does not discover context7 from the baked config'
  has_mcp_entry "$output" grep_app || fail 'OpenCode does not discover grep_app from the baked config'
  brave_enabled="$(read_brave_enabled)"
  if [[ "$brave_enabled" == "true" ]]; then
    has_mcp_entry "$output" brave-search || fail 'OpenCode does not discover brave-search when the rendered config enables it'
  fi
}

check_brave_metadata() {
  node -e 'const fs=require("node:fs"); const [filePath, packageName]=process.argv.slice(1); const metadata=JSON.parse(fs.readFileSync(filePath, "utf8")); const version=metadata?.dependencies?.[packageName]?.version; process.exit(typeof version === "string" && version.length > 0 ? 0 : 1);' "$MCP_VERSIONS_FILE" "$BRAVE_MCP_PACKAGE" \
    || fail 'Missing Brave MCP version metadata'
}
```

```bash
if [[ "$1 $2" == "mcp list" ]]; then
  if [[ "${OPENCODE_MCP_LIST_FAIL:-0}" == "1" ]]; then
    exit 1
  fi
  printf '%s\n' "$OPENCODE_MCP_LIST_OUTPUT"
  exit 0
fi
```

```bash
preflight)
  check_workspace
  check_assets
  check_brave_binary
  check_brave_metadata
  check_port_available "$OPENCODE_SERVER_HOST" "$OPENCODE_SERVER_PORT"
  check_port_available '0.0.0.0' "$OCA_OAUTH_CALLBACK_PORT"
  check_config_visibility
  check_oca_models
  check_mcp_discovery
  printf 'preflight-ok\n'
  ;;
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `node --test tests/verify-runtime.test.mjs tests/docker-contract.test.mjs`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add scripts/verify-runtime.sh tests/verify-runtime.test.mjs
git add tests/docker-contract.test.mjs
git commit -m "test: verify MCP discovery during preflight"
```

## Chunk 3: Smoke Automation, README, And Host Env Setup

### Task 4: Add an automated Docker smoke script for keyed/no-key and online/offline states

**Files:**
- Create: `scripts/smoke-mcp-runtime.sh`
- Modify: `tests/docker-contract.test.mjs`

- [ ] **Step 1: Add failing contract tests for the smoke script coverage**

```js
test('smoke-mcp-runtime script covers keyed, no-key, and no-egress states', async () => {
  const smoke = await readFile(new URL('../scripts/smoke-mcp-runtime.sh', import.meta.url), 'utf8');
  assert.match(smoke, /BRAVE_API_KEY=dummy-brave-key/);
  assert.match(smoke, /--network none/);
  assert.match(smoke, /command -v mcp-server-brave-search/);
  assert.match(smoke, /npm ls -g @modelcontextprotocol\/server-brave-search --depth=0/);
  assert.match(smoke, /mcp-versions\.json/);
  assert.match(smoke, /timeout 3 mcp-server-brave-search/);
  assert.match(smoke, /opencode mcp list/);
  assert.match(smoke, /enabled.*hasKey|hasKey.*enabled/);
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `node --test tests/docker-contract.test.mjs`
Expected: FAIL because the smoke script does not exist yet

- [ ] **Step 3: Write the minimal smoke script**

```bash
#!/usr/bin/env bash
set -euo pipefail

IMAGE_NAME="${1:-opencode-harness}"
DUMMY_BRAVE_API_KEY="dummy-brave-key"

cleanup() {
  docker rm -f \
    opencode-harness-mcp-keyed \
    opencode-harness-mcp-nokey \
    opencode-harness-mcp-offline \
    opencode-harness-mcp-offline-keyed >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker build --pull --no-cache -t "$IMAGE_NAME" .

assert_rendered_brave_state() {
  local name="$1"
  local expected_enabled="$2"
  local expected_has_key="$3"
  docker exec "$name" node -e 'const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync("/opt/opencode/opencode.json","utf8")); const brave=c.mcp["brave-search"]; const actual={enabled:Boolean(brave.enabled), hasKey:Boolean(brave.environment && brave.environment.BRAVE_API_KEY)}; const expected={enabled:process.argv[1]==="true", hasKey:process.argv[2]==="true"}; if (JSON.stringify(actual)!==JSON.stringify(expected)) { console.error(JSON.stringify({actual, expected})); process.exit(1); }' "$expected_enabled" "$expected_has_key"
}

assert_common_runtime() {
  local name="$1"
  docker exec "$name" sh -lc 'command -v mcp-server-brave-search'
  docker exec "$name" npm ls -g @modelcontextprotocol/server-brave-search --depth=0
  docker exec "$name" cat /opt/opencode/mcp-versions.json
  docker exec "$name" node -e 'const fs=require("node:fs"); const {execSync}=require("node:child_process"); const meta=JSON.parse(fs.readFileSync("/opt/opencode/mcp-versions.json", "utf8")); const packageRoot=execSync("npm root -g", {encoding:"utf8"}).trim(); const installed=JSON.parse(fs.readFileSync(`${packageRoot}/@modelcontextprotocol/server-brave-search/package.json`, "utf8")); const metaVersion=meta?.dependencies?.["@modelcontextprotocol/server-brave-search"]?.version; if (!metaVersion || metaVersion !== installed.version) process.exit(1);'
}

read_rendered_brave_enabled() {
  local name="$1"
  docker exec "$name" node -e 'const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync("/opt/opencode/opencode.json","utf8")); process.stdout.write(String(Boolean(c.mcp["brave-search"].enabled)));'
}

assert_mcp_discovery() {
  local name="$1"
  local output
  local expect_brave
  expect_brave="$(read_rendered_brave_enabled "$name")"
  output="$(docker exec "$name" opencode mcp list)"
  grep -Eq '(^|[^[:alnum:]_-])context7([^[:alnum:]_-]|$)' <<<"$output"
  grep -Eq '(^|[^[:alnum:]_-])grep_app([^[:alnum:]_-]|$)' <<<"$output"
  if [[ "$expect_brave" == "true" ]]; then
    grep -Eq '(^|[^[:alnum:]_-])brave-search([^[:alnum:]_-]|$)' <<<"$output"
  fi
}

run_case() {
  local name="$1"
  local expected_enabled="$2"
  local expected_has_key="$3"
  shift 3
  docker run -d --name "$name" "$@" -v "$(pwd):/workspace" "$IMAGE_NAME"
  assert_common_runtime "$name"
  assert_mcp_discovery "$name"
  assert_rendered_brave_state "$name" "$expected_enabled" "$expected_has_key"
}

run_case opencode-harness-mcp-keyed true true -e BRAVE_API_KEY="$DUMMY_BRAVE_API_KEY"
docker exec opencode-harness-mcp-keyed sh -lc 'BRAVE_API_KEY="$BRAVE_API_KEY" timeout 3 mcp-server-brave-search >/tmp/brave.out 2>/tmp/brave.err; code=$?; test "$code" = 124'
docker rm -f opencode-harness-mcp-keyed

run_case opencode-harness-mcp-nokey false false
docker rm -f opencode-harness-mcp-nokey
run_case opencode-harness-mcp-offline false false --network none
docker rm -f opencode-harness-mcp-offline
run_case opencode-harness-mcp-offline-keyed true true --network none -e BRAVE_API_KEY="$DUMMY_BRAVE_API_KEY"
docker rm -f opencode-harness-mcp-offline-keyed
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `node --test tests/docker-contract.test.mjs`
Expected: PASS

- [ ] **Step 5: Run the smoke script itself**

Run: `bash scripts/smoke-mcp-runtime.sh`
Expected: PASS; the script exits 0 after checking keyed/no-key and online/no-egress discovery behavior

- [ ] **Step 6: Commit**

```bash
git add scripts/smoke-mcp-runtime.sh tests/docker-contract.test.mjs
git commit -m "test: add MCP docker smoke coverage"
```

### Task 5: Document the Brave env workflow and update host shell setup

**Files:**
- Modify: `README.md`
- Modify: `~/.zshrc` (manual host step; not committed)
- Modify: `tests/docker-contract.test.mjs`

- [ ] **Step 1: Add failing README contract assertions**

```js
test('README documents BRAVE_API_KEY passthrough and MCP verification', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');
  assert.match(readme, /-e BRAVE_API_KEY/);
  assert.match(readme, /obtain a Brave Search API key/i);
  assert.match(readme, /docker exec -it opencode-harness opencode mcp list/);
  assert.match(readme, /brave-search.*disabled/i);
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `node --test tests/docker-contract.test.mjs`
Expected: FAIL because README does not mention the Brave env flow yet

- [ ] **Step 3: Write the minimal README and host-shell changes**

```bash
docker run -it \
  --name opencode-harness \
  -e BRAVE_API_KEY \
  -p 127.0.0.1:4096:4096 \
  -p 127.0.0.1:48801:48801 \
  -v "<host-project-workspace>:/workspace" \
  opencode-harness
```

```md
Before starting the container, obtain a Brave Search API key and export `BRAVE_API_KEY` in your shell.

If `BRAVE_API_KEY` is unset, the container still starts normally and renders `brave-search` as disabled.

Verify MCP discovery with `docker exec -it opencode-harness opencode mcp list`.
```

```bash
# ~/.zshrc
export BRAVE_API_KEY='replace-with-your-brave-search-key'
```

- [ ] **Step 4: Run the focused tests to verify they pass**

Run: `node --test tests/docker-contract.test.mjs`
Expected: PASS

- [ ] **Step 5: Apply the host shell change and verify it**

Run: `zsh -ic '[[ -n ${BRAVE_API_KEY:-} ]] && printf present\n || printf missing\n'`
Expected: `present`

This is a manual host-only step. Do not write the real Brave key into any repo file, test fixture, Docker build arg, or committed example.

- [ ] **Step 6: Run the full repo tests and smoke script**

Run: `npm test && bash scripts/smoke-mcp-runtime.sh`
Expected: PASS; the smoke script covers keyed/no-key and online/no-egress states and exits 0 only when the rendered Brave config assertions hold for each run

- [ ] **Step 7: Run the explicit manual validation matrix from the spec**

Run:

```bash
docker run -d --name opencode-harness-mcp-smoke -e BRAVE_API_KEY -v "$(pwd):/workspace" opencode-harness
docker exec -it opencode-harness-mcp-smoke sh -lc 'command -v mcp-server-brave-search'
docker exec -it opencode-harness-mcp-smoke npm ls -g @modelcontextprotocol/server-brave-search --depth=0
docker exec -it opencode-harness-mcp-smoke cat /opt/opencode/mcp-versions.json
docker exec -it opencode-harness-mcp-smoke sh -lc 'BRAVE_API_KEY="$BRAVE_API_KEY" timeout 3 mcp-server-brave-search >/tmp/brave.out 2>/tmp/brave.err; code=$?; test "$code" = 124'
docker exec -it opencode-harness-mcp-smoke opencode mcp list
docker exec -it opencode-harness-mcp-smoke node -e 'const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync("/opt/opencode/opencode.json","utf8")); const brave=c.mcp["brave-search"]; console.log(JSON.stringify({enabled: brave.enabled, hasKey: Boolean(brave.environment && brave.environment.BRAVE_API_KEY)}))'
docker rm -f opencode-harness-mcp-smoke

docker run -d --name opencode-harness-mcp-nokey -v "$(pwd):/workspace" opencode-harness
docker exec -it opencode-harness-mcp-nokey sh -lc 'command -v mcp-server-brave-search'
docker exec -it opencode-harness-mcp-nokey opencode mcp list
docker exec -it opencode-harness-mcp-nokey node -e 'const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync("/opt/opencode/opencode.json","utf8")); const brave=c.mcp["brave-search"]; console.log(JSON.stringify({enabled: brave.enabled, hasKey: Boolean(brave.environment && brave.environment.BRAVE_API_KEY)}))'
docker rm -f opencode-harness-mcp-nokey

docker run -d --name opencode-harness-mcp-offline --network none -v "$(pwd):/workspace" opencode-harness
docker exec -it opencode-harness-mcp-offline opencode mcp list
docker exec -it opencode-harness-mcp-offline node -e 'const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync("/opt/opencode/opencode.json","utf8")); const brave=c.mcp["brave-search"]; console.log(JSON.stringify({enabled: brave.enabled, hasKey: Boolean(brave.environment && brave.environment.BRAVE_API_KEY)}))'
docker rm -f opencode-harness-mcp-offline

docker run -d --name opencode-harness-mcp-offline-keyed --network none -e BRAVE_API_KEY=dummy-brave-key -v "$(pwd):/workspace" opencode-harness
docker exec -it opencode-harness-mcp-offline-keyed sh -lc 'command -v mcp-server-brave-search'
docker exec -it opencode-harness-mcp-offline-keyed opencode mcp list
docker exec -it opencode-harness-mcp-offline-keyed node -e 'const fs=require("node:fs"); const c=JSON.parse(fs.readFileSync("/opt/opencode/opencode.json","utf8")); const brave=c.mcp["brave-search"]; console.log(JSON.stringify({enabled: brave.enabled, hasKey: Boolean(brave.environment && brave.environment.BRAVE_API_KEY)}))'
docker rm -f opencode-harness-mcp-offline-keyed
```

Expected: keyed runs show `enabled: true` and `hasKey: true`; no-key runs show `enabled: false` and `hasKey: false`; `opencode mcp list` succeeds in all four states.

- [ ] **Step 8: Commit the repo changes**

```bash
git add README.md tests/docker-contract.test.mjs scripts/smoke-mcp-runtime.sh
git commit -m "docs: explain MCP env and smoke workflow"
```

- [ ] **Step 9: Run the manual secret-removal check**

Run:

```bash
read -rsp 'Paste the original Brave key for one-time scanning: ' KEY_TO_SCAN && printf '\n'
if git ls-files -z | xargs -0 rg -F "$KEY_TO_SCAN"; then exit 1; fi
if docker save opencode-harness | strings | rg -F "$KEY_TO_SCAN"; then exit 1; fi
docker run -d --name opencode-harness-mcp-nokey-scan -v "$(pwd):/workspace" opencode-harness
if docker exec -e KEY_TO_SCAN="$KEY_TO_SCAN" -it opencode-harness-mcp-nokey-scan sh -lc 'grep -R -F "$KEY_TO_SCAN" /opt/opencode /usr/local/lib/node_modules 2>/dev/null'; then exit 1; fi
docker rm -f opencode-harness-mcp-nokey-scan
unset KEY_TO_SCAN
```

Expected: no matches in tracked repo files, baked image metadata, or files inside the no-key container; do not commit `KEY_TO_SCAN` anywhere and do not write it to disk
