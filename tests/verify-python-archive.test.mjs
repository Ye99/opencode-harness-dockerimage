import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

const projectRoot = path.resolve(new URL('..', import.meta.url).pathname);
const VERIFY_SCRIPT = path.join(projectRoot, 'scripts/verify-python-archive.sh');

function run(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => { stdout += chunk; });
    child.stderr?.on('data', (chunk) => { stderr += chunk; });
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/**
 * Build a temp directory with fake curl/gpg/cosign stubs on PATH,
 * then run verify_archive via a wrapper script.
 *
 * @param {object} options
 * @param {string} options.curlBehavior - 'asc' | 'sigstore' | 'none' | 'both' — which signature files curl "downloads"
 * @param {boolean} options.gpgVerifySucceeds - whether gpg --verify exits 0
 * @param {boolean} options.cosignAvailable - whether cosign is on PATH
 * @param {boolean} options.cosignVerifySucceeds - whether cosign verify-blob exits 0
 */
async function runVerifyArchive({
  curlBehavior = 'none',
  gpgVerifySucceeds = false,
  cosignAvailable = false,
  cosignVerifySucceeds = false,
} = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'verify-archive-'));
  const binDir = path.join(root, 'bin');
  const archiveDir = path.join(root, 'archives');
  await mkdir(binDir, { recursive: true });
  await mkdir(archiveDir, { recursive: true });

  // Create a fake archive file
  const archivePath = path.join(archiveDir, 'Python-3.14.0.tar.xz');
  await writeFile(archivePath, 'fake-archive-content');

  // Fake curl: writes .asc or .sigstore files based on curlBehavior
  const fakeCurl = `#!/bin/bash
set -euo pipefail
# Parse the output file from -o flag
output_file=""
url=""
for arg in "$@"; do
  if [[ "\${prev:-}" == "-o" ]]; then
    output_file="$arg"
  fi
  prev="$arg"
  # Last non-flag arg could be URL
  if [[ "$arg" != -* && "\${prev2:-}" != "-o" ]]; then
    url="$arg"
  fi
  prev2="\${prev:-}"
done

if [[ -z "$output_file" ]]; then
  exit 1
fi

if [[ "$output_file" == *.asc ]] && [[ "\${CURL_BEHAVIOR}" == "asc" || "\${CURL_BEHAVIOR}" == "both" ]]; then
  printf 'fake-gpg-signature' > "$output_file"
  exit 0
fi

if [[ "$output_file" == *.sigstore ]] && [[ "\${CURL_BEHAVIOR}" == "sigstore" || "\${CURL_BEHAVIOR}" == "both" ]]; then
  printf 'fake-sigstore-bundle' > "$output_file"
  exit 0
fi

# Signature not available — curl fails
exit 22
`;

  // Fake gpg — expects --auto-key-retrieve --verify (no hardcoded keys)
  const fakeGpg = `#!/bin/bash
for arg in "$@"; do
  if [[ "$arg" == "--verify" ]]; then
    if [[ "${gpgVerifySucceeds}" == "true" ]]; then
      exit 0
    else
      exit 1
    fi
  fi
done
exit 0
`;

  // Fake cosign
  const fakeCosign = `#!/bin/bash
if [[ "\${1:-}" == "verify-blob" ]]; then
  if [[ "${cosignVerifySucceeds}" == "true" ]]; then
    exit 0
  else
    exit 1
  fi
fi
exit 0
`;

  await writeFile(path.join(binDir, 'curl'), fakeCurl, { mode: 0o755 });
  await writeFile(path.join(binDir, 'gpg'), fakeGpg, { mode: 0o755 });
  if (cosignAvailable) {
    await writeFile(path.join(binDir, 'cosign'), fakeCosign, { mode: 0o755 });
  }

  // Wrapper script that sources verify-python-archive.sh and calls verify_archive
  const wrapper = `#!/bin/bash
set -euo pipefail
export PYTHON_VERSION="3.14.0"
export ARCHIVE="Python-3.14.0.tar.xz"
export CURL_BEHAVIOR="${curlBehavior}"
source "${VERIFY_SCRIPT}"
verify_archive "${archivePath}"
`;
  const wrapperPath = path.join(root, 'run-verify.sh');
  await writeFile(wrapperPath, wrapper, { mode: 0o755 });

  const result = await run('/bin/bash', [wrapperPath], {
    env: {
      PATH: `${binDir}:/usr/bin:/bin`,
      HOME: root,
    },
  });

  return result;
}

test('verify script contains no hardcoded GPG key fingerprints', async () => {
  const { readFile } = await import('node:fs/promises');
  const script = await readFile(VERIFY_SCRIPT, 'utf8');
  // 40-char hex strings are GPG key fingerprints — should use --auto-key-retrieve instead
  const hardcodedKeys = script.match(/[0-9A-F]{40}/g);
  assert.equal(hardcodedKeys, null, `Found hardcoded GPG keys: ${hardcodedKeys}`);
  assert.match(script, /--auto-key-retrieve/, 'Should use --auto-key-retrieve for automatic key fetching');
});

test('verify_archive prints no-signature warning when neither .asc nor .sigstore available', async () => {
  const result = await runVerifyArchive({ curlBehavior: 'none' });
  assert.equal(result.code, 0);
  assert.match(result.stderr, /WARNING.*No signature found/);
  assert.match(result.stderr, /HTTPS-only trust/);
});

test('verify_archive succeeds with GPG when .asc is available and gpg verifies', async () => {
  const result = await runVerifyArchive({ curlBehavior: 'asc', gpgVerifySucceeds: true });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /GPG signature verified/);
});

test('verify_archive warns on GPG failure then falls through to no-signature', async () => {
  const result = await runVerifyArchive({ curlBehavior: 'asc', gpgVerifySucceeds: false });
  assert.equal(result.code, 0);
  assert.match(result.stderr, /WARNING.*GPG verification failed/);
  assert.match(result.stderr, /WARNING.*No signature found/);
});

test('verify_archive succeeds with Sigstore when .sigstore available and cosign verifies', async () => {
  const result = await runVerifyArchive({
    curlBehavior: 'sigstore',
    cosignAvailable: true,
    cosignVerifySucceeds: true,
  });
  assert.equal(result.code, 0);
  assert.match(result.stdout, /Sigstore bundle verified/);
});

test('verify_archive warns when Sigstore bundle found but cosign not available', async () => {
  const result = await runVerifyArchive({
    curlBehavior: 'sigstore',
    cosignAvailable: false,
  });
  assert.equal(result.code, 0);
  assert.match(result.stderr, /cosign not available/);
});

test('verify_archive warns on cosign failure', async () => {
  const result = await runVerifyArchive({
    curlBehavior: 'sigstore',
    cosignAvailable: true,
    cosignVerifySucceeds: false,
  });
  assert.equal(result.code, 0);
  assert.match(result.stderr, /WARNING.*Sigstore verification failed/);
});

test('verify_archive falls through from GPG failure to Sigstore success', async () => {
  const result = await runVerifyArchive({
    curlBehavior: 'both',
    gpgVerifySucceeds: false,
    cosignAvailable: true,
    cosignVerifySucceeds: true,
  });
  assert.equal(result.code, 0);
  assert.match(result.stderr, /WARNING.*GPG verification failed/);
  assert.match(result.stdout, /Sigstore bundle verified/);
});
