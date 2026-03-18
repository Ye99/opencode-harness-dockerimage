import { readFile, writeFile } from 'node:fs/promises';

const [, , basePath, outputPath] = process.argv;

if (!basePath || !outputPath) {
  console.error('Usage: node scripts/render-opencode-config.mjs <basePath> <outputPath>');
  process.exit(1);
}

const baseConfig = JSON.parse(await readFile(basePath, 'utf8'));
const braveApiKey = process.env.BRAVE_API_KEY?.trim() ?? '';
const permissionJson = process.env.OPENCODE_PERMISSION_JSON?.trim() ?? '';
const config = structuredClone(baseConfig);
const braveConfig = config.mcp?.['brave-search'];

if (permissionJson) {
  let parsedPermission;

  try {
    parsedPermission = JSON.parse(permissionJson);
  } catch {
    console.error('Invalid OPENCODE_PERMISSION_JSON: expected valid JSON');
    process.exit(1);
  }

  if (
    parsedPermission === null ||
    Array.isArray(parsedPermission) ||
    (typeof parsedPermission !== 'object' && typeof parsedPermission !== 'string')
  ) {
    console.error('Invalid OPENCODE_PERMISSION_JSON: expected a JSON object or JSON string');
    process.exit(1);
  }

  config.permission = parsedPermission;
}

if (!braveConfig) {
  console.error('Missing mcp["brave-search"] entry in base config');
  process.exit(1);
}

if (braveApiKey) {
  braveConfig.enabled = true;
  braveConfig.environment = {
    BRAVE_API_KEY: braveApiKey,
  };
} else {
  braveConfig.enabled = false;
  delete braveConfig.environment;
}

await writeFile(outputPath, `${JSON.stringify(config, null, 2)}\n`);
