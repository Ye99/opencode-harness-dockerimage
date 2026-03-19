#!/usr/bin/env bash

set -euo pipefail

SRC_ROOT="${1:?source root is required}"
DEST_ROOT="${2:?destination root is required}"

PLUGIN_DEST="$DEST_ROOT/plugins/superpowers"

[[ -f "$SRC_ROOT/.opencode/plugins/superpowers.js" ]] || { echo "Missing Superpowers plugin: $SRC_ROOT/.opencode/plugins/superpowers.js" >&2; exit 1; }
[[ -d "$SRC_ROOT/skills" ]] || { echo "Missing Superpowers skills: $SRC_ROOT/skills" >&2; exit 1; }

mkdir -p "$PLUGIN_DEST"
cp -R "$SRC_ROOT"/. "$PLUGIN_DEST"/

[[ -f "$PLUGIN_DEST/.opencode/plugins/superpowers.js" ]] || { echo "Superpowers plugin install failed" >&2; exit 1; }
[[ -d "$PLUGIN_DEST/skills/using-superpowers" ]] || { echo "Missing using-superpowers skill after install" >&2; exit 1; }
[[ -d "$PLUGIN_DEST/skills/brainstorming" ]] || { echo "Missing brainstorming skill after install" >&2; exit 1; }

printf 'install-superpowers-ok\n'
