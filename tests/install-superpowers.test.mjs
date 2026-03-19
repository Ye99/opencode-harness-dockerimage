import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, cp, stat } from 'node:fs/promises';
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

test('install-superpowers preserves upstream tree layout under plugins/superpowers', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'install-superpowers-'));
  const srcDir = path.join(root, 'superpowers');
  const destDir = path.join(root, 'opencode');

  await cp(path.resolve('tests/fixtures/upstream/superpowers'), srcDir, { recursive: true });

  const result = await run('bash', ['scripts/install-superpowers.sh', srcDir, destDir], {
    cwd: path.resolve('.'),
  });

  assert.equal(result.code, 0, result.stderr);
  await stat(path.join(destDir, 'plugins/superpowers/.opencode/plugins/superpowers.js'));
  await stat(path.join(destDir, 'plugins/superpowers/skills/using-superpowers/SKILL.md'));
  await stat(path.join(destDir, 'plugins/superpowers/skills/brainstorming/SKILL.md'));
});
