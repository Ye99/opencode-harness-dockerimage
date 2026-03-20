import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { run } from './helpers/run.mjs';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const script = path.join(projectRoot, 'scripts', 'preflight-node-checks.mjs');

test('--check-port without a value exits with error mentioning missing value', async () => {
  const result = await run(process.execPath, [script, '--check-port'], {
    cwd: projectRoot,
  });

  assert.notEqual(result.code, 0, 'should exit non-zero');
  assert.match(result.stderr, /Missing value for --check-port/i);
});

test('--mcp-metadata without any values exits with error mentioning missing value', async () => {
  const result = await run(process.execPath, [script, '--mcp-metadata'], {
    cwd: projectRoot,
  });

  assert.notEqual(result.code, 0, 'should exit non-zero');
  assert.match(result.stderr, /Missing value for --mcp-metadata: expected <file> <package>/i);
});

test('--mcp-metadata with only one value (missing package name) exits with error', async () => {
  const result = await run(process.execPath, [script, '--mcp-metadata', '/tmp/some-file.json'], {
    cwd: projectRoot,
  });

  assert.notEqual(result.code, 0, 'should exit non-zero');
  assert.match(result.stderr, /Missing package name for --mcp-metadata/i);
});

test('--config without a value exits with error mentioning missing value', async () => {
  const result = await run(process.execPath, [script, '--config'], {
    cwd: projectRoot,
  });

  assert.notEqual(result.code, 0, 'should exit non-zero');
  assert.match(result.stderr, /Missing value for --config/i);
});

test('--check-port with IPv6 wildcard :::0 succeeds (port 0 binds to any available port)', async () => {
  const result = await run(process.execPath, [script, '--check-port', ':::0'], {
    cwd: projectRoot,
  });

  assert.equal(result.code, 0, 'should exit zero — port 0 on IPv6 wildcard is always available');
  assert.doesNotMatch(result.stderr, /port is unavailable/i);
});

test('--check-port with IPv4 0.0.0.0:0 succeeds (port 0 binds to any available port)', async () => {
  const result = await run(process.execPath, [script, '--check-port', '0.0.0.0:0'], {
    cwd: projectRoot,
  });

  assert.equal(result.code, 0, 'should exit zero — port 0 on IPv4 wildcard is always available');
  assert.doesNotMatch(result.stderr, /port is unavailable/i);
});
