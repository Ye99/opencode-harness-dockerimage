import { pathToFileURL } from 'node:url';

const ANSI_PATTERN = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const MCP_ROW_PATTERN = /^(?:[●*+\-]\s+)?(?:([✓○✗x!])\s+)?([a-z0-9_-]+)(?:\s+\(?(.*?)\)?)?$/i;
const DISABLED_STATUS_PATTERN = /\bdisabled\b/i;

export function stripAnsi(text) {
  return text.replace(ANSI_PATTERN, '');
}

export function getMcpDiscoveryStates(output) {
  const states = new Map();

  for (const line of output.split(/\r?\n/).map((entry) => stripAnsi(entry).trim()).filter(Boolean)) {
    const match = line.match(MCP_ROW_PATTERN);
    if (!match) {
      continue;
    }

    const [, , name, statusText = ''] = match;
    const state = DISABLED_STATUS_PATTERN.test(statusText) ? 'disabled' : 'enabled';
    states.set(name, state);
  }

  return states;
}

export function getMcpDiscoveryState(output, serverName) {
  return getMcpDiscoveryStates(output).get(serverName) ?? 'missing';
}

export function assertMcpDiscovery(
  output,
  { requireEnabled = [], requireMissingOrDisabled = [] } = {},
) {
  const states = getMcpDiscoveryStates(output);

  for (const name of requireEnabled) {
    if (states.get(name) !== 'enabled') {
      throw new Error(`Missing discovered MCP server: ${name}`);
    }
  }

  for (const name of requireMissingOrDisabled) {
    const state = states.get(name) ?? 'missing';
    if (!['missing', 'disabled'].includes(state)) {
      throw new Error(`Discovered MCP server must be disabled or omitted: ${name}`);
    }
  }
}

function parseCliArgs(args) {
  const options = {
    requireEnabled: [],
    requireMissingOrDisabled: [],
  };

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];

    if (!value) {
      throw new Error(`Missing value for ${flag}`);
    }

    if (flag === '--require-enabled') {
      options.requireEnabled.push(value);
      index += 1;
      continue;
    }

    if (flag === '--require-missing-or-disabled') {
      options.requireMissingOrDisabled.push(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${flag}`);
  }

  return options;
}

async function readStdin() {
  const chunks = [];

  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const output = await readStdin();

  assertMcpDiscovery(output, options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
