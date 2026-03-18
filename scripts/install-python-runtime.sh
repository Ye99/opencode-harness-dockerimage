#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: $0 <python-version>" >&2
  exit 1
fi

PYTHON_VERSION="$1"
PREFIX=/opt/python
BUILD_ROOT="$(mktemp -d)"
ARCHIVE="Python-${PYTHON_VERSION}.tar.xz"
SOURCE_DIR="$BUILD_ROOT/Python-${PYTHON_VERSION}"

cleanup() {
  rm -rf "$BUILD_ROOT"
}

trap cleanup EXIT

mkdir -p "$PREFIX"
curl -fsSL "https://www.python.org/ftp/python/${PYTHON_VERSION}/${ARCHIVE}" -o "$BUILD_ROOT/$ARCHIVE"
tar -xJf "$BUILD_ROOT/$ARCHIVE" -C "$BUILD_ROOT"

cd "$SOURCE_DIR"
./configure --prefix="$PREFIX" --with-ensurepip=install
make -j"$(nproc)"
make install

rm -rf "$PREFIX/share"
rm -f "$PREFIX"/bin/2to3* "$PREFIX"/bin/idle3* "$PREFIX"/bin/pydoc3* "$PREFIX"/bin/python3-config "$PREFIX"/bin/python3.*-config
find "$PREFIX" \( -name __pycache__ -o -name '*.pyc' -o -name '*.pyo' \) -prune -exec rm -rf {} +
find "$PREFIX" \( -path '*/test' -o -path '*/tests' \) -prune -exec rm -rf {} +
find "$PREFIX" \( -name '*.a' -o -path '*/pkgconfig' \) -prune -exec rm -rf {} +
find "$PREFIX" \( -path '*/config-*' -o -path '*/idlelib' -o -path '*/turtledemo' \) -prune -exec rm -rf {} +
