import { readFile } from 'node:fs/promises';
import path from 'node:path';

const [lockPath, authRoot, superpowersRoot] = process.argv.slice(2);

if (!lockPath || !authRoot || !superpowersRoot) {
  console.error('Usage: node scripts/validate-sources-lock.mjs <lock-path> <opencode-oca-auth-root> <superpowers-root>');
  process.exit(1);
}

let lock;

try {
  lock = JSON.parse(await readFile(lockPath, 'utf8'));
} catch (error) {
  console.error(`Cannot read sources lock file: ${lockPath}: ${error.message}`);
  process.exit(1);
}

if (!lock.opencodeOcaAuth?.revision) {
  console.error('sources.lock.json missing required key: opencodeOcaAuth.revision');
  process.exit(1);
}

if (!lock.superpowers?.revision) {
  console.error('sources.lock.json missing required key: superpowers.revision');
  process.exit(1);
}

let authRevision;

try {
  authRevision = (await readFile(path.join(authRoot, '.source-revision'), 'utf8')).trim();
} catch (error) {
  console.error(`Cannot read opencode-oca-auth .source-revision: ${error.message}`);
  process.exit(1);
}

let superpowersRevision;

try {
  superpowersRevision = (await readFile(path.join(superpowersRoot, '.source-revision'), 'utf8')).trim();
} catch (error) {
  console.error(`Cannot read superpowers .source-revision: ${error.message}`);
  process.exit(1);
}

if (lock.opencodeOcaAuth.revision !== authRevision) {
  console.error('opencode-oca-auth vendor tree does not match sources.lock.json');
  process.exit(1);
}

if (lock.superpowers.revision !== superpowersRevision) {
  console.error('superpowers vendor tree does not match sources.lock.json');
  process.exit(1);
}

console.log('validate-sources-lock-ok');
