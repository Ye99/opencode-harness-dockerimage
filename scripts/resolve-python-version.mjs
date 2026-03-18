import { pathToFileURL } from 'node:url';

const PYTHON_DOWNLOADS_URL = 'https://www.python.org/downloads/';
const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const STABLE_VERSION_PATTERN = /Python\s+(\d+\.\d+\.\d+)(?![A-Za-z0-9])/g;

export function normalizeRequestedVersion(value) {
  const normalized = String(value ?? '').trim();

  if (normalized === 'latest-stable' || EXACT_VERSION_PATTERN.test(normalized)) {
    return normalized;
  }

  throw new Error('Invalid Python version: expected latest-stable or X.Y.Z');
}

export function compareVersions(a, b) {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let index = 0; index < 3; index += 1) {
    const diff = aParts[index] - bParts[index];

    if (diff !== 0) {
      return diff;
    }
  }

  return 0;
}

export function parseLatestStableVersion(html) {
  const matches = [...String(html).matchAll(STABLE_VERSION_PATTERN)].map((match) => match[1]);

  if (matches.length === 0) {
    throw new Error('Could not find a stable Python release on python.org/downloads');
  }

  return matches.sort(compareVersions).at(-1);
}

export async function resolvePythonVersion(requested, fetchImpl = fetch) {
  const normalized = normalizeRequestedVersion(requested);

  if (normalized !== 'latest-stable') {
    return normalized;
  }

  let response;

  try {
    response = await fetchImpl(PYTHON_DOWNLOADS_URL);
  } catch (error) {
    throw new Error(`Failed to fetch ${PYTHON_DOWNLOADS_URL}: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response?.ok) {
    const statusText = response?.statusText ? ` ${response.statusText}` : '';
    throw new Error(`Failed to fetch ${PYTHON_DOWNLOADS_URL}: ${response?.status ?? 'unknown'}${statusText}`);
  }

  return parseLatestStableVersion(await response.text());
}

async function main(argv) {
  const requested = argv[2];

  if (!requested) {
    throw new Error('Usage: node scripts/resolve-python-version.mjs <latest-stable|X.Y.Z>');
  }

  const resolved = await resolvePythonVersion(requested);
  process.stdout.write(`${resolved}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main(process.argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
