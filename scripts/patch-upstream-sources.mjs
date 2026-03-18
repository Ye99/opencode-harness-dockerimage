import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const superpowersRoot = process.argv[2];
const authRoot = process.argv[3];

if (!superpowersRoot || !authRoot) {
  console.error('Usage: node scripts/patch-upstream-sources.mjs <superpowers-root> <opencode-oca-auth-root>');
  process.exit(1);
}

async function patchSuperpowers(root) {
  const pluginPath = path.join(root, '.opencode/plugins/superpowers.js');
  let source = await readFile(pluginPath, 'utf8');
  source = source.replace(
    "const superpowersSkillsDir = path.resolve(__dirname, '../../skills');",
    "const configuredSuperpowersSkillsDir = process.env.SUPERPOWERS_SKILLS_DIR ?? '/opt/opencode/skills';\nconst superpowersSkillsDir = path.resolve(configuredSuperpowersSkillsDir, 'superpowers');",
  );
  await writeFile(pluginPath, source, 'utf8');
}

async function patchOcaAuth(root) {
  const oauthPath = path.join(root, 'src/oauth.ts');
  let source = await readFile(oauthPath, 'utf8');
  source = source.replace('hostname: "127.0.0.1",', 'hostname: process.env.OCA_OAUTH_BIND_HOST ?? "127.0.0.1",');
  await writeFile(oauthPath, source, 'utf8');
}

await patchSuperpowers(superpowersRoot);
await patchOcaAuth(authRoot);
