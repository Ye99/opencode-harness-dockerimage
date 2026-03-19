import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

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

async function renderConfig(baseConfig, options = {}) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'render-opencode-config-'));
  const basePath = path.join(tempDir, 'base.json');
  const outputPath = path.join(tempDir, 'output.json');

  await writeFile(basePath, `${JSON.stringify(baseConfig, null, 2)}\n`);

  const env = { ...process.env };
  if (options.braveApiKey === undefined) {
    delete env.BRAVE_API_KEY;
  } else {
    env.BRAVE_API_KEY = options.braveApiKey;
  }

  if (options.permissionJson === undefined) {
    delete env.OPENCODE_PERMISSION_JSON;
  } else {
    env.OPENCODE_PERMISSION_JSON = options.permissionJson;
  }

  const result = await run(process.execPath, ['scripts/render-opencode-config.mjs', basePath, outputPath], {
    cwd: projectRoot,
    env,
  });

  let outputText;
  let config;
  try {
    outputText = await readFile(outputPath, 'utf8');
    config = JSON.parse(outputText);
  } catch {
    outputText = undefined;
    config = undefined;
  }

  return {
    ...result,
    outputPath,
    config,
    outputText,
  };
}

function makeBaseConfig() {
  return {
    $schema: 'https://opencode.ai/config.json',
    model: 'oca/gpt-5.4',
    server: {
      port: 4096,
      hostname: '0.0.0.0',
    },
    plugin: [
      'file:///opt/opencode/plugins/opencode-oca-auth',
      'file:///opt/opencode/plugins/superpowers',
    ],
    provider: {
      oca: {
        models: {
          'gpt-5.4': {},
        },
      },
    },
    permission: {
      read: {
        '*': 'allow',
        '*.env': 'deny',
        '*.env.*': 'deny',
        '*.env.example': 'allow',
      },
      edit: 'allow',
      glob: 'allow',
      grep: 'allow',
      list: 'allow',
      bash: {
        '*': 'allow',
        'git push': 'ask',
        'git push *': 'ask',
        'git push *--force*': 'deny',
        'git push *--mirror*': 'deny',
        'git clean': 'ask',
        'git reset --hard*': 'ask',
        'git clean *': 'ask',
        rm: 'ask',
        'rm *': 'ask',
        'rm -rf /': 'deny',
        'rm -rf /*': 'deny',
        'rm -rf ~': 'deny',
        'rm -rf ~/*': 'deny',
        sudo: 'deny',
        'sudo *': 'deny',
      },
      task: 'allow',
      skill: 'allow',
      lsp: 'allow',
      todoread: 'allow',
      todowrite: 'allow',
      webfetch: 'allow',
      websearch: 'allow',
      codesearch: 'allow',
      external_directory: 'ask',
      doom_loop: 'ask',
    },
    mcp: {
      context7: {
        type: 'remote',
        url: 'https://mcp.context7.com/mcp',
        enabled: true,
      },
      grep_app: {
        type: 'remote',
        url: 'https://mcp.grep.app',
        enabled: true,
      },
      'brave-search': {
        type: 'local',
        command: ['mcp-server-brave-search'],
        enabled: false,
      },
    },
  };
}

test('render fixture keeps exact bare-command bash guardrails alongside wildcard rules', () => {
  const bashPermission = makeBaseConfig().permission.bash;

  assert.equal(bashPermission['git push'], 'ask');
  assert.equal(bashPermission['git push *'], 'ask');
  assert.equal(bashPermission['git clean'], 'ask');
  assert.equal(bashPermission['git clean *'], 'ask');
  assert.equal(bashPermission.rm, 'ask');
  assert.equal(bashPermission['rm *'], 'ask');
  assert.equal(bashPermission.sudo, 'deny');
  assert.equal(bashPermission['sudo *'], 'deny');
});

test('render leaves brave disabled and omits environment when BRAVE_API_KEY is absent', async () => {
  const result = await renderConfig(makeBaseConfig());

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.config.mcp['brave-search'].enabled, false);
  assert.ok(!('environment' in result.config.mcp['brave-search']));
  assert.match(result.outputText, /\n$/);
});

test('render leaves brave disabled and omits environment when BRAVE_API_KEY is empty', async () => {
  const result = await renderConfig(makeBaseConfig(), { braveApiKey: '   ' });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.config.mcp['brave-search'].enabled, false);
  assert.ok(!('environment' in result.config.mcp['brave-search']));
});

test('render enables brave and injects environment when BRAVE_API_KEY is non-empty', async () => {
  const result = await renderConfig(makeBaseConfig(), { braveApiKey: '  brave-key  ' });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.config.mcp['brave-search'].enabled, true);
  assert.deepEqual(result.config.mcp['brave-search'].environment, {
    BRAVE_API_KEY: 'brave-key',
  });
});

test('render preserves the existing top-level config unchanged', async () => {
  const baseConfig = makeBaseConfig();
  const result = await renderConfig(baseConfig, { braveApiKey: 'brave-key' });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.config.model, baseConfig.model);
  assert.deepEqual(result.config.plugin, baseConfig.plugin);
  assert.deepEqual(result.config.provider, baseConfig.provider);
  assert.deepEqual(result.config.permission, baseConfig.permission);
  assert.deepEqual(result.config.server, baseConfig.server);
});

test('render preserves remote MCP entries unchanged', async () => {
  const baseConfig = makeBaseConfig();
  const result = await renderConfig(baseConfig, { braveApiKey: 'brave-key' });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.config.mcp.context7, baseConfig.mcp.context7);
  assert.deepEqual(result.config.mcp.grep_app, baseConfig.mcp.grep_app);
});

test('render keeps the brave command unchanged', async () => {
  const baseConfig = makeBaseConfig();
  const result = await renderConfig(baseConfig, { braveApiKey: 'brave-key' });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.config.mcp['brave-search'].command, ['mcp-server-brave-search']);
});

test('render preserves baked permission when OPENCODE_PERMISSION_JSON is absent', async () => {
  const baseConfig = makeBaseConfig();
  const result = await renderConfig(baseConfig);

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.config.permission, baseConfig.permission);
});

test('render preserves baked permission when OPENCODE_PERMISSION_JSON is empty', async () => {
  const baseConfig = makeBaseConfig();
  const result = await renderConfig(baseConfig, {
    permissionJson: '',
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.config.permission, baseConfig.permission);
});

test('render preserves baked permission when OPENCODE_PERMISSION_JSON is whitespace', async () => {
  const baseConfig = makeBaseConfig();
  const result = await renderConfig(baseConfig, {
    permissionJson: '   ',
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.config.permission, baseConfig.permission);
});

test('render replaces permission when OPENCODE_PERMISSION_JSON is a valid object', async () => {
  const result = await renderConfig(makeBaseConfig(), {
    permissionJson: JSON.stringify({
      edit: 'ask',
      bash: 'deny',
    }),
  });

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.config.permission, {
    edit: 'ask',
    bash: 'deny',
  });
});

test('render accepts JSON string permission overrides', async () => {
  const result = await renderConfig(makeBaseConfig(), {
    permissionJson: '"allow"',
  });

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.config.permission, 'allow');
});

test('render fails fast when OPENCODE_PERMISSION_JSON is invalid JSON', async () => {
  const result = await renderConfig(makeBaseConfig(), {
    permissionJson: '{not valid json}',
  });

  assert.equal(result.code, 1);
  assert.equal(result.config, undefined);
  assert.match(result.stderr, /OPENCODE_PERMISSION_JSON/);
  assert.match(result.stderr, /valid JSON/i);
});

test('render fails fast when OPENCODE_PERMISSION_JSON parses to an invalid type', async () => {
  const result = await renderConfig(makeBaseConfig(), {
    permissionJson: 'true',
  });

  assert.equal(result.code, 1);
  assert.equal(result.config, undefined);
  assert.match(result.stderr, /OPENCODE_PERMISSION_JSON/);
  assert.match(result.stderr, /object or JSON string/i);
});
