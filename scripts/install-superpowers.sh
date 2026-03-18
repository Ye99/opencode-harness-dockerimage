#!/usr/bin/env bash

set -euo pipefail

SRC_ROOT="${1:?source root is required}"
DEST_ROOT="${2:?destination root is required}"

PLUGIN_SRC="$SRC_ROOT/.opencode/plugins/superpowers.js"
SKILLS_SRC="$SRC_ROOT/skills"
SKILLS_DEST="$DEST_ROOT/skills/superpowers"
PLUGIN_DEST="$DEST_ROOT/plugins"

[[ -f "$PLUGIN_SRC" ]] || { echo "Missing Superpowers plugin: $PLUGIN_SRC" >&2; exit 1; }
[[ -d "$SKILLS_SRC" ]] || { echo "Missing Superpowers skills: $SKILLS_SRC" >&2; exit 1; }

mkdir -p "$PLUGIN_DEST"
mkdir -p "$SKILLS_DEST"

cp "$PLUGIN_SRC" "$PLUGIN_DEST/superpowers.js"
cp -R "$SKILLS_SRC"/. "$SKILLS_DEST"/

[[ -f "$PLUGIN_DEST/superpowers.js" ]] || { echo "Superpowers plugin install failed" >&2; exit 1; }
[[ -d "$SKILLS_DEST/using-superpowers" ]] || { echo "Missing using-superpowers skill after install" >&2; exit 1; }
[[ -d "$SKILLS_DEST/brainstorming" ]] || { echo "Missing brainstorming skill after install" >&2; exit 1; }

printf 'install-superpowers-ok\n'
