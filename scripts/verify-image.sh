#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"
IMAGE_TAG="${IMAGE_TAG:-opencode-harness:verify-image}"
BRAVE_API_KEY_DUMMY="${BRAVE_API_KEY_DUMMY:-dummy-brave-key}"

declare -a CONTAINERS=()

cleanup() {
  local container_name

  for container_name in "${CONTAINERS[@]:-}"; do
    docker rm -f "$container_name" >/dev/null 2>&1 || true
  done
}

trap 'cleanup' EXIT

build_image() {
  (
    cd "$REPO_DIR"
    docker build --pull --no-cache -t "$IMAGE_TAG" .
  )
}

container_status() {
  docker inspect -f '{{.State.Status}}' "$1"
}

wait_for_running_container() {
  local container_name="$1"
  local status=''
  local attempt

  for attempt in $(seq 1 30); do
    status="$(container_status "$container_name")"
    case "$status" in
      running)
        return 0
        ;;
      exited|dead)
        docker logs "$container_name" >&2 || true
        printf 'Container exited before reaching running state: %s\n' "$container_name" >&2
        return 1
        ;;
    esac
    sleep 1
  done

  docker logs "$container_name" >&2 || true
  printf 'Container did not reach running state: %s\n' "$container_name" >&2
  return 1
}

exec_checks() {
  local container_name="$1"

  docker exec -i "$container_name" bash -s <<'EOF'
set -euo pipefail

command -v mcp-server-brave-search >/dev/null
command -v python3 >/dev/null
command -v python >/dev/null
command -v pip3 >/dev/null
command -v pip >/dev/null
npm ls -g @modelcontextprotocol/server-brave-search --depth=0 >/tmp/brave-package.txt
test -f /opt/opencode/mcp-versions.json
venv_root="$(mktemp -d)"
trap 'rm -rf "$venv_root"' EXIT
python3 --version >/tmp/python3-version.txt
python --version >/tmp/python-version.txt
pip3 --version >/tmp/pip3-version.txt
pip --version >/tmp/pip-version.txt
python3 -m pip --version >/tmp/python3-m-pip-version.txt
python -m pip --version >/tmp/python-m-pip-version.txt
python3 -m venv "$venv_root/python3-venv"
python -m venv "$venv_root/python-venv"

python3 - <<'PY'
import sys

assert sys.executable
PY

python - <<'PY'
import sys

assert sys.executable
PY

node - <<'NODE'
const fs = require('node:fs');
const childProcess = require('node:child_process');

const metadata = JSON.parse(fs.readFileSync('/opt/opencode/mcp-versions.json', 'utf8'));
const packageRoot = childProcess.execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
const installed = JSON.parse(fs.readFileSync(`${packageRoot}/@modelcontextprotocol/server-brave-search/package.json`, 'utf8'));
const metadataVersion = metadata?.dependencies?.['@modelcontextprotocol/server-brave-search']?.version;

if (!metadataVersion || metadataVersion !== installed.version) {
  throw new Error(`Brave MCP version mismatch: metadata=${metadataVersion} installed=${installed.version}`);
}
NODE

rendered_state="$(node - <<'NODE'
const fs = require('node:fs');
const config = JSON.parse(fs.readFileSync('/opt/opencode/opencode.json', 'utf8'));
const brave = config?.mcp?.['brave-search'] ?? {};
const key = brave?.environment?.BRAVE_API_KEY;

process.stdout.write(JSON.stringify({
  enabled: brave.enabled === true,
  hasKey: typeof key === 'string' && key.trim().length > 0,
}));
NODE
)"

node - <<'NODE' "$rendered_state" "$EXPECT_HAS_KEY"
const [renderedState, expectedHasKey] = process.argv.slice(2);
const state = JSON.parse(renderedState);

if (state.enabled !== state.hasKey) {
  throw new Error(`Rendered brave-search enabled/key mismatch: ${renderedState}`);
}

if (String(state.hasKey) !== expectedHasKey) {
  throw new Error(`Rendered brave-search state mismatch: ${renderedState}`);
}
NODE

BRAVE_EXPECTED_ENABLED="$(node - <<'NODE' "$rendered_state"
const [renderedState] = process.argv.slice(2);
const state = JSON.parse(renderedState);

process.stdout.write(String(state.enabled));
NODE
)"

mcp_output="$(opencode mcp list 2>&1)"
check_mcp_discovery_script='/opt/opencode/scripts/check-mcp-discovery.mjs'
helper_args=()
helper_args+=(--require-enabled context7 --require-enabled grep_app)
if [[ "$BRAVE_EXPECTED_ENABLED" == 'true' ]]; then
  helper_args+=(--require-enabled brave-search)
else
  helper_args+=(--require-missing-or-disabled brave-search)
fi
helper_output="$(printf '%s' "$mcp_output" | node "$check_mcp_discovery_script" "${helper_args[@]}" 2>&1)" || {
  printf '%s\n' "$helper_output" >&2
  printf '%s\n' "$mcp_output" >&2
  exit 1
}

if [[ "$SMOKE_STATE_NAME" == 'keyed-online' ]]; then
  node_bin="$(command -v node)"
  timeout_bin="$(command -v timeout)"
  brave_entrypoint="$(node - <<'NODE'
const fs = require('node:fs');
const childProcess = require('node:child_process');
const path = require('node:path');

const packageRoot = childProcess.execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
const packageJson = JSON.parse(fs.readFileSync(`${packageRoot}/@modelcontextprotocol/server-brave-search/package.json`, 'utf8'));
const binEntry = typeof packageJson.bin === 'string'
  ? packageJson.bin
  : packageJson.bin?.['mcp-server-brave-search'];

if (!binEntry) {
  throw new Error('Missing brave-search bin entry');
}

process.stdout.write(path.resolve(packageRoot, '@modelcontextprotocol/server-brave-search', binEntry));
NODE
)"
  set +e
  env -i BRAVE_API_KEY="$BRAVE_API_KEY" "$timeout_bin" 3 "$node_bin" "$brave_entrypoint" >/tmp/brave-startup.txt 2>&1
  status=$?
  set -e
  if [[ "$status" -ne 124 ]] && ! grep -Fq 'Brave Search MCP Server running on stdio' /tmp/brave-startup.txt; then
    cat /tmp/brave-startup.txt >&2
    exit 1
  fi
fi

printf 'state-ok %s\n' "$SMOKE_STATE_NAME"
EOF
}

run_state() {
  local state_name="$1"
  local network_mode="$2"
  local expect_has_key="$3"
  local container_name="verify-image-${state_name}-$$"
  local -a docker_args=(
    run
    --detach
    --name "$container_name"
    -v "$REPO_DIR:/workspace"
    -e "SMOKE_STATE_NAME=$state_name"
    -e "EXPECT_HAS_KEY=$expect_has_key"
  )

  if [[ "$network_mode" == 'none' ]]; then
    docker_args+=(--network none)
  fi

  if [[ "$expect_has_key" == 'true' ]]; then
    docker_args+=(-e "BRAVE_API_KEY=$BRAVE_API_KEY_DUMMY")
  fi

  docker_args+=("$IMAGE_TAG")

  CONTAINERS+=("$container_name")
  docker "${docker_args[@]}" >/dev/null
  wait_for_running_container "$container_name"
  exec_checks "$container_name"
}

main() {
  build_image

  local -a state_pids=()
  local -a state_names=()

  for state_spec in \
    'keyed-online bridge true' \
    'no-key-online bridge false' \
    'keyed-no-egress none true' \
    'no-key-no-egress none false' \
  ; do
    read -r name network key <<<"$state_spec"
    CONTAINERS+=("verify-image-${name}-$$")
  done

  run_state keyed-online bridge true &
  state_pids+=($!); state_names+=(keyed-online)
  run_state no-key-online bridge false &
  state_pids+=($!); state_names+=(no-key-online)
  run_state keyed-no-egress none true &
  state_pids+=($!); state_names+=(keyed-no-egress)
  run_state no-key-no-egress none false &
  state_pids+=($!); state_names+=(no-key-no-egress)

  local failed=0
  for i in "${!state_pids[@]}"; do
    if ! wait "${state_pids[$i]}"; then
      printf 'smoke state failed: %s\n' "${state_names[$i]}" >&2
      failed=1
    fi
  done

  if [[ "$failed" == 1 ]]; then
    exit 1
  fi

  printf 'smoke-ok\n'
}

main "$@"
