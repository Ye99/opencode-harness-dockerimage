import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ENTRYPOINT = fileURLToPath(new URL('../scripts/opencode-harness-entrypoint', import.meta.url));

async function waitFor(check, { timeoutMs = 15000, intervalMs = 100 } = {}) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const value = await check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function readLines(filePath) {
  try {
    return (await readFile(filePath, 'utf8')).split('\n').filter(Boolean);
  } catch {
    return [];
  }
}

async function setupEntrypointHarness(root, { probeExitCode = 0 } = {}) {
  const binDir = path.join(root, 'bin');
  const logsDir = path.join(root, 'logs');
  const workspaceDir = path.join(root, 'workspace');
  const configDir = path.join(root, 'config');
  const stateDir = path.join(root, 'data');
  const baseConfig = path.join(root, 'opencode.base.json');
  const renderedConfig = path.join(configDir, 'opencode.json');
  const authFile = path.join(stateDir, 'opencode', 'auth.json');

  await mkdir(binDir, { recursive: true });
  await mkdir(logsDir, { recursive: true });
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(path.dirname(authFile), { recursive: true });
  await writeFile(baseConfig, '{"ok":true}\n', 'utf8');

  const fakeNode = `#!/bin/bash
set -euo pipefail
if [[ "$1" == "/opt/opencode/scripts/render-opencode-config.mjs" ]]; then
  printf 'render\\n' >> "$OPENCODE_TEST_LOG_DIR/render.log"
  cp "$OPENCODE_TEST_BASE_CONFIG" "$3"
  exit 0
fi
if [[ "$1" == "-e" ]]; then
  printf 'probe\\n' >> "$OPENCODE_TEST_LOG_DIR/probe.log"
  exit ${probeExitCode}
fi
exec "$REAL_NODE" "$@"
`;

  const fakeBash = `#!/bin/bash
set -euo pipefail
if [[ "$1" == "/opt/opencode/scripts/verify-runtime.sh" && "\${2:-}" == "preflight" ]]; then
  printf 'preflight\\n' >> "$OPENCODE_TEST_LOG_DIR/preflight.log"
  exit 0
fi
exec /bin/bash "$@"
`;

  const fakeOpencode = `#!/bin/bash
set -euo pipefail
if [[ "$1" == "web" ]]; then
  printf 'start %s\\n' "$$" >> "$OPENCODE_TEST_LOG_DIR/web.log"
  trap 'printf "stop %s\\n" "$$" >> "$OPENCODE_TEST_LOG_DIR/web.log"; exit 0' TERM INT
  while true; do
    sleep 1
  done
fi
printf 'unexpected %s\\n' "$*" >> "$OPENCODE_TEST_LOG_DIR/web.log"
exit 1
`;

  const fakeSetsid = `#!/bin/bash
set -euo pipefail
exec perl -MPOSIX=setsid -e 'POSIX::setsid() != -1 or die "setsid failed\\n"; exec @ARGV or die "exec failed: $!\\n";' "$@"
`;

  await writeFile(path.join(binDir, 'node'), fakeNode, { mode: 0o755 });
  await writeFile(path.join(binDir, 'bash'), fakeBash, { mode: 0o755 });
  await writeFile(path.join(binDir, 'opencode'), fakeOpencode, { mode: 0o755 });
  await writeFile(path.join(binDir, 'setsid'), fakeSetsid, { mode: 0o755 });

  return { binDir, logsDir, workspaceDir, configDir, stateDir, baseConfig, renderedConfig, authFile };
}

function spawnEntrypoint(harness, root) {
  const child = spawn('/bin/bash', [ENTRYPOINT], {
    cwd: harness.workspaceDir,
    env: {
      ...process.env,
      PATH: `${harness.binDir}:${process.env.PATH}`,
      REAL_NODE: process.execPath,
      OPENCODE_TEST_LOG_DIR: harness.logsDir,
      OPENCODE_TEST_BASE_CONFIG: harness.baseConfig,
      OPENCODE_CONFIG: harness.renderedConfig,
      OPENCODE_CONFIG_DIR: harness.configDir,
      OPENCODE_SERVER_HOST: '0.0.0.0',
      OPENCODE_SERVER_PORT: '4096',
      WORKSPACE_DIR: harness.workspaceDir,
      XDG_DATA_HOME: harness.stateDir,
      HOME: root,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  const stdout = [];
  const stderr = [];
  child.stdout.on('data', (chunk) => stdout.push(String(chunk)));
  child.stderr.on('data', (chunk) => stderr.push(String(chunk)));

  return { child, stdout, stderr };
}

async function killAndWait(child) {
  child.kill('SIGTERM');
  if (child.exitCode === null) {
    await Promise.race([
      once(child, 'exit'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for entrypoint shutdown')), 5000)),
    ]).catch(async () => {
      child.kill('SIGKILL');
      await once(child, 'exit');
    });
  }
}

test('entrypoint rerenders and restarts web when auth state changes', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opencode-entrypoint-'));
  const harness = await setupEntrypointHarness(root);
  const { child, stdout, stderr } = spawnEntrypoint(harness, root);

  try {
    await waitFor(async () => (await readLines(path.join(harness.logsDir, 'web.log'))).filter((line) => line.startsWith('start')).length >= 1);
    await waitFor(async () => (await readLines(path.join(harness.logsDir, 'render.log'))).length >= 1);
    await waitFor(async () => (await readLines(path.join(harness.logsDir, 'preflight.log'))).length >= 1);

    await writeFile(harness.authFile, 'first-token\n', 'utf8');

    await waitFor(async () => {
      const starts = (await readLines(path.join(harness.logsDir, 'web.log'))).filter((line) => line.startsWith('start'));
      return starts.length >= 2 ? starts : null;
    }, { timeoutMs: 20000, intervalMs: 200 });

    const renderLines = await readLines(path.join(harness.logsDir, 'render.log'));
    const preflightLines = await readLines(path.join(harness.logsDir, 'preflight.log'));
    const probeLines = await readLines(path.join(harness.logsDir, 'probe.log'));
    const webLines = await readLines(path.join(harness.logsDir, 'web.log'));
    const startLines = webLines.filter((line) => line.startsWith('start'));
    const stopLines = webLines.filter((line) => line.startsWith('stop'));

    assert.equal(preflightLines.length, 1);
    assert.equal(renderLines.length, 2);
    assert.equal(probeLines.length, 1);
    assert.equal(startLines.length, 2);
    assert.ok(stopLines.length >= 1);
    assert.notEqual(startLines[0], startLines[1]);
    assert.equal((await readFile(harness.renderedConfig, 'utf8')).trim(), '{"ok":true}');
  } finally {
    await killAndWait(child);
    await rm(root, { recursive: true, force: true });
  }

  assert.equal(child.exitCode, 0, `stdout:\n${stdout.join('')}\nstderr:\n${stderr.join('')}`);
});

test('entrypoint continues restart when port-drain probe times out', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opencode-entrypoint-drain-'));
  const harness = await setupEntrypointHarness(root, { probeExitCode: 1 });
  const { child, stdout, stderr } = spawnEntrypoint(harness, root);

  try {
    // Wait for first start
    await waitFor(async () => (await readLines(path.join(harness.logsDir, 'web.log'))).filter((line) => line.startsWith('start')).length >= 1);

    // Trigger auth change to cause restart
    await writeFile(harness.authFile, 'changed-token\n', 'utf8');

    // The probe will exit 1 (simulating timeout). Entrypoint should survive and restart.
    await waitFor(async () => {
      const starts = (await readLines(path.join(harness.logsDir, 'web.log'))).filter((line) => line.startsWith('start'));
      return starts.length >= 2 ? starts : null;
    }, { timeoutMs: 20000, intervalMs: 200 });

    const probeLines = await readLines(path.join(harness.logsDir, 'probe.log'));
    assert.ok(probeLines.length >= 1, 'probe should have been called');

    // Should log the timeout warning
    const stderrText = stderr.join('');
    assert.match(stderrText, /port-drain-timeout/);
  } finally {
    await killAndWait(child);
    await rm(root, { recursive: true, force: true });
  }

  assert.equal(child.exitCode, 0, `stdout:\n${stdout.join('')}\nstderr:\n${stderr.join('')}`);
});

test('entrypoint exits cleanly when SIGTERM arrives during startup', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'opencode-entrypoint-sigterm-'));
  const harness = await setupEntrypointHarness(root);
  const { child, stdout, stderr } = spawnEntrypoint(harness, root);

  try {
    // Wait for the child process to start (web launched)
    await waitFor(async () => (await readLines(path.join(harness.logsDir, 'web.log'))).filter((line) => line.startsWith('start')).length >= 1);

    // Send SIGTERM immediately
    child.kill('SIGTERM');

    // Should exit cleanly with code 0
    await Promise.race([
      once(child, 'exit'),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for SIGTERM exit')), 10000)),
    ]);
  } finally {
    if (child.exitCode === null) {
      child.kill('SIGKILL');
      await once(child, 'exit').catch(() => {});
    }
    await rm(root, { recursive: true, force: true });
  }

  assert.equal(child.exitCode, 0, `Expected clean exit on SIGTERM.\nstdout:\n${stdout.join('')}\nstderr:\n${stderr.join('')}`);
});
