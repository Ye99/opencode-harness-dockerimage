#!/usr/bin/env bash

set -euo pipefail

COMMAND="${1:-preflight}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/workspace}"
OPENCODE_CONFIG="${OPENCODE_CONFIG:-/opt/opencode/opencode.json}"
OPENCODE_CONFIG_DIR="${OPENCODE_CONFIG_DIR:-/opt/opencode}"
OPENCODE_SERVER_PORT="${OPENCODE_SERVER_PORT:-4096}"
OPENCODE_SERVER_HOST="${OPENCODE_SERVER_HOST:-0.0.0.0}"
OCA_OAUTH_CALLBACK_PORT="${OCA_OAUTH_CALLBACK_PORT:-48801}"
SUPERPOWERS_SKILLS_DIR="${SUPERPOWERS_SKILLS_DIR:-/opt/opencode/skills}"
SUPERPOWERS_INSTALL_DIR="$SUPERPOWERS_SKILLS_DIR/superpowers"
OCA_PLUGIN_DIR="${OCA_PLUGIN_DIR:-$OPENCODE_CONFIG_DIR/plugins/opencode-oca-auth}"
SUPERPOWERS_PLUGIN="${SUPERPOWERS_PLUGIN:-$OPENCODE_CONFIG_DIR/plugins/superpowers.js}"

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

check_port_available() {
  local host="$1"
  local port="$2"

  node -e '
    const net = require("node:net");
    const [host, port] = process.argv.slice(1);
    const server = net.createServer();
    server.once("error", () => process.exit(1));
    server.once("listening", () => server.close(() => process.exit(0)));
    server.listen(Number(port), host);
  ' "$host" "$port" || fail "Port is unavailable: ${host}:${port}"
}

check_workspace() {
  [[ -d "$WORKSPACE_DIR" ]] || fail "Missing mounted workspace: $WORKSPACE_DIR"
  [[ -w "$WORKSPACE_DIR" ]] || fail "Mounted workspace is not writable: $WORKSPACE_DIR"
}

check_assets() {
  [[ -f "$OPENCODE_CONFIG" ]] || fail "Missing OpenCode config: $OPENCODE_CONFIG"
  [[ -d "$OCA_PLUGIN_DIR" ]] || fail "Missing opencode-oca-auth plugin: $OCA_PLUGIN_DIR"
  [[ -f "$SUPERPOWERS_PLUGIN" ]] || fail "Missing Superpowers plugin: $SUPERPOWERS_PLUGIN"
  [[ -d "$SUPERPOWERS_INSTALL_DIR/using-superpowers" ]] || fail "Missing bundled Superpowers skills: $SUPERPOWERS_SKILLS_DIR"
  [[ -d "$SUPERPOWERS_INSTALL_DIR/brainstorming" ]] || fail "Missing bundled Superpowers skills: $SUPERPOWERS_SKILLS_DIR"
  command -v opencode >/dev/null 2>&1 || fail "opencode CLI not found in PATH"
}

check_config_visibility() {
  local output
  output="$(opencode debug config)"
  grep -q '/opt/opencode/plugins/opencode-oca-auth' <<<"$output" || fail 'OpenCode config output does not expose baked opencode-oca-auth plugin'
  grep -q '/opt/opencode/plugins/superpowers.js' <<<"$output" || fail 'OpenCode config output does not expose baked Superpowers plugin'
  grep -q "$SUPERPOWERS_INSTALL_DIR" <<<"$output" || fail "OpenCode config output does not expose $SUPERPOWERS_INSTALL_DIR"
}

check_oca_models() {
  local output
  output="$(opencode models oca 2>/dev/null)" || fail 'OpenCode does not expose OCA models from the baked auth plugin'
  grep -q 'oca/' <<<"$output" || fail 'OpenCode does not expose OCA models from the baked auth plugin'
}

case "$COMMAND" in
  preflight)
    check_workspace
    check_assets
    check_port_available "$OPENCODE_SERVER_HOST" "$OPENCODE_SERVER_PORT"
    check_port_available '0.0.0.0' "$OCA_OAUTH_CALLBACK_PORT"
    check_config_visibility
    check_oca_models
    printf 'preflight-ok\n'
    ;;
  *)
    fail "Unknown verify-runtime command: $COMMAND"
    ;;
esac
