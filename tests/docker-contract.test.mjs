import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('Dockerfile installs opencode-ai 1.2.27 and declares the required env contract', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.match(dockerfile, /opencode-ai@1\.2\.27/);
  assert.match(dockerfile, /OPENCODE_CONFIG=/);
  assert.match(dockerfile, /OCA_OAUTH_CALLBACK_PORT=48801/);
  assert.match(dockerfile, /SUPERPOWERS_SKILLS_DIR=\/opt\/opencode\/skills\b/);
});

test('config/opencode.json wires both baked plugins and the default model', async () => {
  const configText = await readFile(new URL('../config/opencode.json', import.meta.url), 'utf8');
  const config = JSON.parse(configText);
  assert.deepEqual(config.plugin, [
    'file:///opt/opencode/plugins/opencode-oca-auth',
    'file:///opt/opencode/plugins/superpowers.js',
  ]);
  assert.equal(config.model, 'oca/gpt-5.4');
});

test('vendor/sources.lock.json records both upstream repos and pinned revisions', async () => {
  const lockText = await readFile(new URL('../vendor/sources.lock.json', import.meta.url), 'utf8');
  const lock = JSON.parse(lockText);

  assert.equal(lock.opencodeOcaAuth.repo, 'https://github.com/Ye99/opencode-oca-auth');
  assert.match(lock.opencodeOcaAuth.revision, /^[0-9a-f]{7,40}$/);
  assert.equal(lock.superpowers.repo, 'https://github.com/obra/superpowers');
  assert.match(lock.superpowers.revision, /^[0-9a-f]{7,40}$/);
});

test('Docker build validates vendor sources against sources.lock.json', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const validator = await readFile(new URL('../scripts/validate-sources-lock.mjs', import.meta.url), 'utf8');

  assert.match(dockerfile, /validate-sources-lock\.mjs/);
  assert.match(validator, /sources\.lock\.json/);
  assert.match(validator, /\.source-revision/);
});

test('README documents the shared image tag and operator flow', async () => {
  const readme = await readFile(new URL('../README.md', import.meta.url), 'utf8');

  assert.match(readme, /dc-opencode-harness\b/);
  assert.doesNotMatch(readme, /dc-opencode-harness:dev/);
  assert.match(readme, /<host-project-workspace>:\/workspace/);
  assert.match(readme, /docker exec -it <container-name> opencode auth login/);
  assert.match(readme, /http:\/\/127\.0\.0\.1:4096/);
});

test('vendor trees include both pinned upstream source snapshots', async () => {
  const authPkg = JSON.parse(await readFile(new URL('../vendor/opencode-oca-auth/package.json', import.meta.url), 'utf8'));
  const superpowersPkg = JSON.parse(await readFile(new URL('../vendor/superpowers/package.json', import.meta.url), 'utf8'));
  const authRevision = await readFile(new URL('../vendor/opencode-oca-auth/.source-revision', import.meta.url), 'utf8');
  const superpowersRevision = await readFile(new URL('../vendor/superpowers/.source-revision', import.meta.url), 'utf8');

  assert.equal(authPkg.name, 'opencode-oca-auth');
  assert.equal(superpowersPkg.name, 'superpowers');
  assert.equal(superpowersPkg.main, '.opencode/plugins/superpowers.js');
  assert.match(authRevision.trim(), /^[0-9a-f]{7,40}$/);
  assert.match(superpowersRevision.trim(), /^[0-9a-f]{7,40}$/);
});

test('entrypoint invokes the packaged verify-runtime script from the image path', async () => {
  const entrypoint = await readFile(new URL('../scripts/opencode-harness-entrypoint', import.meta.url), 'utf8');
  assert.match(entrypoint, /\/opt\/opencode\/scripts\/verify-runtime\.sh/);
});
