import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import test from 'node:test';

import {
  compareVersions,
  normalizeRequestedVersion,
  parseLatestStableVersion,
  resolvePythonVersion,
} from '../scripts/resolve-python-version.mjs';

function runNode(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: new URL('..', import.meta.url),
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

test('parseLatestStableVersion picks the newest stable version', () => {
  const html = `
    <a href="https://www.python.org/downloads/release/python-3143/">Python 3.14.3</a>
    <a href="https://www.python.org/downloads/release/python-3139/">Python 3.13.9</a>
    <a href="https://www.python.org/downloads/release/python-3150/">Python 3.15.0b1</a>
  `;

  assert.equal(parseLatestStableVersion(html), '3.14.3');
});

test('parseLatestStableVersion ignores prerelease entries', () => {
  const html = `
    <a href="https://www.python.org/downloads/release/python-3150/">Python 3.15.0rc2</a>
    <a href="https://www.python.org/downloads/release/python-3142/">Python 3.14.2</a>
  `;

  assert.equal(parseLatestStableVersion(html), '3.14.2');
});

test('compareVersions orders exact versions numerically', () => {
  assert.ok(compareVersions('3.14.3', '3.14.2') > 0);
  assert.ok(compareVersions('3.14.3', '3.14.3') === 0);
  assert.ok(compareVersions('3.13.9', '3.14.0') < 0);
});

test('normalizeRequestedVersion accepts exact versions', () => {
  assert.equal(normalizeRequestedVersion('3.14.3'), '3.14.3');
  assert.equal(normalizeRequestedVersion('latest-stable'), 'latest-stable');
});

test('normalizeRequestedVersion rejects loose versions', () => {
  assert.throws(
    () => normalizeRequestedVersion('3.14'),
    /expected latest-stable or X\.Y\.Z/i,
  );
});

test('normalizeRequestedVersion rejects garbage input', () => {
  assert.throws(
    () => normalizeRequestedVersion('not-python'),
    /expected latest-stable or X\.Y\.Z/i,
  );
});

test('resolvePythonVersion returns exact versions without fetching', async () => {
  let called = false;
  const fetchImpl = async () => {
    called = true;
    throw new Error('should not fetch');
  };

  const version = await resolvePythonVersion('3.14.3', fetchImpl);

  assert.equal(version, '3.14.3');
  assert.equal(called, false);
});

test('resolvePythonVersion uses injected fetch for latest stable', async () => {
  const seen = [];
  const fetchImpl = async (url) => {
    seen.push(url);
    return {
      ok: true,
      async text() {
        return `
          <a href="/downloads/release/python-3139/">Python 3.13.9</a>
          <a href="/downloads/release/python-3143/">Python 3.14.3</a>
          <a href="/downloads/release/python-3150/">Python 3.15.0b1</a>
        `;
      },
    };
  };

  const version = await resolvePythonVersion('latest-stable', fetchImpl);

  assert.deepEqual(seen, ['https://www.python.org/downloads/']);
  assert.equal(version, '3.14.3');
});

test('resolvePythonVersion wraps rejected fetch failures with the downloads URL', async () => {
  await assert.rejects(
    () => resolvePythonVersion('latest-stable', async () => {
      throw new Error('network down');
    }),
    /Failed to fetch https:\/\/www\.python\.org\/downloads\/: network down/i,
  );
});

test('resolvePythonVersion reports non-OK fetch responses with the downloads URL', async () => {
  await assert.rejects(
    () => resolvePythonVersion('latest-stable', async () => ({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    })),
    /Failed to fetch https:\/\/www\.python\.org\/downloads\/: 503 Service Unavailable/i,
  );
});

test('resolvePythonVersion fails clearly when no stable Python release is present', async () => {
  await assert.rejects(
    () => resolvePythonVersion('latest-stable', async () => ({
      ok: true,
      async text() {
        return '<a href="/downloads/release/python-3150/">Python 3.15.0b1</a>';
      },
    })),
    /Could not find a stable Python release on python\.org\/downloads/i,
  );
});

test('CLI prints the resolved exact version to stdout only', async () => {
  const result = await runNode(['scripts/resolve-python-version.mjs', '3.14.3']);

  assert.equal(result.code, 0);
  assert.equal(result.stdout, '3.14.3\n');
  assert.equal(result.stderr, '');
});

test('CLI exits non-zero with a clear stderr message on failure', async () => {
  const result = await runNode(['scripts/resolve-python-version.mjs', '3.14']);

  assert.notEqual(result.code, 0);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /expected latest-stable or X\.Y\.Z/i);
});
