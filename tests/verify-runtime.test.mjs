import assert from 'node:assert/strict';
import test from 'node:test';
import { chmod, copyFile, mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises';
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

async function writeExecutable(filePath, contents) {
  await writeFile(filePath, contents, 'utf8');
  await chmod(filePath, 0o755);
}

async function writeHostCommandLink(targetDir, name, targetPath) {
  await symlink(targetPath, path.join(targetDir, name));
}

async function writePythonRuntimeCommands(binDir, options = {}) {
  const {
    python3 = true,
    python = true,
    pip3 = true,
    pip = true,
    python3VenvSucceeds = true,
  } = options;

  if (python3) {
    await writeExecutable(
      path.join(binDir, 'python3'),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  printf 'Python 3.12.9\n'
  exit 0
fi
if [[ "\${1:-}" == "-m" && "\${2:-}" == "venv" ]]; then
  if [[ "\${3:-}" == "" ]]; then
    printf 'missing venv target\n' >&2
    exit 1
  fi
  ${python3VenvSucceeds ? "mkdir -p \"\\$3\"\n  exit 0" : "printf 'venv failed\\n' >&2\n  exit 1"}
fi
printf 'python3 stub does not support: %s\n' "\$*" >&2
exit 1
`,
    );
  }

  if (python) {
    await writeExecutable(
      path.join(binDir, 'python'),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  printf 'Python 3.12.9\n'
  exit 0
fi
printf 'python stub does not support: %s\n' "\$*" >&2
exit 1
`,
    );
  }

  if (pip3) {
    await writeExecutable(
      path.join(binDir, 'pip3'),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  printf 'pip 24.0 from /tmp/pip3 (python 3.12)\n'
  exit 0
fi
printf 'pip3 stub does not support: %s\n' "\$*" >&2
exit 1
`,
    );
  }

  if (pip) {
    await writeExecutable(
      path.join(binDir, 'pip'),
      `#!/usr/bin/env bash
set -euo pipefail
if [[ "\${1:-}" == "--version" ]]; then
  printf 'pip 24.0 from /tmp/pip (python 3.12)\n'
  exit 0
fi
printf 'pip stub does not support: %s\n' "\$*" >&2
exit 1
`,
    );
  }
}

async function makeRuntimeFixture(options = {}) {
  const {
    python3 = true,
    python = true,
    pip3 = true,
    pip = true,
    python3VenvSucceeds = true,
    pythonVersion = '3.12.9',
  } = options;
  const root = await mkdtemp(path.join(tmpdir(), 'verify-runtime-'));
  const workspace = path.join(root, 'workspace');
  const configDir = path.join(root, 'opt/opencode');
  const pluginDir = path.join(configDir, 'plugins/opencode-oca-auth');
  const skillsRoot = path.join(configDir, 'skills');
  const skillsDir = path.join(skillsRoot, 'superpowers');
  const binDir = path.join(root, 'bin');
  const hostBinDir = path.join(root, 'host-bin');
  const metadataPath = path.join(configDir, 'mcp-versions.json');

  await mkdir(workspace, { recursive: true });
  await mkdir(pluginDir, { recursive: true });
  await mkdir(path.join(configDir, 'plugins'), { recursive: true });
  await mkdir(path.join(skillsDir, 'using-superpowers'), { recursive: true });
  await mkdir(path.join(skillsDir, 'brainstorming'), { recursive: true });
  await mkdir(binDir, { recursive: true });
  await mkdir(hostBinDir, { recursive: true });

  await Promise.all([
    writeHostCommandLink(hostBinDir, 'bash', '/bin/bash'),
    writeHostCommandLink(hostBinDir, 'cat', '/bin/cat'),
    writeHostCommandLink(hostBinDir, 'mkdir', '/bin/mkdir'),
    writeHostCommandLink(hostBinDir, 'rm', '/bin/rm'),
    writeHostCommandLink(hostBinDir, 'dirname', '/usr/bin/dirname'),
    writeHostCommandLink(hostBinDir, 'grep', '/usr/bin/grep'),
    writeHostCommandLink(hostBinDir, 'mktemp', '/usr/bin/mktemp'),
    writeHostCommandLink(hostBinDir, 'node', process.execPath),
  ]);

  await writePythonRuntimeCommands(binDir, {
    python3,
    python,
    pip3,
    pip,
    python3VenvSucceeds,
  });

  await writeFile(
    path.join(configDir, 'opencode.json'),
    JSON.stringify(
      {
        mcp: {
          'brave-search': {
            enabled: true,
          },
        },
      },
      null,
      2,
    ) + '\n',
  );
  await writeFile(path.join(configDir, 'plugins/superpowers.js'), 'export default {}\n');
  await writeFile(path.join(skillsDir, 'using-superpowers/SKILL.md'), '# using-superpowers\n');
  await writeFile(path.join(skillsDir, 'brainstorming/SKILL.md'), '# brainstorming\n');
  await writeFile(path.join(configDir, 'python-version.txt'), `${pythonVersion}\n`, 'utf8');
  await writeFile(
    metadataPath,
    JSON.stringify(
      {
        dependencies: {
          '@modelcontextprotocol/server-brave-search': {
            version: '0.0.1',
          },
        },
      },
      null,
      2,
    ) + '\n',
  );
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
if [[ "$1 $2" == "mcp list" ]]; then
  if [[ "\${OPENCODE_MCP_LIST_FAIL:-0}" == "1" ]]; then
    printf 'mcp-list failed\n' >&2
    exit 1
  fi
  printf '%b' "\${OPENCODE_MCP_LIST_STDOUT:-context7\ngrep_app\nbrave-search\n}"
  exit 0
fi
exit 0
`,
    'utf8',
  );
  await chmod(path.join(binDir, 'opencode'), 0o755);
  await writeExecutable(
    path.join(binDir, 'mcp-server-brave-search'),
    '#!/usr/bin/env bash\nprintf \'brave-search\\n\'\n',
  );

  return {
    root,
    workspace,
    configDir,
    pluginDir,
    skillsRoot,
    skillsDir,
    binDir,
    hostBinDir,
    metadataPath,
    pathEnv: `${binDir}:${hostBinDir}`,
  };
}

async function setRenderedBraveEnabled(fixture, enabled) {
  await writeFile(
    path.join(fixture.configDir, 'opencode.json'),
    JSON.stringify(
      {
        mcp: {
          'brave-search': {
            enabled,
          },
        },
      },
      null,
      2,
    ) + '\n',
  );
}

async function setRenderedConfigRaw(fixture, contents) {
  await writeFile(path.join(fixture.configDir, 'opencode.json'), contents, 'utf8');
}

async function runPreflight(fixture, env = {}) {
  return run('bash', ['scripts/verify-runtime.sh', 'preflight'], {
    cwd: path.resolve('.'),
    env: {
      ...process.env,
      WORKSPACE_DIR: fixture.workspace,
      OPENCODE_CONFIG: path.join(fixture.configDir, 'opencode.json'),
      OPENCODE_CONFIG_DIR: fixture.configDir,
      SUPERPOWERS_SKILLS_DIR: fixture.skillsRoot,
      MCP_VERSIONS_FILE: fixture.metadataPath,
      PATH: fixture.pathEnv,
      ...env,
    },
  });
}

const formattedMcpListOutput = `┌  MCP Servers
│
●  ✓ context7 connected
│      https://mcp.context7.com/mcp
│
●  ✓ grep_app connected
│      https://mcp.grep.app
│
●  ○ brave-search disabled
│      mcp-server-brave-search
│
└  3 server(s)
`;

const formattedEnabledMcpListOutput = `┌  MCP Servers
│
●  ✓ context7 connected
│      https://mcp.context7.com/mcp
│
●  ✓ grep_app connected
│      https://mcp.grep.app
│
●  ✓ brave-search connected
│      mcp-server-brave-search
│
└  3 server(s)
`;

const formattedNearMatchMcpListOutput = `┌  MCP Servers
│
●  ✓ context70 connected
│      https://mcp.context7.com/mcp
│
●  ✓ grep_application connected
│      https://mcp.grep.app
│
●  ✓ xbrave-searchx connected
│      mcp-server-brave-search
│
└  3 server(s)
`;

const ansiFormattedEnabledMcpListOutput = `\u001b[0m
┌  MCP Servers
│
●  ✓ context7 \u001b[90mconnected
│      \u001b[90mhttps://mcp.context7.com/mcp
│
●  ✓ grep_app \u001b[90mconnected
│      \u001b[90mhttps://mcp.grep.app
│
●  ✓ brave-search \u001b[90mconnected
│      \u001b[90mmcp-server-brave-search
│
└  3 server(s)
`;

test('verify-runtime preflight succeeds with exact context7, grep_app, and brave-search entries', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: 'context7 connected\ngrep_app available\nbrave-search ready\n',
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /preflight-ok/);
});

test('verify-runtime preflight fails when python3 is missing', async () => {
  const fixture = await makeRuntimeFixture({ python3: false });
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: 'context7 connected\ngrep_app available\nbrave-search ready\n',
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /python3.*PATH/i);
});

test('verify-runtime preflight fails when pip3 is missing', async () => {
  const fixture = await makeRuntimeFixture({ pip3: false });
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: 'context7 connected\ngrep_app available\nbrave-search ready\n',
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /pip3.*PATH/i);
});

test('verify-runtime preflight fails when python3 venv creation fails', async () => {
  const fixture = await makeRuntimeFixture({ python3VenvSucceeds: false });
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: 'context7 connected\ngrep_app available\nbrave-search ready\n',
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /python3 -m venv/i);
});

test('verify-runtime preflight succeeds when Python runtime commands exist and venv succeeds', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: 'context7 connected\ngrep_app available\nbrave-search ready\n',
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /preflight-ok/);
});

test('verify-runtime preflight succeeds with the real formatted CLI output when Brave is enabled', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: formattedEnabledMcpListOutput,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /preflight-ok/);
});

test('verify-runtime preflight succeeds with formatted CLI output that includes ANSI colors', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: ansiFormattedEnabledMcpListOutput,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /preflight-ok/);
});

test('verify-runtime preflight succeeds when rendered Brave is disabled and mcp list omits brave-search', async () => {
  const fixture = await makeRuntimeFixture();
  await setRenderedBraveEnabled(fixture, false);
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: 'context7\ngrep_app\n',
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /preflight-ok/);
});

test('verify-runtime preflight succeeds when rendered Brave is disabled and mcp list shows brave-search as disabled', async () => {
  const fixture = await makeRuntimeFixture();
  await setRenderedBraveEnabled(fixture, false);
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: 'context7 connected\ngrep_app connected\nbrave-search (disabled)\n',
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /preflight-ok/);
});

test('verify-runtime preflight succeeds when rendered Brave is disabled and mcp list shows the real formatted disabled entry', async () => {
  const fixture = await makeRuntimeFixture();
  await setRenderedBraveEnabled(fixture, false);
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: formattedMcpListOutput,
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /preflight-ok/);
});

test('verify-runtime preflight fails when rendered Brave is disabled but mcp list shows brave-search as enabled', async () => {
  const fixture = await makeRuntimeFixture();
  await setRenderedBraveEnabled(fixture, false);
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: formattedEnabledMcpListOutput,
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /disabled or omitted: brave-search/i);
});

test('verify-runtime preflight succeeds when rendered Brave is disabled even if raw env still has BRAVE_API_KEY', async () => {
  const fixture = await makeRuntimeFixture();
  await setRenderedBraveEnabled(fixture, false);
  const result = await runPreflight(fixture, {
    BRAVE_API_KEY: 'still-present-but-disabled',
    OPENCODE_MCP_LIST_STDOUT: 'context7\ngrep_app\n',
  });

  assert.equal(result.code, 0, result.stderr);
  assert.match(result.stdout, /preflight-ok/);
});

test('verify-runtime preflight fails when opencode mcp list fails', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_FAIL: '1',
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /opencode mcp list failed/i);
});

test('verify-runtime preflight fails when context7 is missing from discovered MCP servers', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: 'grep_app\nbrave-search\n',
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Missing discovered MCP server: context7/);
});

test('verify-runtime preflight fails when grep_app is missing from discovered MCP servers', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: 'context7\nbrave-search\n',
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Missing discovered MCP server: grep_app/);
});

test('verify-runtime preflight fails when rendered Brave is enabled but brave-search is missing from discovered MCP servers', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: 'context7\ngrep_app\n',
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Missing discovered MCP server: brave-search/);
});

test('verify-runtime preflight fails when rendered Brave is enabled but brave-search is only listed as disabled', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: 'context7\ngrep_app\nbrave-search (disabled)\n',
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Missing discovered MCP server: brave-search/);
});

test('verify-runtime preflight fails when rendered config is malformed', async () => {
  const fixture = await makeRuntimeFixture();
  await setRenderedConfigRaw(fixture, '{"mcp":{"brave-search":');
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: 'context7\ngrep_app\n',
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /OpenCode config is unreadable/i);
});

test('verify-runtime preflight fails when rendered config is unreadable', async () => {
  const fixture = await makeRuntimeFixture();
  await chmod(path.join(fixture.configDir, 'opencode.json'), 0o000);

  try {
    const result = await runPreflight(fixture, {
      OPENCODE_MCP_LIST_STDOUT: 'context7\ngrep_app\n',
    });

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /OpenCode config is unreadable/i);
  } finally {
    await chmod(path.join(fixture.configDir, 'opencode.json'), 0o644);
  }
});

test('verify-runtime preflight fails on near-matches instead of exact discovered entries', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: 'context70\ngrep_application\nxbrave-searchx\n',
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Missing discovered MCP server: context7/);
});

test('verify-runtime preflight fails on near-matches in the real formatted CLI output', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    OPENCODE_MCP_LIST_STDOUT: formattedNearMatchMcpListOutput,
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Missing discovered MCP server: context7/);
});

test('verify-runtime preflight fails when workspace is missing', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    WORKSPACE_DIR: path.join(fixture.root, 'missing-workspace'),
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Missing mounted workspace/);
});

test('verify-runtime preflight fails when workspace is read-only', async () => {
  const fixture = await makeRuntimeFixture();
  await chmod(fixture.workspace, 0o555);
  const result = await runPreflight(fixture);

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /not writable/);
});

test('verify-runtime preflight fails when a required port is unavailable', async () => {
  const fixture = await makeRuntimeFixture();
  const server = net.createServer();
  await new Promise((resolve) => server.listen(4096, '0.0.0.0', resolve));

  try {
    const result = await runPreflight(fixture);

    assert.notEqual(result.code, 0);
    assert.match(result.stderr, /Port is unavailable/);
  } finally {
    server.close();
  }
});

test('verify-runtime preflight fails when bundled plugin assets are missing', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    SUPERPOWERS_SKILLS_DIR: path.join(fixture.root, 'missing-skills'),
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Missing bundled Superpowers skills/);
});

test('verify-runtime preflight fails when OCA models are not available through opencode', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    OPENCODE_MODELS_FAIL: '1',
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /does not expose OCA models/);
});

test('verify-runtime preflight fails when Brave MCP binary is missing from PATH', async () => {
  const fixture = await makeRuntimeFixture();
  const opencodeOnlyBinDir = path.join(fixture.root, 'opencode-only-bin');
  await mkdir(opencodeOnlyBinDir, { recursive: true });
  await copyFile(path.join(fixture.binDir, 'opencode'), path.join(opencodeOnlyBinDir, 'opencode'));
  await chmod(path.join(opencodeOnlyBinDir, 'opencode'), 0o755);
  const result = await runPreflight(fixture, {
    PATH: `${opencodeOnlyBinDir}:${process.env.PATH}`,
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /mcp-server-brave-search.*PATH/i);
});

test('verify-runtime preflight fails when Brave MCP metadata file is missing', async () => {
  const fixture = await makeRuntimeFixture();
  const result = await runPreflight(fixture, {
    MCP_VERSIONS_FILE: path.join(fixture.root, 'missing-mcp-versions.json'),
  });

  assert.notEqual(result.code, 0);
  assert.match(result.stderr, /Missing MCP metadata file/i);
});
