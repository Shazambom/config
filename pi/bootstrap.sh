#!/usr/bin/env bash
# Shared operations for the two pinned installers, not a general installer API.
# Call inside an installer subshell so its staging trap cannot replace the caller's.
pi_stage_download() {
  mkdir -p "$pi_runtime_root"
  stage="$(mktemp -d "$pi_runtime_root/.download.XXXXXX")"
  trap 'rm -rf -- "$stage"' EXIT
}

pi_download_verified() {
  local url="$1" destination="$2" expected="$3" actual
  if command -v curl >/dev/null; then
    curl --fail --location --retry 3 --connect-timeout 30 "$url" -o "$destination" >&2
  elif command -v wget >/dev/null; then
    wget -O "$destination" "$url" >&2
  else
    echo 'Bootstrap needs curl or wget.' >&2; return 1
  fi
  if command -v sha256sum >/dev/null; then
    actual="$(sha256sum "$destination")"
  elif command -v shasum >/dev/null; then
    actual="$(shasum -a 256 "$destination")"
  else
    echo 'Bootstrap needs sha256sum or shasum.' >&2; return 1
  fi
  [[ "${actual%% *}" == "$expected" ]] || {
    printf 'Checksum mismatch for %s; refusing installation.\n' "$url" >&2
    return 1
  }
}
