import assert from 'node:assert/strict';
import net from 'node:net';
import test from 'node:test';
import { run } from './helpers/run.mjs';

const SCRIPT = 'scripts/port-drain-probe.mjs';

test('exits 1 with usage message when host and port args are missing', async () => {
  const { code, stderr } = await run('node', [SCRIPT]);
  assert.equal(code, 1);
  assert.match(stderr, /Usage:/);
});

test('exits 1 with usage message when port arg is missing', async () => {
  const { code, stderr } = await run('node', [SCRIPT, '127.0.0.1']);
  assert.equal(code, 1);
  assert.match(stderr, /Usage:/);
});

test('exits 1 for non-numeric port "abc"', async () => {
  const { code, stderr } = await run('node', [SCRIPT, '127.0.0.1', 'abc']);
  assert.equal(code, 1);
  assert.match(stderr, /invalid port/i);
});

test('exits 1 for port 0 (below valid range)', async () => {
  const { code, stderr } = await run('node', [SCRIPT, '127.0.0.1', '0']);
  assert.equal(code, 1);
  assert.match(stderr, /invalid port/i);
});

test('exits 1 for port 99999 (above valid range)', async () => {
  const { code, stderr } = await run('node', [SCRIPT, '127.0.0.1', '99999']);
  assert.equal(code, 1);
  assert.match(stderr, /invalid port/i);
});

test('exits 0 when port connection is refused (service already drained)', async () => {
  // Use a port that is almost certainly not listening
  const { code } = await run('node', [SCRIPT, '127.0.0.1', '19']);
  assert.equal(code, 0);
});
