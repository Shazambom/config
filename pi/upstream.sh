#!/usr/bin/env bash
set -euo pipefail
repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
source "$repo/pi/bootstrap.sh"
mkdir -p "$repo/pi/upstream"
stage="$(mktemp -d "$repo/pi/upstream/.download.XXXXXX")"
trap 'rm -rf -- "$stage"' EXIT
jq -c '.[]' "$repo/pi/upstream.json" > "$stage/sources"
while IFS= read -r spec; do
  name="$(jq -r '.name' <<< "$spec")"
  ref="$(jq -r '.ref' <<< "$spec")"
  sha="$(jq -r '.sha256' <<< "$spec")"
  target="$repo/pi/upstream/$name-$ref"
  patch="$(jq -r '.patch // empty' <<< "$spec")"
  stamp="$spec"
  if [[ -n "$patch" ]]; then
    if command -v sha256sum >/dev/null; then hash="$(sha256sum "$repo/pi/patches/$patch")"; else hash="$(shasum -a 256 "$repo/pi/patches/$patch")"; fi
    stamp="$(jq -c --arg hash "${hash%% *}" '. + {patchSha256: $hash}' <<< "$spec")"
  fi
  if [[ -f "$target/.portable-source.json" ]] && [[ "$(< "$target/.portable-source.json")" == "$stamp" ]]; then
    continue
  fi
  pi_download_verified "https://codeload.github.com/amosblomqvist/$name/tar.gz/$ref" "$stage/source.tgz" "$sha"
  mkdir "$stage/extracted"
  paths=()
  while IFS= read -r path; do
    paths+=("$name-$ref/$path")
  done < <(jq -r '.paths[]' <<< "$spec")
  tar -xzf "$stage/source.tgz" -C "$stage/extracted" "${paths[@]}"
  if [[ -n "$patch" ]]; then
    (cd "$repo"; git apply --unidiff-zero --directory="${stage#"$repo/"}/extracted/$name-$ref" "$repo/pi/patches/$patch")
  fi
  printf '%s\n' "$stamp" > "$stage/extracted/$name-$ref/.portable-source.json"
  rm -rf -- "$target"
  mv "$stage/extracted/$name-$ref" "$target"
  rmdir "$stage/extracted"
done < "$stage/sources"
