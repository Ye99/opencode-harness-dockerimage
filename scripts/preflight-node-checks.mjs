import net from 'node:net';
import { readFileSync } from 'node:fs';

const errors = [];

function checkPort(hostPort) {
  const [host, portStr] = hostPort.split(':');
  const port = Number(portStr);

  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => {
      errors.push(`Port is unavailable: ${host}:${port}`);
      resolve();
    });
    server.once('listening', () => server.close(() => resolve()));
    server.listen(port, host);
  });
}

function checkMcpMetadata(filePath, packageName) {
  try {
    const metadata = JSON.parse(readFileSync(filePath, 'utf8'));
    const version = metadata?.dependencies?.[packageName]?.version;

    if (typeof version !== 'string' || version.length === 0) {
      errors.push(`Missing Brave MCP version metadata: ${filePath}`);
    }
  } catch {
    errors.push(`Missing MCP metadata file: ${filePath}`);
  }
}

function readBraveEnabled(configPath) {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    return config?.mcp?.['brave-search']?.enabled === true;
  } catch {
    errors.push(`OpenCode config is unreadable or malformed: ${configPath}`);
    return false;
  }
}

const args = process.argv.slice(2);
const ports = [];
let mcpFile = '';
let mcpPackage = '';
let configPath = '';

for (let i = 0; i < args.length; i += 1) {
  switch (args[i]) {
    case '--check-port':
      if (++i >= args.length) {
        errors.push('Missing value for --check-port');
        break;
      }
      ports.push(args[i]);
      break;
    case '--mcp-metadata':
      if (++i >= args.length) {
        errors.push('Missing value for --mcp-metadata: expected <file> <package>');
        break;
      }
      mcpFile = args[i];
      if (++i >= args.length) {
        errors.push('Missing package name for --mcp-metadata: expected <file> <package>');
        break;
      }
      mcpPackage = args[i];
      break;
    case '--config':
      if (++i >= args.length) {
        errors.push('Missing value for --config');
        break;
      }
      configPath = args[i];
      break;
  }
}

await Promise.all(ports.map(checkPort));

if (mcpFile) {
  checkMcpMetadata(mcpFile, mcpPackage);
}

let braveEnabled = false;

if (configPath) {
  braveEnabled = readBraveEnabled(configPath);
}

if (errors.length > 0) {
  for (const error of errors) {
    process.stderr.write(`${error}\n`);
  }
  process.exit(1);
}

process.stdout.write(braveEnabled ? 'enabled' : 'disabled');
