#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
COMMAND="${1:-preflight}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
OPENCODE_CONFIG="${OPENCODE_CONFIG:-/opt/opencode/opencode.json}"
OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-/opt/opencode}"
MCP_VERSIONS_FILE="${MCP_VERSIONS_FILE:-/opt/opencode/mcp-versions.json}"
OPENCODE_SERVER_PORT="${OPENCODE_SERVER_PORT:-4096}"
OPENCODE_SERVER_HOST="${OPENCODE_SERVER_HOST:-0.0.0.0}"
OCA_OAUTH_CALLBACK_PORT="${OCA_OAUTH_CALLBACK_PORT:-48801}"
OCA_PLUGIN_DIR="${OCA_PLUGIN_DIR:-$OPENCODE_CONFIG_DIR/plugins/opencode-oca-auth}"
SUPERPOWERS_PLUGIN_DIR="${SUPERPOWERS_PLUGIN_DIR:-$OPENCODE_CONFIG_DIR/plugins/superpowers}"
SUPERPOWERS_PLUGIN_ENTRY="${SUPERPOWERS_PLUGIN_ENTRY:-$SUPERPOWERS_PLUGIN_DIR/.opencode/plugins/superpowers.js}"
BRAVE_MCP_BINARY="mcp-server-brave-search"
BRAVE_MCP_PACKAGE="@modelcontextprotocol/server-brave-search"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

check_workspace() {
  [[ -d "$WORKSPACE_DIR" ]] || fail "Missing mounted workspace: $WORKSPACE_DIR"
  [[ -w "$WORKSPACE_DIR" ]] || fail "Mounted workspace is not writable: $WORKSPACE_DIR"
}

check_assets() {
  [[ -f "$OPENCODE_CONFIG" ]] || fail "Missing OpenCode config: $OPENCODE_CONFIG"
  [[ -d "$OCA_PLUGIN_DIR" ]] || fail "Missing opencode-oca-auth plugin: $OCA_PLUGIN_DIR"
  [[ -f "$SUPERPOWERS_PLUGIN_ENTRY" ]] || fail "Missing Superpowers plugin: $SUPERPOWERS_PLUGIN_ENTRY"
  [[ -d "$SUPERPOWERS_PLUGIN_DIR/skills/using-superpowers" ]] || fail "Missing bundled Superpowers skills: $SUPERPOWERS_PLUGIN_DIR/skills"
  [[ -d "$SUPERPOWERS_PLUGIN_DIR/skills/brainstorming" ]] || fail "Missing bundled Superpowers skills: $SUPERPOWERS_PLUGIN_DIR/skills"
  command -v opencode >/dev/null 2>&1 || fail "opencode CLI not found in PATH"
  command -v "$BRAVE_MCP_BINARY" >/dev/null 2>&1 || fail "$BRAVE_MCP_BINARY not found in PATH"
  [[ -f "$MCP_VERSIONS_FILE" ]] || fail "Missing MCP metadata file: $MCP_VERSIONS_FILE"
}

check_python_runtime() {
  local venv_dir

  command -v python3 >/dev/null 2>&1 || fail 'python3 not found in PATH'
  command -v python >/dev/null 2>&1 || fail 'python not found in PATH'
  command -v pip3 >/dev/null 2>&1 || fail 'pip3 not found in PATH'
  command -v pip >/dev/null 2>&1 || fail 'pip not found in PATH'

  python3 --version >/dev/null 2>&1 || fail 'python3 --version failed'
  pip3 --version >/dev/null 2>&1 || fail 'pip3 --version failed'

  venv_dir="$(mktemp -d)"
  python3 -m venv "$venv_dir" >/dev/null 2>&1 || {
    rm -rf "$venv_dir"
    fail 'python3 -m venv failed'
  }
  rm -rf "$venv_dir"
}

check_ports_metadata_and_brave_state() {
  local node_output

  node_output="$(node "$SCRIPT_DIR/preflight-node-checks.mjs" \
    --check-port "$OPENCODE_SERVER_HOST:$OPENCODE_SERVER_PORT" \
    --check-port "0.0.0.0:$OCA_OAUTH_CALLBACK_PORT" \
    --mcp-metadata "$MCP_VERSIONS_FILE" "$BRAVE_MCP_PACKAGE" \
    --config "$OPENCODE_CONFIG" \
    2>&1)" || { local first_error; IFS= read -r first_error <<< "$node_output"; fail "$first_error"; }

  RENDERED_BRAVE_STATE="$node_output"
}

check_config_visibility() {
  local output
  output="$(opencode debug config)"
  grep -q '/opt/opencode/plugins/opencode-oca-auth' <<<"$output" || fail 'OpenCode config output does not expose baked opencode-oca-auth plugin'
  grep -q '/opt/opencode/plugins/superpowers' <<<"$output" || fail 'OpenCode config output does not expose baked Superpowers plugin'
  grep -q "$SUPERPOWERS_PLUGIN_DIR/skills" <<<"$output" || fail "OpenCode config output does not expose $SUPERPOWERS_PLUGIN_DIR/skills"
}

check_oca_models() {
  local output
  output="$(opencode models oca 2>/dev/null)" || fail 'OpenCode does not expose OCA models from the baked auth plugin'
  grep -q 'oca/' <<<"$output" || fail 'OpenCode does not expose OCA models from the baked auth plugin'
}

check_mcp_discovery() {
  local output
  local helper_output
  local -a helper_args=(
    --require-enabled context7
    --require-enabled grep_app
  )

  output="$(opencode mcp list 2>&1)" || fail "opencode mcp list failed: $output"

  if [[ "$RENDERED_BRAVE_STATE" == 'enabled' ]]; then
    helper_args+=(--require-enabled brave-search)
  else
    helper_args+=(--require-missing-or-disabled brave-search)
  fi

  helper_output="$(printf '%s' "$output" | node "$SCRIPT_DIR/check-mcp-discovery.mjs" "${helper_args[@]}" 2>&1)" || fail "$helper_output"
}

RENDERED_BRAVE_STATE='disabled'

case "$COMMAND" in
  preflight)
    check_workspace
    check_assets
    check_python_runtime
    check_ports_metadata_and_brave_state
    check_config_visibility
    check_oca_models
    check_mcp_discovery
    printf 'preflight-ok\n'
    ;;
  *)
    fail "Unknown verify-runtime command: $COMMAND"
    ;;
esac
