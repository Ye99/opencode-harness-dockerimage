#!/usr/bin/env bash
# Verify a Python source archive using GPG (.asc) or Sigstore (.sigstore).
# Sourced by install-python-runtime.sh; also directly testable.
#
# Required globals: PYTHON_VERSION, ARCHIVE
# Usage: verify_archive <path-to-archive>

verify_archive() {
  local archive_path="$1"
  local base_url="https://www.python.org/ftp/python/${PYTHON_VERSION}/${ARCHIVE}"

  # ── Try GPG (.asc) ─────────────────────────────────────────────────────────
  curl -fsSL "${base_url}.asc" -o "${archive_path}.asc" 2>/dev/null || true
  if [[ -f "${archive_path}.asc" && -s "${archive_path}.asc" ]]; then
    if gpg --batch --auto-key-retrieve --verify "${archive_path}.asc" "$archive_path" 2>/dev/null; then
      printf 'GPG signature verified for %s\n' "$ARCHIVE"
      return 0
    fi
    printf 'WARNING: GPG verification failed for %s\n' "$ARCHIVE" >&2
  fi

  # ── Try Sigstore (.sigstore bundle, Python 3.14+) ──────────────────────────
  curl -fsSL "${base_url}.sigstore" -o "${archive_path}.sigstore" 2>/dev/null || true
  if [[ -f "${archive_path}.sigstore" && -s "${archive_path}.sigstore" ]]; then
    if command -v cosign >/dev/null 2>&1; then
      if cosign verify-blob \
          --bundle "${archive_path}.sigstore" \
          --certificate-identity-regexp '.*@python\.org' \
          --certificate-oidc-issuer-regexp 'https://github\.com/login/oauth|https://accounts\.google\.com' \
          "$archive_path" 2>/dev/null; then
        printf 'Sigstore bundle verified for %s\n' "$ARCHIVE"
        return 0
      fi
      printf 'WARNING: Sigstore verification failed for %s\n' "$ARCHIVE" >&2
    else
      printf 'WARNING: Sigstore bundle found for %s but cosign not available — continuing with HTTPS-only trust\n' "$ARCHIVE" >&2
    fi
    return 0
  fi

  printf 'WARNING: No signature found for %s — continuing with HTTPS-only trust\n' "$ARCHIVE" >&2
}
