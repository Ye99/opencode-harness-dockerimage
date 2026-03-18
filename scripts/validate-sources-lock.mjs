import { readFile } from 'node:fs/promises';
import path from 'node:path';

const [lockPath, authRoot, superpowersRoot] = process.argv.slice(2);

if (!lockPath || !authRoot || !superpowersRoot) {
  console.error('Usage: node scripts/validate-sources-lock.mjs <lock-path> <opencode-oca-auth-root> <superpowers-root>');
  process.exit(1);
}

const lock = JSON.parse(await readFile(lockPath, 'utf8'));
const authRevision = (await readFile(path.join(authRoot, '.source-revision'), 'utf8')).trim();
const superpowersRevision = (await readFile(path.join(superpowersRoot, '.source-revision'), 'utf8')).trim();

if (lock.opencodeOcaAuth?.revision !== authRevision) {
  console.error('opencode-oca-auth vendor tree does not match sources.lock.json');
  process.exit(1);
}

if (lock.superpowers?.revision !== superpowersRevision) {
  console.error('superpowers vendor tree does not match sources.lock.json');
  process.exit(1);
}

console.log('validate-sources-lock-ok');
