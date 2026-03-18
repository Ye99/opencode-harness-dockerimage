import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import net from 'node:net';

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

async function makeRuntimeFixture() {
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

  await writeFile(path.join(configDir, 'opencode.json'), '{}\n');
  await writeFile(path.join(configDir, 'plugins/superpowers.js'), 'export default {}\n');
  await writeFile(path.join(skillsDir, 'using-superpowers/SKILL.md'), '# using-superpowers\n');
  await writeFile(path.join(skillsDir, 'brainstorming/SKILL.md'), '# brainstorming\n');
  await writeFile(
    path.join(binDir, 'opencode'),
    `#!/usr/bin/env bash
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
  if [[ "\${OPENCODE_MODELS_FAIL:-0}" == "1" ]]; then
    exit 1
  fi
  printf 'oca/gpt-5.4\n'
  exit 0
fi
exit 0
`,
    'utf8',
  );
  await chmod(path.join(binDir, 'opencode'), 0o755);

  return { root, workspace, configDir, pluginDir, skillsRoot, skillsDir, binDir };
}

test('verify-runtime preflight succeeds with packaged assets', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await run('bash', ['scripts/verify-runtime.sh', 'preflight'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      WORKSPACE_DIR: fixture.workspace,
      OPENCODE_CONFIG: path.join(fixture.configDir, 'opencode.json'),
      OPENCODE_CONFIG_DIR: fixture.configDir,
      SUPERPOWERS_SKILLS_DIR: fixture.skillsRoot,
      PATH: `${fixture.binDir}:${process.env.PATH}`,
    },
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /preflight-ok/);
});

test('verify-runtime preflight fails when workspace is missing', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await run('bash', ['scripts/verify-runtime.sh', 'preflight'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      WORKSPACE_DIR: path.join(fixture.root, 'missing-workspace'),
      OPENCODE_CONFIG: path.join(fixture.configDir, 'opencode.json'),
      OPENCODE_CONFIG_DIR: fixture.configDir,
      SUPERPOWERS_SKILLS_DIR: fixture.skillsRoot,
      PATH: `${fixture.binDir}:${process.env.PATH}`,
    },
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Missing mounted workspace/);
});

test('verify-runtime preflight fails when workspace is read-only', async () => {
  const fixture = await makeRuntimeFixture();
  await chmod(fixture.workspace, 0o555);
  const result = await run('bash', ['scripts/verify-runtime.sh', 'preflight'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      WORKSPACE_DIR: fixture.workspace,
      OPENCODE_CONFIG: path.join(fixture.configDir, 'opencode.json'),
      OPENCODE_CONFIG_DIR: fixture.configDir,
      SUPERPOWERS_SKILLS_DIR: fixture.skillsRoot,
      PATH: `${fixture.binDir}:${process.env.PATH}`,
    },
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /not writable/);
});

test('verify-runtime preflight fails when a required port is unavailable', async () => {
  const fixture = await makeRuntimeFixture();
  const server = net.createServer();
  await new Promise((resolve) => server.listen(4096, '0.0.0.0', resolve));

  try {
    const result = await run('bash', ['scripts/verify-runtime.sh', 'preflight'], {
      cwd: path.resolve('.'),
      env: {
        ...process.env,
        WORKSPACE_DIR: fixture.workspace,
        OPENCODE_CONFIG: path.join(fixture.configDir, 'opencode.json'),
        OPENCODE_CONFIG_DIR: fixture.configDir,
        SUPERPOWERS_SKILLS_DIR: fixture.skillsRoot,
        PATH: `${fixture.binDir}:${process.env.PATH}`,
      },
    });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Port is unavailable/);
  } finally {
    server.close();
  }
});

test('verify-runtime preflight fails when bundled plugin assets are missing', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await run('bash', ['scripts/verify-runtime.sh', 'preflight'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      WORKSPACE_DIR: fixture.workspace,
      OPENCODE_CONFIG: path.join(fixture.configDir, 'opencode.json'),
      OPENCODE_CONFIG_DIR: fixture.configDir,
      SUPERPOWERS_SKILLS_DIR: path.join(fixture.root, 'missing-skills'),
      PATH: `${fixture.binDir}:${process.env.PATH}`,
    },
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Missing bundled Superpowers skills/);
});

test('verify-runtime preflight fails when OCA models are not available through opencode', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await run('bash', ['scripts/verify-runtime.sh', 'preflight'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      WORKSPACE_DIR: fixture.workspace,
      OPENCODE_CONFIG: path.join(fixture.configDir, 'opencode.json'),
      OPENCODE_CONFIG_DIR: fixture.configDir,
      SUPERPOWERS_SKILLS_DIR: fixture.skillsRoot,
      OPENCODE_MODELS_FAIL: '1',
      PATH: `${fixture.binDir}:${process.env.PATH}`,
    },
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /does not expose OCA models/);
});
