import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, cp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr?.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

test('patcher updates upstream plugin bind host and skills path', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'patch-upstream-'));
  const superpowersDir = path.join(root, 'superpowers');
  const authDir = path.join(root, 'opencode-oca-auth');

  await cp(path.resolve('tests/fixtures/upstream/superpowers'), superpowersDir, { recursive: true });
  await cp(path.resolve('tests/fixtures/upstream/opencode-oca-auth'), authDir, { recursive: true });

  const result = await run('node', ['scripts/patch-upstream-sources.mjs', superpowersDir, authDir], {
    cwd: path.resolve('.'),
  });

  assert.equal(result.code, 0, result.stderr);

  const pluginSource = await readFile(path.join(superpowersDir, '.opencode/plugins/superpowers.js'), 'utf8');
  assert.match(pluginSource, /SUPERPOWERS_SKILLS_DIR/);
  assert.match(pluginSource, /\/opt\/opencode\/skills/);
  assert.match(pluginSource, /path\.resolve\(configuredSuperpowersSkillsDir, 'superpowers'\)/);

  const oauthSource = await readFile(path.join(authDir, 'src/oauth.ts'), 'utf8');
  assert.match(oauthSource, /OCA_OAUTH_BIND_HOST/);
  assert.match(oauthSource, /127\.0\.0\.1/);
});
