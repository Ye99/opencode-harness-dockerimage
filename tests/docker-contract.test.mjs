import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';

async function readText(relativePath) {
  return readFile(new URL(relativePath, import.meta.url), 'utf8');
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

async function pathExists(relativePath) {
  try {
    await access(new URL(relativePath, import.meta.url));
    return true;
  } catch {
    return false;
  }
}

function normalizeWhitespace(text) {
  return text.replace(/\s+/g, ' ').trim();
}

test('Dockerfile installs opencode-ai 1.2.27 and declares the required env contract', async () => {
  const dockerfile = await readText('../Dockerfile');
  assert.match(dockerfile, /opencode-ai@1\.2\.27/);
  assert.match(dockerfile, /OPENCODE_CONFIG=/);
  assert.match(dockerfile, /OCA_OAUTH_CALLBACK_PORT=48801/);
  assert.match(dockerfile, /SUPERPOWERS_SKILLS_DIR=\/opt\/opencode\/skills\b/);
});

test('Dockerfile packages the base template, render helper, and Brave MCP metadata', async () => {
  const dockerfile = await readText('../Dockerfile');

  assert.match(dockerfile, /COPY config\/opencode\.json \/opt\/opencode\/opencode\.base\.json/);
  assert.match(dockerfile, /COPY scripts\/check-mcp-discovery\.mjs \/opt\/opencode\/scripts\/check-mcp-discovery\.mjs/);
  assert.match(dockerfile, /COPY scripts\/render-opencode-config\.mjs \/opt\/opencode\/scripts\/render-opencode-config\.mjs/);
  assert.match(dockerfile, /rm -rf \/var\/lib\/apt\/lists\/\*/);
  assert.match(dockerfile, /mkdir -p \/opt\/opencode/);
  assert.match(dockerfile, /npm install -g [^\n]*opencode-ai@1\.2\.27/);
  assert.match(dockerfile, /npm install -g [^\n]*@modelcontextprotocol\/server-brave-search@latest/);
  assert.match(dockerfile, /npm ls -g @modelcontextprotocol\/server-brave-search --json --depth=0 > \/opt\/opencode\/mcp-versions\.json/);
});

test('verify-runtime validates the packaged Brave MCP metadata contract', async () => {
  const verifyRuntime = await readText('../scripts/verify-runtime.sh');

  assert.match(verifyRuntime, /MCP_VERSIONS_FILE=.*\/opt\/opencode\/mcp-versions\.json/);
  assert.match(verifyRuntime, /@modelcontextprotocol\/server-brave-search/);
});

test('config/opencode.json keeps the base OpenCode server and plugin contract', async () => {
  const config = await readJson('../config/opencode.json');

  assert.equal(config.$schema, 'https://opencode.ai/config.json');
  assert.equal(config.model, 'oca/gpt-5.4');
  assert.equal(config.server?.port, 4096);
  assert.equal(config.server?.hostname, '0.0.0.0');
  assert.deepEqual(config.plugin, [
    'file:///opt/opencode/plugins/opencode-oca-auth',
    'file:///opt/opencode/plugins/superpowers.js',
  ]);
  assert.deepEqual(config.provider?.oca?.models?.['gpt-5.4'], {});
});

test('config/opencode.json keeps the remote MCP discovery entries enabled', async () => {
  const config = await readJson('../config/opencode.json');

  assert.deepEqual(config.mcp?.context7, {
    type: 'remote',
    url: 'https://mcp.context7.com/mcp',
    enabled: true,
  });
  assert.deepEqual(config.mcp?.grep_app, {
    type: 'remote',
    url: 'https://mcp.grep.app',
    enabled: true,
  });
});

test('config/opencode.json keeps Brave MCP local and disabled by default', async () => {
  const config = await readJson('../config/opencode.json');

  assert.equal(config.mcp?.['brave-search']?.type, 'local');
  assert.deepEqual(config.mcp?.['brave-search']?.command, ['mcp-server-brave-search']);
  assert.equal(config.mcp?.['brave-search']?.enabled, false);
});

test('vendor/sources.lock.json records both upstream repos and pinned revisions', async () => {
  const lock = await readJson('../vendor/sources.lock.json');

  assert.equal(lock.opencodeOcaAuth.repo, 'https://github.com/Ye99/opencode-oca-auth');
  assert.match(lock.opencodeOcaAuth.revision, /^[0-9a-f]{7,40}$/);
  assert.equal(lock.superpowers.repo, 'https://github.com/obra/superpowers');
  assert.match(lock.superpowers.revision, /^[0-9a-f]{7,40}$/);
});

test('Docker build validates vendor sources against sources.lock.json', async () => {
  const dockerfile = await readText('../Dockerfile');
  const validator = await readText('../scripts/validate-sources-lock.mjs');

  assert.match(dockerfile, /validate-sources-lock\.mjs/);
  assert.match(validator, /sources\.lock\.json/);
  assert.match(validator, /\.source-revision/);
});

test('README documents the shared image tag and reusable container run flow', async () => {
  const readme = await readText('../README.md');

  assert.match(readme, /opencode-harness\b/);
  assert.doesNotMatch(readme, /dc-opencode-harness\b/);
  assert.doesNotMatch(readme, /dc-opencode-harness:dev/);
  assert.match(readme, /<host-project-workspace>:\/workspace/);
  assert.doesNotMatch(readme, /docker run --rm -it/);
  assert.match(readme, /docker run -it/);
  assert.match(readme, /--name opencode-harness/);
  assert.match(readme, /docker start -ai opencode-harness/);
});

test('README documents OAuth login and verification commands for operators', async () => {
  const readme = await readText('../README.md');

  assert.match(readme, /docker exec -it opencode-harness opencode auth login/);
  assert.match(readme, /http:\/\/127\.0\.0\.1:4096/);
  assert.match(readme, /docker exec -it opencode-harness opencode debug config/);
  assert.match(readme, /docker exec -it opencode-harness opencode mcp list/);
  assert.match(readme, /docker exec -it opencode-harness opencode models oca/);
  assert.match(readme, /docker exec -it opencode-harness opencode -m oca\/gpt-5\.4 run "/);
});

test('README documents the optional auth-state backup mount and ignore rules', async () => {
  const readme = await readText('../README.md');
  const gitignore = await readText('../.gitignore');
  const dockerignore = await readText('../.dockerignore');
  const normalizedReadme = normalizeWhitespace(readme);

  assert.match(readme, /mkdir -p \.opencode-state/);
  assert.match(readme, /\.\/\.opencode-state:\/root\/\.local\/share\/opencode/);
  assert.match(normalizedReadme, /if you delete the container, you must run .*opencode auth login.* again/i);
  assert.match(normalizedReadme, /unless you reuse the optional `?\.\/\.opencode-state`? backup mount/i);
  assert.match(gitignore, /^\.opencode-state\/$/m);
  assert.match(dockerignore, /^\.opencode-state\/$/m);
});

test('README documents the Brave env workflow and disabled-by-default fallback', async () => {
  const readme = await readText('../README.md');
  const normalizedReadme = normalizeWhitespace(readme);

  assert.match(readme, /docker run -it/);
  assert.match(readme, /-e BRAVE_API_KEY/);
  assert.match(normalizedReadme, /obtain a Brave Search API key/i);
  assert.match(readme, /export BRAVE_API_KEY=/);
  assert.match(normalizedReadme, /if `?BRAVE_API_KEY`? is unset, the container still starts/i);
  assert.match(normalizedReadme, /`?brave-search`? disabled/i);
});

test('vendor trees include both pinned upstream source snapshots', async () => {
  const authPkg = await readJson('../vendor/opencode-oca-auth/package.json');
  const superpowersPkg = await readJson('../vendor/superpowers/package.json');
  const authRevision = await readText('../vendor/opencode-oca-auth/.source-revision');
  const superpowersRevision = await readText('../vendor/superpowers/.source-revision');

  assert.equal(authPkg.name, 'opencode-oca-auth');
  assert.equal(superpowersPkg.name, 'superpowers');
  assert.equal(superpowersPkg.main, '.opencode/plugins/superpowers.js');
  assert.match(authRevision.trim(), /^[0-9a-f]{7,40}$/);
  assert.match(superpowersRevision.trim(), /^[0-9a-f]{7,40}$/);
});

test('entrypoint invokes the packaged verify-runtime script from the image path', async () => {
  const entrypoint = await readText('../scripts/opencode-harness-entrypoint');
  assert.match(entrypoint, /\/opt\/opencode\/scripts\/verify-runtime\.sh/);
});

test('entrypoint renders the live config before preflight and then supervises opencode web', async () => {
  const entrypoint = await readText('../scripts/opencode-harness-entrypoint');
  const mkdirIndex = entrypoint.indexOf('mkdir -p "$(dirname "$OPENCODE_CONFIG")"');
  const renderIndex = entrypoint.indexOf('node "/opt/opencode/scripts/render-opencode-config.mjs" "/opt/opencode/opencode.base.json" "$OPENCODE_CONFIG"');
  const preflightIndex = entrypoint.indexOf('bash "/opt/opencode/scripts/verify-runtime.sh" preflight');
  const startupIndex = entrypoint.indexOf('opencode web --hostname "$OPENCODE_SERVER_HOST" --port "$OPENCODE_SERVER_PORT"');

  assert.match(entrypoint, /mkdir -p "\$\(dirname "\$OPENCODE_CONFIG"\)"/);
  assert.match(entrypoint, /node "\/opt\/opencode\/scripts\/render-opencode-config\.mjs" "\/opt\/opencode\/opencode\.base\.json" "\$OPENCODE_CONFIG"/);
  assert.match(entrypoint, /AUTH_FILE=/);
  assert.match(entrypoint, /while true; do/);
  assert.match(entrypoint, /auth-change-restart/);
  assert.match(entrypoint, /setsid opencode web --hostname "\$OPENCODE_SERVER_HOST" --port "\$OPENCODE_SERVER_PORT"/);
  assert.notEqual(mkdirIndex, -1);
  assert.notEqual(renderIndex, -1);
  assert.notEqual(preflightIndex, -1);
  assert.notEqual(startupIndex, -1);
  assert.ok(mkdirIndex < renderIndex);
  assert.ok(renderIndex < preflightIndex);
  assert.ok(preflightIndex < startupIndex);
});

test('smoke-mcp-runtime rebuilds the image and cleans up test containers', async () => {
  const smokeScript = await readText('../scripts/smoke-mcp-runtime.sh');

  assert.match(smokeScript, /BRAVE_API_KEY_DUMMY=/);
  assert.match(smokeScript, /docker build --pull --no-cache -t "\$IMAGE_TAG" \./);
  assert.match(smokeScript, /--network none/);
  assert.match(smokeScript, /trap\s+['"].*cleanup/);
  assert.match(smokeScript, /docker rm -f/);
});

test('smoke-mcp-runtime checks the packaged Brave MCP binary and metadata version', async () => {
  const smokeScript = await readText('../scripts/smoke-mcp-runtime.sh');

  assert.match(smokeScript, /command -v mcp-server-brave-search/);
  assert.match(smokeScript, /npm ls -g @modelcontextprotocol\/server-brave-search --depth=0/);
  assert.match(smokeScript, /mcp-versions\.json/);
  assert.match(smokeScript, /Brave MCP version mismatch:/);
});

test('smoke-mcp-runtime verifies rendered Brave state against discovered MCP output', async () => {
  const smokeScript = await readText('../scripts/smoke-mcp-runtime.sh');

  assert.match(smokeScript, /opencode mcp list/);
  assert.match(smokeScript, /check-mcp-discovery\.mjs/);
  assert.match(smokeScript, /--require-enabled context7/);
  assert.match(smokeScript, /--require-enabled grep_app/);
  assert.match(smokeScript, /--require-missing-or-disabled brave-search/);
  assert.match(smokeScript, /--require-enabled brave-search/);
  assert.match(smokeScript, /Rendered brave-search enabled\/key mismatch:/);
  assert.match(smokeScript, /Rendered brave-search state mismatch:/);
});

test('smoke-mcp-runtime validates the packaged startup path instead of overriding the entrypoint', async () => {
  const smokeScript = await readText('../scripts/smoke-mcp-runtime.sh');

  assert.doesNotMatch(smokeScript, /--entrypoint bash/);
  assert.match(smokeScript, /docker inspect -f '\{\{\.State.Status\}\}'/);
  assert.match(smokeScript, /docker logs/);
  assert.match(smokeScript, /exec_checks/);
});

test('smoke-mcp-runtime starts Brave with only the API key in a clean env', async () => {
  const smokeScript = await readText('../scripts/smoke-mcp-runtime.sh');
  const envLine = smokeScript.match(/env -i[^\n]*/)?.[0];

  assert.ok(envLine, 'expected smoke script to launch Brave via env -i');
  assert.match(envLine, /BRAVE_API_KEY="\$BRAVE_API_KEY"/);
  const passedThroughEnvNames = [...envLine.matchAll(/\b([A-Z_][A-Z0-9_]*)=/g)].map(([, name]) => name);
  assert.deepEqual(passedThroughEnvNames, ['BRAVE_API_KEY']);
  assert.doesNotMatch(smokeScript, /env -i [^\n]*(PATH|HOME)=/);
});

test('smoke-mcp-runtime accepts either a timeout hold-open or a Brave startup banner', async () => {
  const smokeScript = await readText('../scripts/smoke-mcp-runtime.sh');

  assert.match(smokeScript, /Brave Search MCP Server running on stdio/);
  assert.match(smokeScript, /if \[\[ "\$status" -ne 124 \]\] && ! grep -Fq 'Brave Search MCP Server running on stdio' \/tmp\/brave-startup\.txt; then/);
});

test('smoke-mcp-runtime verifies the packaged Python runtime commands and resolved version marker', async () => {
  const smokeScript = await readText('../scripts/smoke-mcp-runtime.sh');

  assert.match(smokeScript, /command -v python3 >\/dev\/null/);
  assert.match(smokeScript, /command -v python >\/dev\/null/);
  assert.match(smokeScript, /command -v pip3 >\/dev\/null/);
  assert.match(smokeScript, /command -v pip >\/dev\/null/);
  assert.match(smokeScript, /test -f \/opt\/opencode\/python-version\.txt/);
  assert.match(smokeScript, /resolved_python_version="\$\(tr -d '\\n' <\/opt\/opencode\/python-version\.txt\)"/);
  assert.match(smokeScript, /python3 --version >/);
  assert.match(smokeScript, /python --version >/);
  assert.match(smokeScript, /pip3 --version >/);
  assert.match(smokeScript, /pip --version >/);
  assert.match(smokeScript, /python3 - <<'PY'/);
  assert.match(smokeScript, /python - <<'PY'/);
  assert.match(smokeScript, /python3 -m pip --version >/);
  assert.match(smokeScript, /python -m pip --version >/);
  assert.match(smokeScript, /mktemp -d/);
  assert.match(smokeScript, /python3 -m venv "\$venv_root\/python3-venv"/);
  assert.match(smokeScript, /python -m venv "\$venv_root\/python-venv"/);
  assert.match(smokeScript, /sys\.version\.startswith\(resolved_version\)/);
  assert.match(smokeScript, /sys\.executable/);
});

test('smoke-mcp-runtime always validates remote MCP discovery, independent of smoke state names', async () => {
  const smokeScript = await readText('../scripts/smoke-mcp-runtime.sh');

  assert.match(smokeScript, /--require-enabled context7/);
  assert.match(smokeScript, /--require-enabled grep_app/);
  assert.doesNotMatch(smokeScript, /REMOTE_DISCOVERY_EXPECTED=/);
  assert.doesNotMatch(smokeScript, /SMOKE_STATE_NAME" == \*-online/);
});

test('smoke-mcp-runtime exercises keyed and no-key Brave states with and without egress', async () => {
  const smokeScript = await readText('../scripts/smoke-mcp-runtime.sh');

  for (const invocation of [
    'run_state keyed-online bridge true',
    'run_state no-key-online bridge false',
    'run_state keyed-no-egress none true',
    'run_state no-key-no-egress none false',
  ]) {
    assert.match(smokeScript, new RegExp(invocation.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('Dockerfile builds Python in dedicated resolver and builder stages, then ships only the runtime contract', async () => {
  const dockerfile = await readText('../Dockerfile');

  assert.match(dockerfile, /^ARG PYTHON_VERSION=latest-stable$/m);
  assert.match(dockerfile, /^FROM node:22-slim AS python-version-resolver$/m);
  assert.match(dockerfile, /^FROM node:22-slim AS python-builder$/m);
  assert.match(dockerfile, /^FROM node:22-slim$/m);
  assert.match(dockerfile, /COPY scripts\/resolve-python-version\.mjs \/opt\/opencode\/scripts\/resolve-python-version\.mjs/);
  assert.match(dockerfile, /COPY scripts\/install-python-runtime\.sh \/opt\/opencode\/scripts\/install-python-runtime\.sh/);
  assert.match(dockerfile, /\/opt\/opencode\/python-version\.txt/);
  assert.match(dockerfile, /\/usr\/local\/bin\/python3/);
  assert.match(dockerfile, /\/usr\/local\/bin\/python\b/);
  assert.match(dockerfile, /\/usr\/local\/bin\/pip3/);
  assert.match(dockerfile, /\/usr\/local\/bin\/pip\b/);
});

test('Python runtime installer script builds CPython into /opt/python for the final image handoff', async () => {
  assert.equal(await pathExists('../scripts/install-python-runtime.sh'), true);

  const installer = await readText('../scripts/install-python-runtime.sh');

  assert.match(installer, /PREFIX=\/opt\/python/);
  assert.match(installer, /Python-\$\{PYTHON_VERSION\}\.tar\.xz/);
  assert.match(installer, /\.\/configure --prefix="\$PREFIX"/);
  assert.match(installer, /make -j"\$\(nproc\)"/);
  assert.match(installer, /make install/);
  assert.match(installer, /rm -rf "\$PREFIX\/share"/);
  assert.match(installer, /rm -f "\$PREFIX"\/bin\/2to3\* "\$PREFIX"\/bin\/idle3\* "\$PREFIX"\/bin\/pydoc3\* "\$PREFIX"\/bin\/python3-config "\$PREFIX"\/bin\/python3\.\*-config/);
  assert.match(installer, /find "\$PREFIX" .*__pycache__.*'\*\.pyc'.*'\*\.pyo'.*-exec rm -rf \{\} \+/);
  assert.match(installer, /find "\$PREFIX" .*'\*\/test'.*'\*\/tests'.*-exec rm -rf \{\} \+/);
  assert.match(installer, /find "\$PREFIX" .*'\*\.a'.*'\*\/pkgconfig'.*-exec rm -rf \{\} \+/);
  assert.match(installer, /find "\$PREFIX" .*'\*\/config-[^']+'.*'\*\/idlelib'.*'\*\/turtledemo'.*-exec rm -rf \{\} \+/);
});
