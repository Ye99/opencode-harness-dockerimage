import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run } from './helpers/run.mjs';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);

const REAL_BASE_CONFIG = JSON.parse(
  await readFile(new URL('../config/opencode.json', import.meta.url), 'utf8'),
);

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
  return structuredClone(REAL_BASE_CONFIG);
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

test('render fails fast when OPENCODE_PERMISSION_JSON parses to null', async () => {
  const result = await renderConfig(makeBaseConfig(), {
    permissionJson: 'null',
  });

  assert.equal(result.code, 1);
  assert.equal(result.config, undefined);
  assert.match(result.stderr, /OPENCODE_PERMISSION_JSON/);
  assert.match(result.stderr, /object or JSON string/i);
});

test('render fails fast when OPENCODE_PERMISSION_JSON parses to an array', async () => {
  const result = await renderConfig(makeBaseConfig(), {
    permissionJson: '["allow"]',
  });

  assert.equal(result.code, 1);
  assert.equal(result.config, undefined);
  assert.match(result.stderr, /OPENCODE_PERMISSION_JSON/);
  assert.match(result.stderr, /object or JSON string/i);
});

test('render fails when required CLI args are missing', async () => {
  const result = await run(process.execPath, ['scripts/render-opencode-config.mjs'], {
    cwd: projectRoot,
  });

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Usage/);
});

test('render fails when base config file is missing', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'render-opencode-config-'));
  const outputPath = path.join(tempDir, 'output.json');
  const result = await run(
    process.execPath,
    ['scripts/render-opencode-config.mjs', path.join(tempDir, 'nonexistent.json'), outputPath],
    { cwd: projectRoot },
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Cannot read base config/);
});

test('render fails when base config is invalid JSON', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'render-opencode-config-'));
  const basePath = path.join(tempDir, 'base.json');
  const outputPath = path.join(tempDir, 'output.json');
  await writeFile(basePath, '{not valid json}');
  const result = await run(
    process.execPath,
    ['scripts/render-opencode-config.mjs', basePath, outputPath],
    { cwd: projectRoot },
  );

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Cannot read base config/);
});

test('render fails when base config lacks brave-search MCP entry', async () => {
  const config = makeBaseConfig();
  delete config.mcp['brave-search'];
  const result = await renderConfig(config);

  assert.equal(result.code, 1);
  assert.match(result.stderr, /Missing mcp\["brave-search"\]/);
});

test('render sets output file permissions to 0600', async () => {
  const result = await renderConfig(makeBaseConfig());

  assert.equal(result.code, 0, result.stderr);
  const stats = await stat(result.outputPath);
  assert.equal(stats.mode & 0o777, 0o600);
});
