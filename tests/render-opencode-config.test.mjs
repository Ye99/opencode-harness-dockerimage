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

async function renderConfig(baseConfig, braveApiKey) {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'render-opencode-config-'));
  const basePath = path.join(tempDir, 'base.json');
  const outputPath = path.join(tempDir, 'output.json');

  await writeFile(basePath, `${JSON.stringify(baseConfig, null, 2)}\n`);

  const env = { ...process.env };
  if (braveApiKey === undefined) {
    delete env.BRAVE_API_KEY;
  } else {
    env.BRAVE_API_KEY = braveApiKey;
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
      'file:///opt/opencode/plugins/superpowers.js',
    ],
    provider: {
      oca: {
        models: {
          'gpt-5.4': {},
        },
      },
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

test('render leaves brave disabled and omits environment when BRAVE_API_KEY is absent', async () => {
  const result = await renderConfig(makeBaseConfig());

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.config.mcp['brave-search'].enabled, false);
  assert.ok(!('environment' in result.config.mcp['brave-search']));
  assert.match(result.outputText, /\n$/);
});

test('render leaves brave disabled and omits environment when BRAVE_API_KEY is empty', async () => {
  const result = await renderConfig(makeBaseConfig(), '   ');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.config.mcp['brave-search'].enabled, false);
  assert.ok(!('environment' in result.config.mcp['brave-search']));
});

test('render enables brave and injects environment when BRAVE_API_KEY is non-empty', async () => {
  const result = await renderConfig(makeBaseConfig(), '  brave-key  ');

  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.config.mcp['brave-search'].enabled, true);
  assert.deepEqual(result.config.mcp['brave-search'].environment, {
    BRAVE_API_KEY: 'brave-key',
  });
});

test('render preserves the existing top-level config unchanged', async () => {
  const baseConfig = makeBaseConfig();
  const result = await renderConfig(baseConfig, 'brave-key');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.config.model, baseConfig.model);
  assert.deepEqual(result.config.plugin, baseConfig.plugin);
  assert.deepEqual(result.config.provider, baseConfig.provider);
  assert.deepEqual(result.config.server, baseConfig.server);
});

test('render preserves remote MCP entries unchanged', async () => {
  const baseConfig = makeBaseConfig();
  const result = await renderConfig(baseConfig, 'brave-key');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.config.mcp.context7, baseConfig.mcp.context7);
  assert.deepEqual(result.config.mcp.grep_app, baseConfig.mcp.grep_app);
});

test('render keeps the brave command unchanged', async () => {
  const baseConfig = makeBaseConfig();
  const result = await renderConfig(baseConfig, 'brave-key');

  assert.equal(result.code, 0, result.stderr);
  assert.deepEqual(result.config.mcp['brave-search'].command, ['mcp-server-brave-search']);
});
