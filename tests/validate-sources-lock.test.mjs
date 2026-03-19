import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from './helpers/run.mjs';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

async function makeFixture({ lockJson, authRevision, superpowersRevision } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'validate-sources-lock-'));
  const lockPath = path.join(root, 'sources.lock.json');
  const authRoot = path.join(root, 'auth');
  const superpowersRoot = path.join(root, 'superpowers');

  await mkdir(authRoot, { recursive: true });
  await mkdir(superpowersRoot, { recursive: true });

  if (lockJson !== undefined) {
    await writeFile(lockPath, typeof lockJson === 'string' ? lockJson : JSON.stringify(lockJson, null, 2));
  }

  if (authRevision !== undefined) {
    await writeFile(path.join(authRoot, '.source-revision'), `${authRevision}\n`);
  }

  if (superpowersRevision !== undefined) {
    await writeFile(path.join(superpowersRoot, '.source-revision'), `${superpowersRevision}\n`);
  }

  return { root, lockPath, authRoot, superpowersRoot };
}

function runValidator(fixture, args) {
  return run(process.execPath, [
    'scripts/validate-sources-lock.mjs',
    ...(args ?? [fixture.lockPath, fixture.authRoot, fixture.superpowersRoot]),
  ], { cwd: projectRoot });
}

test('succeeds when lock and source-revision files match', async () => {
  const fixture = await makeFixture({
    lockJson: {
      opencodeOcaAuth: { repo: 'https://example.com/auth', revision: 'abc123' },
      superpowers: { repo: 'https://example.com/sp', revision: 'def456' },
    },
    authRevision: 'abc123',
    superpowersRevision: 'def456',
  });
  const result = await runValidator(fixture);

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /validate-sources-lock-ok/);
});

test('fails when opencode-oca-auth revision does not match', async () => {
  const fixture = await makeFixture({
    lockJson: {
      opencodeOcaAuth: { repo: 'https://example.com/auth', revision: 'abc123' },
      superpowers: { repo: 'https://example.com/sp', revision: 'def456' },
    },
    authRevision: 'wrong',
    superpowersRevision: 'def456',
  });
  const result = await runValidator(fixture);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /opencode-oca-auth vendor tree does not match/);
});

test('fails when superpowers revision does not match', async () => {
  const fixture = await makeFixture({
    lockJson: {
      opencodeOcaAuth: { repo: 'https://example.com/auth', revision: 'abc123' },
      superpowers: { repo: 'https://example.com/sp', revision: 'def456' },
    },
    authRevision: 'abc123',
    superpowersRevision: 'wrong',
  });
  const result = await runValidator(fixture);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /superpowers vendor tree does not match/);
});

test('fails when lock file is missing', async () => {
  const fixture = await makeFixture({
    authRevision: 'abc123',
    superpowersRevision: 'def456',
  });
  const result = await runValidator(fixture);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Cannot read sources lock file/);
});

test('fails when lock file is invalid JSON', async () => {
  const fixture = await makeFixture({
    lockJson: '{not valid json}',
    authRevision: 'abc123',
    superpowersRevision: 'def456',
  });
  const result = await runValidator(fixture);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Cannot read sources lock file/);
});

test('fails when lock file is missing opencodeOcaAuth.revision', async () => {
  const fixture = await makeFixture({
    lockJson: {
      superpowers: { repo: 'https://example.com/sp', revision: 'def456' },
    },
    authRevision: 'abc123',
    superpowersRevision: 'def456',
  });
  const result = await runValidator(fixture);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /missing required key: opencodeOcaAuth\.revision/);
});

test('fails when lock file is missing superpowers.revision', async () => {
  const fixture = await makeFixture({
    lockJson: {
      opencodeOcaAuth: { repo: 'https://example.com/auth', revision: 'abc123' },
    },
    authRevision: 'abc123',
    superpowersRevision: 'def456',
  });
  const result = await runValidator(fixture);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /missing required key: superpowers\.revision/);
});

test('fails when auth .source-revision is missing', async () => {
  const fixture = await makeFixture({
    lockJson: {
      opencodeOcaAuth: { repo: 'https://example.com/auth', revision: 'abc123' },
      superpowers: { repo: 'https://example.com/sp', revision: 'def456' },
    },
    superpowersRevision: 'def456',
  });
  const result = await runValidator(fixture);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Cannot read opencode-oca-auth \.source-revision/);
});

test('fails when superpowers .source-revision is missing', async () => {
  const fixture = await makeFixture({
    lockJson: {
      opencodeOcaAuth: { repo: 'https://example.com/auth', revision: 'abc123' },
      superpowers: { repo: 'https://example.com/sp', revision: 'def456' },
    },
    authRevision: 'abc123',
  });
  const result = await runValidator(fixture);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Cannot read superpowers \.source-revision/);
});

test('fails when required args are missing', async () => {
  const result = await run(process.execPath, ['scripts/validate-sources-lock.mjs'], { cwd: projectRoot });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Usage/);
});
